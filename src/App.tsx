import { useMemo } from 'react'
import { forbiddenIndexes } from './game/forbidden'
import { boardAtPly, moveAtPly } from './game/record'
import { useGameStore } from './state/gameStore'
import type { EngineKind } from './engine'
import {
  GameView,
  MainMenu,
  type EngineStatusTone,
} from './ui'

const RULE_LABELS = {
  free: '无禁手',
  renju: '黑方禁手',
} as const

const ENGINE_LABELS: Record<EngineKind, string> = {
  'built-in': '内置引擎 · 本地离线',
  rapfi: 'Rapfi · 本地离线',
}

function statusText(
  status: ReturnType<typeof useGameStore.getState>['engineStatus'],
  version: string | null,
  localGame: boolean,
  choice: EngineKind,
): string {
  if (localGame) return '本地双人'
  if (status === 'loading') return choice === 'rapfi' ? 'Rapfi 加载中' : '引擎加载中'
  if (status === 'thinking') return '本机思考中'
  if (status === 'fallback') return '离线兼容模式'
  if (status === 'error') return '引擎待重试'
  if (status === 'ready') {
    return version ? `${choice === 'rapfi' ? 'Rapfi' : '帕里斯'} ${version}` : '引擎就绪'
  }
  return ENGINE_LABELS[choice]
}

function statusTone(
  status: ReturnType<typeof useGameStore.getState>['engineStatus'],
  localGame: boolean,
): EngineStatusTone {
  if (localGame) return 'offline'
  if (status === 'loading') return 'loading'
  if (status === 'thinking') return 'thinking'
  if (status === 'fallback') return 'offline'
  if (status === 'error') return 'error'
  return 'ready'
}

export default function App() {
  const screen = useGameStore((state) => state.screen)
  const boardSize = useGameStore((state) => state.boardSize)
  const gameMode = useGameStore((state) => state.gameMode)
  const playerColor = useGameStore((state) => state.playerColor)
  const engineStrength = useGameStore((state) => state.engineStrength)
  const engineChoice = useGameStore((state) => state.engineChoice)
  const ruleSet = useGameStore((state) => state.ruleSet)
  const game = useGameStore((state) => state.game)
  const humanColor = useGameStore((state) => state.humanColor)
  const engineStatus = useGameStore((state) => state.engineStatus)
  const engineVersion = useGameStore((state) => state.engineVersion)
  const isAiThinking = useGameStore((state) => state.isAiThinking)
  const isHinting = useGameStore((state) => state.isHinting)
  const hintPoint = useGameStore((state) => state.hintPoint)
  const viewPly = useGameStore((state) => state.viewPly)
  const parisText = useGameStore((state) => state.parisText)
  const errorMessage = useGameStore((state) => state.errorMessage)
  const setViewPly = useGameStore((state) => state.setViewPly)
  const stepByPlies = useGameStore((state) => state.stepByPlies)
  const jumpToLive = useGameStore((state) => state.jumpToLive)
  const copyRecord = useGameStore((state) => state.copyRecord)
  const setBoardSize = useGameStore((state) => state.setBoardSize)
  const setGameMode = useGameStore((state) => state.setGameMode)
  const setPlayerColor = useGameStore((state) => state.setPlayerColor)
  const setEngineStrength = useGameStore((state) => state.setEngineStrength)
  const setEngineChoice = useGameStore((state) => state.setEngineChoice)
  const setRuleSet = useGameStore((state) => state.setRuleSet)
  const startGame = useGameStore((state) => state.startGame)
  const exitToMenu = useGameStore((state) => state.exitToMenu)
  const restartGame = useGameStore((state) => state.restartGame)
  const playAt = useGameStore((state) => state.playAt)
  const requestHint = useGameStore((state) => state.requestHint)
  const undoTurn = useGameStore((state) => state.undoTurn)
  const resignGame = useGameStore((state) => state.resignGame)

  // Only renju black has forbidden points, and only they need markers.
  const forbiddenPoints = useMemo(() => (
    ruleSet === 'renju'
      ? forbiddenIndexes(game.board, game.size, game.toPlay)
      : []
  ), [game.board, game.size, game.toPlay, ruleSet])

  const replaying = viewPly !== null
  const displayBoard = useMemo(
    () => (replaying ? boardAtPly(game, viewPly) : game.board),
    [game, replaying, viewPly],
  )
  const replayMove = replaying ? moveAtPly(game, viewPly) : null
  const displayLastMove = replaying
    ? (replayMove ? replayMove.point : null)
    : (game.lastMove ? game.lastMove.point : null)
  const displayWinLine = replaying ? [] : game.winLine
  const hasNewMoves = replaying && game.moves.length > (viewPly ?? 0)

  if (screen === 'menu') {
    return (
      <MainMenu
        boardSize={boardSize}
        gameMode={gameMode}
        playerColor={playerColor}
        engineStrength={engineStrength}
        engineChoice={engineChoice}
        ruleSet={ruleSet}
        engineReady
        engineLabel={ENGINE_LABELS[engineChoice]}
        onBoardSizeChange={setBoardSize}
        onGameModeChange={setGameMode}
        onPlayerColorChange={setPlayerColor}
        onEngineStrengthChange={setEngineStrength}
        onEngineChoiceChange={setEngineChoice}
        onRuleSetChange={setRuleSet}
        onStart={startGame}
      />
    )
  }

  const localGame = gameMode === 'local-two-player'
  const waitingForEngine = !localGame
    && game.phase === 'playing'
    && game.toPlay !== humanColor

  const resultText = game.winner === 'draw'
    ? '棋盘下满，和棋。'
    : game.winner
      ? game.finishReason === 'resignation'
        ? `${game.resignedBy === 'black' ? '黑方' : '白方'}认输，${game.winner === 'black' ? '黑方' : '白方'}获胜`
        : `${game.winner === 'black' ? '黑方' : '白方'}五子连珠`
      : null

  const leaveGame = () => {
    if (
      game.phase === 'finished'
      || game.moveNumber === 0
      || window.confirm('退出后本局进度不会保留，确定返回棋院吗？')
    ) {
      exitToMenu()
    }
  }

  const restartWithConfirmation = () => {
    if (
      game.phase === 'finished'
      || game.moveNumber === 0
      || window.confirm('重开会清空本局棋谱，确定吗？')
    ) {
      restartGame()
    }
  }

  const resignWithConfirmation = () => {
    if (window.confirm('确定认输并结束这一局吗？')) resignGame()
  }

  return (
    <GameView
      size={game.size}
      board={displayBoard}
      game={game}
      viewPly={viewPly}
      hasNewMoves={hasNewMoves}
      toPlay={game.toPlay}
      moveNumber={game.moveNumber}
      phase={game.phase}
      lastMove={displayLastMove}
      hintPoint={hintPoint}
      winLine={displayWinLine}
      forbiddenPoints={replaying ? [] : forbiddenPoints}
      boardDisabled={isAiThinking || waitingForEngine}
      engineStatus={statusText(engineStatus, engineVersion, localGame, engineChoice)}
      engineStatusTone={statusTone(engineStatus, localGame)}
      parisText={parisText}
      errorMessage={errorMessage}
      resultText={resultText}
      canHint={!isAiThinking && !isHinting}
      canUndo={game.history.length > 0}
      canResign={game.phase !== 'finished'}
      canRestart
      hinting={isHinting}
      ruleLabel={RULE_LABELS[ruleSet]}
      replaying={replaying}
      onPointClick={playAt}
      onJumpToPly={setViewPly}
      onStep={stepByPlies}
      onJumpToLive={jumpToLive}
      onCopyRecord={(format) => void copyRecord(format)}
      onHint={() => void requestHint()}
      onUndo={undoTurn}
      onResign={resignWithConfirmation}
      onRestart={restartWithConfirmation}
      onExit={leaveGame}
    />
  )
}
