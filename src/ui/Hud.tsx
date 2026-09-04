import type { Color } from '../game/types'

export type EngineStatusTone =
  | 'ready'
  | 'thinking'
  | 'loading'
  | 'error'
  | 'offline'

export interface HudProps {
  readonly toPlay: Color
  readonly moveNumber: number
  readonly finished: boolean
  readonly engineStatus: string
  readonly engineStatusTone?: EngineStatusTone
  readonly parisText: string
  readonly canHint?: boolean
  readonly canUndo?: boolean
  readonly canResign?: boolean
  readonly canRestart?: boolean
  readonly hinting?: boolean
  readonly onHint: () => void
  readonly onUndo: () => void
  readonly onResign: () => void
  readonly onRestart: () => void
  readonly onExit: () => void
}

function colorName(color: Color) {
  return color === 'black' ? '黑方' : '白方'
}

export function Hud({
  toPlay,
  moveNumber,
  finished,
  engineStatus,
  engineStatusTone = 'ready',
  parisText,
  canHint = true,
  canUndo = true,
  canResign = true,
  canRestart = true,
  hinting = false,
  onHint,
  onUndo,
  onResign,
  onRestart,
  onExit,
}: HudProps) {
  return (
    <aside className="game-hud" aria-label="对局信息和操作">
      <div className="hud-status-row">
        <div className="turn-status">
          <span className={`mini-stone mini-stone--${toPlay}`} aria-hidden="true" />
          <span>
            <small>第 {moveNumber + 1} 手</small>
            <strong>{finished ? '对局结束' : `${colorName(toPlay)}落子`}</strong>
          </span>
        </div>
        <div
          className={`engine-status engine-status--${engineStatusTone}`}
          data-testid="engine-status"
          role="status"
        >
          <span aria-hidden="true" />
          {engineStatus}
        </div>
      </div>

      <section className="paris-card" aria-labelledby="paris-title">
        <div className="paris-avatar" aria-hidden="true">
          <span>帕</span>
        </div>
        <div>
          <div className="paris-card__title">
            <strong id="paris-title">棋魂帕里斯</strong>
            <span>陪练中</span>
          </div>
          <p aria-live="polite">{parisText}</p>
        </div>
      </section>

      <div className="game-actions">
        <button
          className="game-action game-action--accent"
          data-testid="hint"
          type="button"
          disabled={!canHint || finished || hinting}
          onClick={onHint}
        >
          <span aria-hidden="true">{hinting ? '…' : '✦'}</span>
          <strong>{hinting ? '思考中' : '提示'}</strong>
        </button>
        <button
          className="game-action"
          data-testid="undo"
          type="button"
          disabled={!canUndo}
          onClick={onUndo}
        >
          <span aria-hidden="true">↶</span>
          <strong>撤销</strong>
        </button>
        <button
          className="game-action"
          data-testid="restart"
          type="button"
          disabled={!canRestart}
          onClick={onRestart}
        >
          <span aria-hidden="true">⟳</span>
          <strong>重开</strong>
        </button>
        <button
          className="game-action game-action--danger"
          data-testid="resign"
          type="button"
          disabled={!canResign || finished}
          onClick={onResign}
        >
          <span aria-hidden="true">◇</span>
          <strong>认输</strong>
        </button>
      </div>

      <button
        className="exit-game-button"
        data-testid="exit"
        type="button"
        onClick={onExit}
      >
        <span aria-hidden="true">←</span>
        退出到棋院
      </button>
    </aside>
  )
}

export default Hud
