import type {
  Board,
  BoardSize,
  Color,
  GamePhase,
  Point,
} from '../game/types'
import GomokuBoard from './GomokuBoard'
import Hud, { type EngineStatusTone } from './Hud'

export interface GameViewProps {
  readonly size: BoardSize
  readonly board: Board
  readonly toPlay: Color
  readonly moveNumber: number
  readonly phase: GamePhase
  readonly lastMove?: Point | null
  readonly hintPoint?: Point | null
  readonly winLine?: readonly number[]
  readonly forbiddenPoints?: readonly number[]
  readonly boardDisabled?: boolean
  readonly engineStatus: string
  readonly engineStatusTone?: EngineStatusTone
  readonly parisText: string
  readonly errorMessage?: string | null
  readonly resultText?: string | null
  readonly canHint?: boolean
  readonly canUndo?: boolean
  readonly canResign?: boolean
  readonly canRestart?: boolean
  readonly hinting?: boolean
  readonly ruleLabel: string
  readonly onPointClick: (point: Point) => void
  readonly onHint: () => void
  readonly onUndo: () => void
  readonly onResign: () => void
  readonly onRestart: () => void
  readonly onExit: () => void
}

export function GameView({
  size,
  board,
  toPlay,
  moveNumber,
  phase,
  lastMove = null,
  hintPoint = null,
  winLine = [],
  forbiddenPoints = [],
  boardDisabled = false,
  engineStatus,
  engineStatusTone = 'ready',
  parisText,
  errorMessage = null,
  resultText = null,
  canHint = true,
  canUndo = true,
  canResign = true,
  canRestart = true,
  hinting = false,
  ruleLabel,
  onPointClick,
  onHint,
  onUndo,
  onResign,
  onRestart,
  onExit,
}: GameViewProps) {
  return (
    <main className="game-view">
      <header className="game-topbar">
        <div className="game-brand">
          <span className="game-brand__mark" aria-hidden="true">◉</span>
          <span>
            <strong>嘟嘟五子棋</strong>
            <small>{size}×{size} · {ruleLabel}</small>
          </span>
        </div>
        <div className="game-topbar__move">
          {phase === 'finished' ? '终局' : `第 ${moveNumber + 1} 手`}
        </div>
      </header>

      <div className="game-layout">
        <section className="board-stage" aria-label="棋盘区域">
          <div className="board-stage__halo" aria-hidden="true" />
          <GomokuBoard
            size={size}
            board={board}
            toPlay={toPlay}
            lastMove={lastMove}
            hintPoint={hintPoint}
            winLine={winLine}
            forbiddenPoints={forbiddenPoints}
            disabled={boardDisabled || phase === 'finished'}
            onPointClick={onPointClick}
          />
          {errorMessage && (
            <p className="game-error" role="alert">{errorMessage}</p>
          )}
        </section>

        <div className="game-sidebar">
          <Hud
            toPlay={toPlay}
            moveNumber={moveNumber}
            finished={phase === 'finished'}
            engineStatus={engineStatus}
            engineStatusTone={engineStatusTone}
            parisText={parisText}
            canHint={canHint}
            canUndo={canUndo}
            canResign={canResign}
            canRestart={canRestart}
            hinting={hinting}
            onHint={onHint}
            onUndo={onUndo}
            onResign={onResign}
            onRestart={onRestart}
            onExit={onExit}
          />

          {phase === 'finished' && resultText && (
            <section className="game-result-card" role="status">
              <span className="game-result-card__mark" aria-hidden="true">◉</span>
              <div>
                <p className="eyebrow">本局结束</p>
                <h2>{resultText}</h2>
              </div>
            </section>
          )}
        </div>
      </div>
    </main>
  )
}

export default GameView
