import { create } from 'zustand'
import { forbiddenIndexes } from '../game/forbidden'
import {
  createGame,
  playMove,
  resign,
  undo,
} from '../game/rules'
import type {
  BoardSize,
  Color,
  GameErrorCode,
  GameResult,
  GameState,
  Point,
  RuleSet,
} from '../game/types'
import { indexToPoint } from '../game/board'
import {
  GomokuEngine,
  isEngineCancellation,
  type EngineDecision,
  type EngineKind,
  type EnginePort,
  type EngineStrength,
} from '../engine'
import { createEngine } from '../engine/createEngine'
import { ENGINE_STRENGTH_PROFILES } from '../engine/strength'

export type GameMode = 'human-vs-engine' | 'local-two-player'
export type PlayerColor = Color | 'random'
export type EngineChoice = EngineKind
export type EngineStatus =
  | 'idle'
  | 'loading'
  | 'ready'
  | 'thinking'
  | 'fallback'
  | 'error'

interface StoredPreferences {
  boardSize: BoardSize
  gameMode: GameMode
  playerColor: PlayerColor
  engineStrength: EngineStrength
  engineChoice: EngineChoice
  ruleSet: RuleSet
}

export interface DufiveState extends StoredPreferences {
  screen: 'menu' | 'game'
  game: GameState
  humanColor: Color
  engineStatus: EngineStatus
  engineVersion: string | null
  isAiThinking: boolean
  isHinting: boolean
  hintPoint: Point | null
  parisText: string
  errorMessage: string | null
  setBoardSize: (size: BoardSize) => void
  setGameMode: (mode: GameMode) => void
  setPlayerColor: (color: PlayerColor) => void
  setEngineStrength: (strength: EngineStrength) => void
  setEngineChoice: (choice: EngineChoice) => void
  setRuleSet: (ruleSet: RuleSet) => void
  startGame: () => void
  installEngine: (choice: EngineChoice) => Promise<void>
  exitToMenu: () => void
  restartGame: () => void
  playAt: (point: Point) => void
  undoTurn: () => void
  resignGame: () => void
  requestHint: () => Promise<void>
  runAiTurn: () => Promise<void>
}

const STORAGE_KEY = 'dufive-preferences-v1'
const DEFAULT_PREFERENCES: StoredPreferences = {
  boardSize: 15,
  gameMode: 'human-vs-engine',
  playerColor: 'black',
  engineStrength: 'high',
  engineChoice: 'built-in',
  ruleSet: 'free',
}

let engine: EnginePort = new GomokuEngine()
/** Set by `replaceEngineForTests`; when present, `installEngine` keeps it. */
let pinnedEngine: EnginePort | null = null
let activeEngineKind: EngineKind = 'built-in'
let operationGeneration = 0
let activeAbortController: AbortController | null = null

function loadPreferences(): StoredPreferences {
  if (typeof localStorage === 'undefined') return DEFAULT_PREFERENCES

  try {
    const stored = JSON.parse(localStorage.getItem(STORAGE_KEY) ?? '{}') as {
      boardSize?: unknown
      gameMode?: unknown
      playerColor?: unknown
      engineStrength?: unknown
      engineChoice?: unknown
      ruleSet?: unknown
    }
    return {
      boardSize: stored.boardSize === 13
        || stored.boardSize === 15
        || stored.boardSize === 19
        ? stored.boardSize
        : DEFAULT_PREFERENCES.boardSize,
      gameMode: stored.gameMode === 'local-two-player'
        ? 'local-two-player'
        : 'human-vs-engine',
      playerColor: stored.playerColor === 'white'
        || stored.playerColor === 'random'
        ? stored.playerColor
        : 'black',
      engineStrength: stored.engineStrength === 'low'
        || stored.engineStrength === 'medium'
        || stored.engineStrength === 'full'
        ? stored.engineStrength
        : 'high',
      engineChoice: stored.engineChoice === 'rapfi' ? 'rapfi' : 'built-in',
      ruleSet: stored.ruleSet === 'renju' ? 'renju' : 'free',
    }
  } catch {
    return DEFAULT_PREFERENCES
  }
}

function savePreferences(preferences: StoredPreferences): void {
  if (typeof localStorage === 'undefined') return
  try {
    localStorage.setItem(STORAGE_KEY, JSON.stringify(preferences))
  } catch {
    // Storage can be unavailable in private or constrained WebViews.
  }
}

function persist(next: StoredPreferences): void {
  savePreferences(next)
}

function randomColor(): Color {
  if (typeof crypto !== 'undefined' && 'getRandomValues' in crypto) {
    const value = new Uint8Array(1)
    crypto.getRandomValues(value)
    return (value[0] ?? 0) % 2 === 0 ? 'black' : 'white'
  }
  return Math.random() < 0.5 ? 'black' : 'white'
}

function invalidateEngine(): number {
  activeAbortController?.abort()
  activeAbortController = null
  operationGeneration += 1
  engine.invalidate(operationGeneration)
  return operationGeneration
}

function errorText(code: GameErrorCode): string {
  const messages: Record<GameErrorCode, string> = {
    finished: '这一局已经结束了。',
    'out-of-bounds': '落子超出了棋盘。',
    occupied: '这个交叉点已经有棋子。',
    forbidden: '黑方禁手：长连、双四、双三都不能落子。',
    'nothing-to-undo': '还没有可以撤销的落子。',
  }
  return messages[code]
}

function colorName(color: Color): string {
  return color === 'black' ? '黑方' : '白方'
}

function resultMessage(game: GameState): string {
  if (game.winner === 'draw') return '棋盘下满，双方握手言和。'
  if (!game.winner) return '这一局还没有分出胜负。'
  if (game.finishReason === 'resignation') {
    return `${colorName(game.winner)}胜。胜负之外，更重要的是看懂刚才的选择。`
  }
  return `${colorName(game.winner)}五子连珠。可以再来一局试试别的走法。`
}

/** Empty points the side to play must avoid (renju black only). */
function forbiddenFor(state: GameState): number[] {
  return state.ruleSet === 'renju'
    ? forbiddenIndexes(state.board, state.size, state.toPlay)
    : []
}

/**
 * Asks the active engine for a move. When the Rapfi engine fails at runtime we
 * degrade to the built-in engine instead of leaving the game stuck, because
 * both engines are fully offline and share the same interface.
 */
async function runEngineTurn(
  snapshot: GameState,
  strength: EngineStrength,
): Promise<EngineDecision> {
  const request = {
    board: snapshot.board,
    size: snapshot.size,
    color: snapshot.toPlay,
    strength,
    ruleSet: snapshot.ruleSet,
    forbidden: forbiddenFor(snapshot),
    generation: operationGeneration,
    signal: activeAbortController?.signal,
  }

  try {
    return await engine.generateMove(request)
  } catch (error) {
    if (isEngineCancellation(error)) throw error
    if (activeEngineKind !== 'rapfi') throw error

    engine.dispose()
    engine = new GomokuEngine()
    engine.invalidate(operationGeneration)
    activeEngineKind = 'built-in'

    return engine.generateMove(request)
  }
}

function commitResult(
  result: GameResult,
  successMessage: (game: GameState) => string,
): boolean {
  if (!result.ok) {
    useGameStore.setState({ errorMessage: errorText(result.error.code) })
    return false
  }

  invalidateEngine()
  useGameStore.setState({
    game: result.state,
    hintPoint: null,
    errorMessage: null,
    // A move invalidates any hint that was still being computed.
    isHinting: false,
    parisText: successMessage(result.state),
  })
  return true
}

function shouldEngineMove(state: DufiveState): boolean {
  return state.screen === 'game'
    && state.gameMode === 'human-vs-engine'
    && state.game.phase === 'playing'
    && state.game.toPlay !== state.humanColor
    && !state.isAiThinking
}

const preferences = loadPreferences()

export const useGameStore = create<DufiveState>((set, get) => ({
  ...preferences,
  screen: 'menu',
  game: createGame(preferences.boardSize, preferences.ruleSet),
  humanColor: 'black',
  engineStatus: 'idle',
  engineVersion: null,
  isAiThinking: false,
  isHinting: false,
  hintPoint: null,
  parisText: '挑一张棋盘，我们从第一手开始。',
  errorMessage: null,

  setBoardSize: (boardSize) => {
    const { gameMode, playerColor, engineStrength, engineChoice, ruleSet } = get()
    set({ boardSize })
    persist({ boardSize, gameMode, playerColor, engineStrength, engineChoice, ruleSet })
  },

  setGameMode: (gameMode) => {
    const { boardSize, playerColor, engineStrength, engineChoice, ruleSet } = get()
    set({ gameMode })
    persist({ boardSize, gameMode, playerColor, engineStrength, engineChoice, ruleSet })
  },

  setPlayerColor: (playerColor) => {
    const { boardSize, gameMode, engineStrength, engineChoice, ruleSet } = get()
    set({ playerColor })
    persist({ boardSize, gameMode, playerColor, engineStrength, engineChoice, ruleSet })
  },

  setEngineStrength: (engineStrength) => {
    const { boardSize, gameMode, playerColor, engineChoice, ruleSet } = get()
    set({ engineStrength })
    persist({ boardSize, gameMode, playerColor, engineStrength, engineChoice, ruleSet })
  },

  setEngineChoice: (engineChoice) => {
    const { boardSize, gameMode, playerColor, engineStrength, ruleSet } = get()
    set({ engineChoice })
    persist({ boardSize, gameMode, playerColor, engineStrength, engineChoice, ruleSet })
  },

  setRuleSet: (ruleSet) => {
    const { boardSize, gameMode, playerColor, engineStrength, engineChoice } = get()
    set({ ruleSet })
    persist({ boardSize, gameMode, playerColor, engineStrength, engineChoice, ruleSet })
  },

  startGame: () => {
    const state = get()
    const humanColor = state.gameMode === 'local-two-player'
      ? 'black'
      : state.playerColor === 'random'
        ? randomColor()
        : state.playerColor

    invalidateEngine()
    set({
      screen: 'game',
      game: createGame(state.boardSize, state.ruleSet),
      humanColor,
      engineStatus: state.gameMode === 'human-vs-engine' ? 'loading' : 'idle',
      engineVersion: null,
      isAiThinking: false,
      isHinting: false,
      hintPoint: null,
      errorMessage: null,
      parisText: state.gameMode === 'local-two-player'
        ? '黑方先行。两位棋手在同一块棋盘上轮流落子。'
        : humanColor === 'black'
          ? '你执黑先行。先占中间，再往两边连，是最稳的开局。'
          : '你执白，帕里斯先行。留意它第一手想占的方向。',
    })

    if (state.gameMode === 'human-vs-engine') {
      void get().installEngine(state.engineChoice)
    }
  },

  /**
   * Swaps in the selected engine. The Rapfi build is imported on demand, so
   * the swap is asynchronous and has to be re-checked against the current
   * generation once it settles.
   */
  installEngine: async (choice) => {
    const generation = operationGeneration
    let next: EnginePort

    if (pinnedEngine) {
      next = pinnedEngine
    } else {
      try {
        next = await createEngine(choice)
      } catch {
        if (generation !== operationGeneration || get().screen !== 'game') return
        set({
          engineStatus: 'error',
          errorMessage: '帕里斯的引擎没有加载成功，请换回随身棋力。',
        })
        return
      }
    }

    if (generation !== operationGeneration || get().screen !== 'game') {
      return
    }

    if (engine !== next) {
      engine.dispose()
      engine = next
    }
    activeEngineKind = choice
    engine.invalidate(operationGeneration)

    try {
      const version = await engine.init()
      if (generation !== operationGeneration || get().screen !== 'game') return
      set({ engineStatus: 'ready', engineVersion: version })
    } catch {
      if (generation !== operationGeneration || get().screen !== 'game') return
      // Rapfi could not start (unsupported browser, blocked WASM, missing
      // files). Fall back once rather than retrying a 1.3 MB download on
      // every move.
      if (choice === 'rapfi' && !pinnedEngine) {
        engine.dispose()
        engine = new GomokuEngine()
        activeEngineKind = 'built-in'
        engine.invalidate(operationGeneration)
        try {
          const version = await engine.init()
          if (generation !== operationGeneration || get().screen !== 'game') return
          set({ engineStatus: 'fallback', engineVersion: version })
        } catch {
          if (generation !== operationGeneration || get().screen !== 'game') return
          set({ engineStatus: 'error' })
        }
      } else {
        set({ engineStatus: 'fallback', engineVersion: null })
      }
    }

    if (shouldEngineMove(get())) void get().runAiTurn()
  },

  exitToMenu: () => {
    invalidateEngine()
    set({
      screen: 'menu',
      isAiThinking: false,
      isHinting: false,
      hintPoint: null,
      errorMessage: null,
      parisText: '棋局已经收好，随时可以再开一盘。',
    })
  },

  restartGame: () => {
    get().startGame()
  },

  playAt: (point) => {
    const state = get()
    if (state.screen !== 'game' || state.game.phase !== 'playing') return
    if (
      state.gameMode === 'human-vs-engine'
      && (state.isAiThinking || state.game.toPlay !== state.humanColor)
    ) return

    const before = state.game
    const played = commitResult(playMove(before, point), (game) => {
      if (game.phase === 'finished') return resultMessage(game)
      return game.toPlay === state.humanColor
        ? `${colorName(before.toPlay)}落子。轮到你了。`
        : `${colorName(before.toPlay)}落子。帕里斯正在想下一手。`
    })

    if (played && shouldEngineMove(get())) void get().runAiTurn()
  },

  undoTurn: () => {
    const state = get()
    if (state.screen !== 'game') return
    invalidateEngine()

    let current = state.game
    let result = undo(current)
    if (!result.ok) {
      set({
        errorMessage: errorText(result.error.code),
        isAiThinking: false,
        isHinting: false,
      })
      return
    }
    current = result.state

    const lastMoveWasEngine = state.gameMode === 'human-vs-engine'
      && state.game.lastMove?.color !== state.humanColor
    if (lastMoveWasEngine && current.history.length > 0) {
      result = undo(current)
      if (result.ok) current = result.state
    }

    set({
      game: current,
      isAiThinking: false,
      isHinting: false,
      hintPoint: null,
      engineStatus: state.gameMode === 'human-vs-engine' ? 'ready' : 'idle',
      errorMessage: null,
      parisText: '已经退回上一手。换个方向再想想。',
    })

    // Undoing the engine's opening move leaves it to play again, and the
    // board is disabled until it does.
    if (shouldEngineMove(get())) void get().runAiTurn()
  },

  resignGame: () => {
    const state = get()
    if (state.screen !== 'game' || state.game.phase === 'finished') return
    const resignedBy = state.gameMode === 'human-vs-engine'
      ? state.humanColor
      : state.game.toPlay
    commitResult(resign(state.game, resignedBy), (game) => resultMessage(game))
    set({ isAiThinking: false, isHinting: false })
  },

  requestHint: async () => {
    const state = get()
    if (
      state.screen !== 'game'
      || state.game.phase !== 'playing'
      || state.isAiThinking
      || state.isHinting
    ) return

    const generation = invalidateEngine()
    const controller = new AbortController()
    activeAbortController = controller
    const snapshot = state.game
    set({
      isHinting: true,
      hintPoint: null,
      engineStatus: 'thinking',
      errorMessage: null,
      parisText: '让我看看这片棋形里最值得先走的地方…',
    })

    try {
      const decision = await engine.generateMove({
        board: snapshot.board,
        size: snapshot.size,
        color: snapshot.toPlay,
        strength: 'full',
        ruleSet: snapshot.ruleSet,
        forbidden: forbiddenFor(snapshot),
        generation,
        signal: controller.signal,
      })
      const current = get()
      if (
        generation !== operationGeneration
        || current.game.revision !== snapshot.revision
        || current.game.toPlay !== snapshot.toPlay
      ) return

      const point = indexToPoint(decision.index, snapshot.size)
      const stillEmpty = current.game.board[decision.index] === null
      set({
        hintPoint: stillEmpty ? point : null,
        isHinting: false,
        engineStatus: decision.source === 'worker' ? 'ready' : 'fallback',
        parisText: decision.moveSource === 'immediate'
          ? '这里已经可以直接连成五子了。'
          : decision.moveSource === 'vcf'
            ? '连续冲四就能赢，光圈标出了第一手。'
            : '光圈标出的是帕里斯的建议。先想想它照顾了哪一边的连线。',
      })
    } catch (error) {
      if (generation !== operationGeneration || isEngineCancellation(error)) return
      set({
        isHinting: false,
        engineStatus: 'error',
        errorMessage: '帕里斯暂时没有给出提示。',
      })
    } finally {
      if (activeAbortController === controller) activeAbortController = null
    }
  },

  runAiTurn: async () => {
    const state = get()
    if (!shouldEngineMove(state)) return

    const generation = operationGeneration
    const controller = new AbortController()
    activeAbortController = controller
    const snapshot = state.game
    set({
      isAiThinking: true,
      engineStatus: 'thinking',
      hintPoint: null,
      errorMessage: null,
      parisText: `${ENGINE_STRENGTH_PROFILES[state.engineStrength].label}档帕里斯正在本机计算…`,
    })

    try {
      const decision = await runEngineTurn(snapshot, state.engineStrength)
      const current = get()
      if (
        generation !== operationGeneration
        || current.screen !== 'game'
        || current.game.revision !== snapshot.revision
        || current.game.toPlay !== snapshot.toPlay
        || current.game.phase !== 'playing'
      ) return

      const point = indexToPoint(decision.index, snapshot.size)
      const result = playMove(current.game, point)
      if (!result.ok) {
        set({
          isAiThinking: false,
          engineStatus: 'error',
          errorMessage: '帕里斯的着法没有通过规则校验，请撤销或重新开始。',
        })
        return
      }

      invalidateEngine()
      const next = result.state
      set({
        game: next,
        isAiThinking: false,
        engineStatus: decision.source === 'worker' ? 'ready' : 'fallback',
        engineVersion: current.engineVersion,
        parisText: next.phase === 'finished'
          ? resultMessage(next)
          : decision.source === 'fallback'
            ? '引擎已切换到兼容落子，棋局仍然完全离线。'
            : '帕里斯已经落子。轮到你了。',
      })
    } catch (error) {
      if (generation !== operationGeneration || isEngineCancellation(error)) return
      set({
        isAiThinking: false,
        engineStatus: 'error',
        errorMessage: '帕里斯响应失败，请撤销或重新开始。',
      })
    } finally {
      if (activeAbortController === controller) activeAbortController = null
    }
  },
}))

export function replaceEngineForTests(nextEngine: EnginePort): void {
  activeAbortController?.abort()
  activeAbortController = null
  pinnedEngine = nextEngine
  engine = nextEngine
  engine.invalidate(operationGeneration)
}

export function resetGameStoreForTests(): void {
  activeAbortController?.abort()
  activeAbortController = null
  operationGeneration += 1
  engine = new GomokuEngine()
  engine.invalidate(operationGeneration)
  useGameStore.setState({
    ...DEFAULT_PREFERENCES,
    screen: 'menu',
    game: createGame(15, 'free'),
    humanColor: 'black',
    engineStatus: 'idle',
    engineVersion: null,
    isAiThinking: false,
    isHinting: false,
    hintPoint: null,
    parisText: '挑一张棋盘，我们从第一手开始。',
    errorMessage: null,
  })
}
