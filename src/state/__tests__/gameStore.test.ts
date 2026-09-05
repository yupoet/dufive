// @vitest-environment jsdom

import { beforeEach, describe, expect, it } from 'vitest'
import type { EngineDecision, EnginePort, GenerateMoveInput } from '../../engine'
import {
  replaceEngineForTests,
  resetGameStoreForTests,
  useGameStore,
} from '../gameStore'

class ImmediateEngine implements EnginePort {
  generation = 0
  index = 4 * 15 + 4
  calls: GenerateMoveInput[] = []

  async init(): Promise<string> {
    return 'test-engine'
  }

  invalidate(nextGeneration = this.generation + 1): number {
    this.generation = nextGeneration
    return this.generation
  }

  dispose(): void {
    // Nothing to release in tests.
  }

  async generateMove(input: GenerateMoveInput): Promise<EngineDecision> {
    this.calls.push(input)
    return {
      index: this.index,
      score: 0,
      nodes: 0,
      depth: 1,
      source: 'worker',
      moveSource: 'search',
    }
  }
}

class DeferredEngine extends ImmediateEngine {
  resolveMove: ((decision: EngineDecision) => void) | null = null

  override generateMove(input: GenerateMoveInput): Promise<EngineDecision> {
    this.calls.push(input)
    return new Promise<EngineDecision>((resolve) => {
      this.resolveMove = resolve
    })
  }
}

/** The overline point (x=4, y=0) that completes six in a row for black. */
const OVERLINE_INDEX = 4

async function flush(): Promise<void> {
  await Promise.resolve()
  await new Promise((resolve) => setTimeout(resolve, 0))
}

describe('game store orchestration', () => {
  beforeEach(() => {
    localStorage.clear()
    resetGameStoreForTests()
    replaceEngineForTests(new ImmediateEngine())
  })

  it('plays a local two-player turn without the engine', () => {
    const actions = useGameStore.getState()
    actions.setGameMode('local-two-player')
    actions.startGame()
    useGameStore.getState().playAt({ x: 2, y: 2 })

    const state = useGameStore.getState()
    expect(state.game.board[2 * 15 + 2]).toBe('black')
    expect(state.game.toPlay).toBe('white')
    expect(state.isAiThinking).toBe(false)
  })

  it('lets the engine open when the player is white', async () => {
    const actions = useGameStore.getState()
    actions.setBoardSize(15)
    actions.setPlayerColor('white')
    actions.startGame()
    await flush()

    const state = useGameStore.getState()
    expect(state.game.board[4 * 15 + 4]).toBe('black')
    expect(state.game.toPlay).toBe('white')
    expect(state.isAiThinking).toBe(false)
  })

  it('replies after the human move and reports the engine stone', async () => {
    useGameStore.getState().startGame()
    useGameStore.getState().playAt({ x: 2, y: 2 })
    await flush()

    const state = useGameStore.getState()
    expect(state.game.board[4 * 15 + 4]).toBe('white')
    expect(state.game.toPlay).toBe('black')
    expect(state.game.moveNumber).toBe(2)
  })

  it('ignores human input while the engine is thinking', () => {
    const deferred = new DeferredEngine()
    replaceEngineForTests(deferred)
    useGameStore.getState().startGame()
    useGameStore.getState().playAt({ x: 2, y: 2 })

    expect(useGameStore.getState().isAiThinking).toBe(true)
    useGameStore.getState().playAt({ x: 3, y: 3 })
    expect(useGameStore.getState().game.board[3 * 15 + 3]).toBeNull()
  })

  it('drops an engine reply that arrives after an undo', async () => {
    const deferred = new DeferredEngine()
    replaceEngineForTests(deferred)
    useGameStore.getState().startGame()
    useGameStore.getState().playAt({ x: 2, y: 2 })
    expect(useGameStore.getState().isAiThinking).toBe(true)

    useGameStore.getState().undoTurn()
    expect(useGameStore.getState().isAiThinking).toBe(false)
    expect(useGameStore.getState().game.moveNumber).toBe(0)

    deferred.resolveMove?.({
      index: 4 * 15 + 4,
      score: 0,
      nodes: 0,
      depth: 1,
      source: 'worker',
      moveSource: 'search',
    })
    await flush()

    expect(useGameStore.getState().game.board[4 * 15 + 4]).toBeNull()
    expect(useGameStore.getState().game.moveNumber).toBe(0)
  })

  it('undoes both the engine and the human move in engine games', async () => {
    useGameStore.getState().startGame()
    useGameStore.getState().playAt({ x: 2, y: 2 })
    await flush()
    expect(useGameStore.getState().game.moveNumber).toBe(2)

    useGameStore.getState().undoTurn()
    expect(useGameStore.getState().game.moveNumber).toBe(0)
    expect(useGameStore.getState().game.board[2 * 15 + 2]).toBeNull()
  })

  it('rejects a black overline under renju rules', () => {
    const actions = useGameStore.getState()
    actions.setGameMode('local-two-player')
    actions.setRuleSet('renju')
    actions.startGame()

    // Black builds an overline at y=0; white's stones are spread out so they
    // never form their own line first.
    const turns: [number, number][] = [
      [0, 0], [0, 7],
      [1, 0], [2, 7],
      [2, 0], [4, 7],
      [3, 0], [6, 7],
      [5, 0], [8, 7],
    ]
    for (const [x, y] of turns) useGameStore.getState().playAt({ x, y })

    useGameStore.getState().playAt({ x: 4, y: 0 })

    const state = useGameStore.getState()
    expect(state.game.board[OVERLINE_INDEX]).toBeNull()
    expect(state.game.toPlay).toBe('black')
    expect(state.errorMessage).toContain('禁手')
  })

  it('accepts the same overline under free-style rules', () => {
    const actions = useGameStore.getState()
    actions.setGameMode('local-two-player')
    actions.setRuleSet('free')
    actions.startGame()

    // Black builds an overline at y=0; white's stones are spread out so they
    // never form their own line first.
    const turns: [number, number][] = [
      [0, 0], [0, 7],
      [1, 0], [2, 7],
      [2, 0], [4, 7],
      [3, 0], [6, 7],
      [5, 0], [8, 7],
    ]
    for (const [x, y] of turns) useGameStore.getState().playAt({ x, y })

    useGameStore.getState().playAt({ x: 4, y: 0 })

    const state = useGameStore.getState()
    expect(state.game.board[OVERLINE_INDEX]).toBe('black')
    expect(state.game.phase).toBe('finished')
    expect(state.game.winner).toBe('black')
  })

  it('resigns on behalf of the human', () => {
    useGameStore.getState().startGame()
    useGameStore.getState().playAt({ x: 2, y: 2 })
    useGameStore.getState().resignGame()

    const state = useGameStore.getState()
    expect(state.game.phase).toBe('finished')
    expect(state.game.finishReason).toBe('resignation')
    expect(state.game.winner).toBe('white')
    expect(state.game.resignedBy).toBe('black')
  })

  it('requests a hint without changing the board', async () => {
    useGameStore.getState().startGame()
    await useGameStore.getState().requestHint()

    const state = useGameStore.getState()
    expect(state.hintPoint).toEqual({ x: 4, y: 4 })
    expect(state.game.moveNumber).toBe(0)
    expect(state.isHinting).toBe(false)
  })

  it('lets the engine open again after undoing its first move', async () => {
    useGameStore.getState().setPlayerColor('white')
    useGameStore.getState().startGame()
    await flush()

    // The engine (black) has opened; taking that move back leaves black to
    // play, so the engine must be asked again or the board stays disabled.
    expect(useGameStore.getState().game.moveNumber).toBe(1)
    useGameStore.getState().undoTurn()
    expect(useGameStore.getState().game.moveNumber).toBe(0)

    await flush()

    const state = useGameStore.getState()
    expect(state.game.moveNumber).toBe(1)
    expect(state.game.board[4 * 15 + 4]).toBe('black')
    expect(state.isAiThinking).toBe(false)
  })

  it('restarts into a fresh game', async () => {
    useGameStore.getState().startGame()
    useGameStore.getState().playAt({ x: 2, y: 2 })
    await flush()
    useGameStore.getState().restartGame()

    const state = useGameStore.getState()
    expect(state.game.moveNumber).toBe(0)
    expect(state.game.board.every((stone) => stone === null)).toBe(true)
  })

  it('persists preferences to localStorage', () => {
    useGameStore.getState().setBoardSize(19)
    useGameStore.getState().setRuleSet('renju')
    useGameStore.getState().setEngineStrength('full')

    const stored = JSON.parse(localStorage.getItem('dufive-preferences-v1') ?? '{}')
    expect(stored.boardSize).toBe(19)
    expect(stored.ruleSet).toBe('renju')
    expect(stored.engineStrength).toBe('full')
  })

  it('falls back to defaults for corrupt stored preferences', () => {
    localStorage.setItem('dufive-preferences-v1', '{not json')
    resetGameStoreForTests()
    useGameStore.setState({ boardSize: 15 })

    const actions = useGameStore.getState()
    actions.setBoardSize(13)
    const stored = JSON.parse(localStorage.getItem('dufive-preferences-v1') ?? '{}')
    expect(stored.boardSize).toBe(13)
  })
})

describe('replay navigation', () => {
  beforeEach(() => {
    localStorage.clear()
    resetGameStoreForTests()
    replaceEngineForTests(new ImmediateEngine())
  })

  it('steps back into the record and forward back to live', async () => {
    useGameStore.getState().startGame()
    useGameStore.getState().playAt({ x: 2, y: 2 })
    await flush()
    expect(useGameStore.getState().game.moveNumber).toBe(2)

    useGameStore.getState().stepByPlies(-1)
    expect(useGameStore.getState().viewPly).toBe(1)

    useGameStore.getState().stepByPlies(-1)
    expect(useGameStore.getState().viewPly).toBe(0)

    useGameStore.getState().stepByPlies(1)
    expect(useGameStore.getState().viewPly).toBe(1)

    // Stepping onto the newest ply returns to the live position.
    useGameStore.getState().stepByPlies(1)
    expect(useGameStore.getState().viewPly).toBeNull()
  })

  it('clamps jumps to the record length', () => {
    useGameStore.getState().startGame()
    useGameStore.getState().playAt({ x: 2, y: 2 })
    useGameStore.getState().setViewPly(99)
    expect(useGameStore.getState().viewPly).toBe(1)
    useGameStore.getState().setViewPly(-4)
    expect(useGameStore.getState().viewPly).toBe(0)
  })

  it('clicking the board while replaying returns to live without playing', async () => {
    useGameStore.getState().startGame()
    useGameStore.getState().playAt({ x: 2, y: 2 })
    await flush()
    useGameStore.getState().stepByPlies(-1)
    expect(useGameStore.getState().viewPly).toBe(1)

    useGameStore.getState().playAt({ x: 5, y: 5 })
    expect(useGameStore.getState().viewPly).toBeNull()
    // Two moves existed (human + engine); the click must not add a third.
    expect(useGameStore.getState().game.moveNumber).toBe(2)
    expect(useGameStore.getState().game.board[5 * 15 + 5]).toBeNull()
  })

  it('refuses to export an empty record', async () => {
    useGameStore.getState().startGame()
    await useGameStore.getState().copyRecord('sgf')
    expect(useGameStore.getState().errorMessage).toContain('没有可导出')
  })

  it('copies a record to the clipboard', async () => {
    // jsdom does not implement the async clipboard API, so stub it.
    const writes: string[] = []
    const descriptor = {
      value: {
        writeText: (text: string) => {
          writes.push(text)
          return Promise.resolve()
        },
      },
      configurable: true,
    }
    Object.defineProperty(navigator, 'clipboard', descriptor)

    try {
      useGameStore.getState().startGame()
      useGameStore.getState().playAt({ x: 7, y: 7 })
      await useGameStore.getState().copyRecord('sgf')
      await useGameStore.getState().copyRecord('text')

      expect(writes[0]).toContain('GM[4]')
      expect(writes[1]).toContain('H8')
    } finally {
      delete (navigator as { clipboard?: unknown }).clipboard
    }
  })
})
