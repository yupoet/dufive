import { useEffect, useRef } from 'react'
import type { GameState } from '../game/types'
import { moveNotation } from '../game/record'

export interface MoveListProps {
  readonly game: GameState
  /** Null while showing the live position. */
  readonly viewPly: number | null
  readonly hasNewMoves: boolean
  readonly onJumpToPly: (ply: number) => void
  readonly onStep: (plies: number) => void
  readonly onJumpToLive: () => void
  readonly onCopy: (format: 'sgf' | 'text') => void
}

export function MoveList({
  game,
  viewPly,
  hasNewMoves,
  onJumpToPly,
  onStep,
  onJumpToLive,
  onCopy,
}: MoveListProps) {
  const listRef = useRef<HTMLDivElement>(null)
  const currentPly = viewPly ?? game.moves.length
  const replaying = viewPly !== null

  useEffect(() => {
    const list = listRef.current
    if (!list) return
    const active = list.querySelector<HTMLElement>('[data-active="true"]')
    active?.scrollIntoView({ block: 'nearest' })
  }, [currentPly])

  return (
    <section className="move-list" aria-label="棋谱">
      <div className="move-list__header">
        <strong>棋谱</strong>
        <span>{game.moves.length} 手</span>
      </div>

      <div className="move-list__nav">
        <button
          type="button"
          data-testid="replay-start"
          disabled={currentPly === 0}
          aria-label="回到开局"
          onClick={() => onJumpToPly(0)}
        >
          ⏮
        </button>
        <button
          type="button"
          data-testid="replay-back"
          disabled={currentPly === 0}
          aria-label="上一手"
          onClick={() => onStep(-1)}
        >
          ◀
        </button>
        <span className="move-list__counter" data-testid="replay-counter">
          {currentPly} / {game.moves.length}
        </span>
        <button
          type="button"
          data-testid="replay-forward"
          disabled={currentPly >= game.moves.length}
          aria-label="下一手"
          onClick={() => onStep(1)}
        >
          ▶
        </button>
        <button
          type="button"
          data-testid="replay-live"
          className={hasNewMoves && replaying ? 'has-new' : ''}
          disabled={!replaying}
          aria-label="回到最新局面"
          onClick={onJumpToLive}
        >
          {hasNewMoves && replaying ? '最新 ●' : '最新'}
        </button>
      </div>

      <div className="move-list__entries" ref={listRef} role="list">
        {game.moves.length === 0 && (
          <p className="move-list__empty">落子之后，这里会记录每一手。</p>
        )}
        {game.moves.map((move, index) => {
          const ply = index + 1
          return (
            <button
              type="button"
              role="listitem"
              key={ply}
              className={`move-list__move move-list__move--${move.color}`}
              data-active={ply === currentPly && replaying}
              data-testid={`move-${ply}`}
              onClick={() => (ply === game.moves.length ? onJumpToLive() : onJumpToPly(ply))}
            >
              <small>{ply}</small>
              {moveNotation(move, game.size)}
            </button>
          )
        })}
      </div>

      <div className="move-list__export">
        <button type="button" data-testid="copy-text" onClick={() => onCopy('text')}>
          复制着法
        </button>
        <button type="button" data-testid="copy-sgf" onClick={() => onCopy('sgf')}>
          复制 SGF
        </button>
      </div>
    </section>
  )
}

export default MoveList
