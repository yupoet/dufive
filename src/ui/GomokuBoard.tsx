import {
  useEffect,
  useId,
  useRef,
  useState,
  type KeyboardEvent,
  type MouseEvent,
  type PointerEvent,
} from 'react'
import type {
  Board,
  BoardSize,
  Color,
  Point,
} from '../game/types'
import { COORDINATE_LETTERS } from '../game/record'

export interface GomokuBoardProps {
  readonly size: BoardSize
  readonly board: Board
  readonly toPlay?: Color
  readonly lastMove?: Point | null
  readonly hintPoint?: Point | null
  readonly winLine?: readonly number[]
  readonly forbiddenPoints?: readonly number[]
  readonly disabled?: boolean
  readonly showCoordinates?: boolean
  readonly onPointClick?: (point: Point) => void
}

const GRID_STEP = 24
const BOARD_PADDING = 26

function starPoints(size: BoardSize): readonly Point[] {
  if (size === 13) {
    return [
      { x: 3, y: 3 },
      { x: 9, y: 3 },
      { x: 6, y: 6 },
      { x: 3, y: 9 },
      { x: 9, y: 9 },
    ]
  }
  if (size === 15) {
    return [
      { x: 3, y: 3 },
      { x: 11, y: 3 },
      { x: 7, y: 7 },
      { x: 3, y: 11 },
      { x: 11, y: 11 },
    ]
  }

  const edge = 3
  const centre = 9
  const far = size - 4
  return [edge, centre, far].flatMap((y) => (
    [edge, centre, far].map((x) => ({ x, y }))
  ))
}

function pointEquals(first: Point | null | undefined, x: number, y: number) {
  return first?.x === x && first.y === y
}

function clamp(value: number, minimum: number, maximum: number) {
  return Math.min(maximum, Math.max(minimum, value))
}

function accessiblePointName(
  size: BoardSize,
  x: number,
  y: number,
  stone: Color | null,
  forbidden: boolean,
) {
  const coordinate = `${COORDINATE_LETTERS[x]}${size - y}`
  if (!stone) {
    return forbidden ? `${coordinate}，空位，黑方禁手` : `${coordinate}，空位`
  }
  return `${coordinate}，${stone === 'black' ? '黑棋' : '白棋'}`
}

export function GomokuBoard({
  size,
  board,
  toPlay,
  lastMove = null,
  hintPoint = null,
  winLine = [],
  forbiddenPoints = [],
  disabled = false,
  showCoordinates = true,
  onPointClick,
}: GomokuBoardProps) {
  const id = useId().replaceAll(':', '')
  const svgRef = useRef<SVGSVGElement>(null)
  const [activeIndex, setActiveIndex] = useState(0)
  const [pointerPreview, setPointerPreview] = useState<Point | null>(null)
  const gridLength = GRID_STEP * (size - 1)
  const canvasSize = gridLength + BOARD_PADDING * 2
  const forbidden = new Set(forbiddenPoints)
  const winning = new Set(winLine)
  const focusedIndex = clamp(activeIndex, 0, board.length - 1)
  const intersections = Array.from({ length: size * size }, (_, index) => ({
    index,
    x: index % size,
    y: Math.floor(index / size),
  }))

  // A ghost stone would otherwise stay on the board when the engine takes
  // over mid-hover.
  useEffect(() => {
    if (disabled) setPointerPreview(null)
  }, [disabled])

  if (board.length !== size * size) {
    throw new Error(`Expected ${size * size} intersections for a ${size}×${size} board`)
  }

  const centreOf = (x: number, y: number) => ({
    x: BOARD_PADDING + x * GRID_STEP,
    y: BOARD_PADDING + y * GRID_STEP,
  })

  const activatePoint = (point: Point) => {
    if (!disabled) onPointClick?.(point)
  }

  const handleKeyDown = (
    event: KeyboardEvent<SVGGElement>,
    point: Point,
    index: number,
  ) => {
    if (event.key === 'Enter' || event.key === ' ') {
      event.preventDefault()
      activatePoint(point)
      return
    }

    let nextIndex: number | null = null
    if (event.key === 'ArrowLeft') nextIndex = point.x > 0 ? index - 1 : index
    if (event.key === 'ArrowRight') nextIndex = point.x < size - 1 ? index + 1 : index
    if (event.key === 'ArrowUp') nextIndex = point.y > 0 ? index - size : index
    if (event.key === 'ArrowDown') nextIndex = point.y < size - 1 ? index + size : index
    if (event.key === 'Home') nextIndex = event.ctrlKey ? 0 : point.y * size
    if (event.key === 'End') {
      nextIndex = event.ctrlKey ? board.length - 1 : point.y * size + size - 1
    }
    if (nextIndex === null) return

    event.preventDefault()
    const nextX = nextIndex % size
    const nextY = Math.floor(nextIndex / size)
    setActiveIndex(nextIndex)
    requestAnimationFrame(() => {
      svgRef.current
        ?.querySelector<SVGGElement>(`[data-testid="point-${nextX}-${nextY}"]`)
        ?.focus()
    })
  }

  const pointFromClient = (clientX: number, clientY: number) => {
    const bounds = svgRef.current?.getBoundingClientRect()
    if (!bounds || bounds.width === 0 || bounds.height === 0) return null

    const svgX = (clientX - bounds.left) * canvasSize / bounds.width
    const svgY = (clientY - bounds.top) * canvasSize / bounds.height
    const gridX = (svgX - BOARD_PADDING) / GRID_STEP
    const gridY = (svgY - BOARD_PADDING) / GRID_STEP
    if (
      gridX < -0.5
      || gridX > size - 0.5
      || gridY < -0.5
      || gridY > size - 0.5
    ) {
      return null
    }

    return {
      x: clamp(Math.round(gridX), 0, size - 1),
      y: clamp(Math.round(gridY), 0, size - 1),
    }
  }

  const updatePointerPreview = (event: PointerEvent<SVGSVGElement>) => {
    if (!disabled) setPointerPreview(pointFromClient(event.clientX, event.clientY))
  }

  const handleBoardClick = (event: MouseEvent<SVGSVGElement>) => {
    if (disabled || event.detail === 0) return
    const point = pointFromClient(event.clientX, event.clientY)
    if (point) activatePoint(point)
  }

  const first = winLine[0]
  const last = winLine[winLine.length - 1]

  return (
    <div className="board-wrap" data-size={size}>
      <svg
        ref={svgRef}
        className="gomoku-board"
        data-testid="gomoku-board"
        viewBox={`0 0 ${canvasSize} ${canvasSize}`}
        role="group"
        aria-roledescription="五子棋棋盘"
        aria-label={`${size}×${size} 五子棋棋盘`}
        onClick={handleBoardClick}
        onPointerDown={updatePointerPreview}
        onPointerMove={updatePointerPreview}
        onPointerLeave={() => setPointerPreview(null)}
      >
        <defs>
          <linearGradient id={`${id}-wood`} x1="0" y1="0" x2="1" y2="1">
            <stop offset="0" stopColor="#e8bd72" />
            <stop offset="0.45" stopColor="#d99a4d" />
            <stop offset="1" stopColor="#c9853f" />
          </linearGradient>
          <pattern
            id={`${id}-grain`}
            width="62"
            height="19"
            patternUnits="userSpaceOnUse"
            patternTransform="rotate(-3)"
          >
            <path
              d="M-8 7 C 8 1, 28 14, 68 5 M-5 15 C 20 10, 37 23, 72 12"
              fill="none"
              stroke="#7f451f"
              strokeOpacity="0.12"
              strokeWidth="0.7"
            />
          </pattern>
          <radialGradient id={`${id}-black`} cx="34%" cy="26%" r="72%">
            <stop offset="0" stopColor="#60636a" />
            <stop offset="0.28" stopColor="#24272c" />
            <stop offset="1" stopColor="#050608" />
          </radialGradient>
          <radialGradient id={`${id}-white`} cx="32%" cy="24%" r="76%">
            <stop offset="0" stopColor="#ffffff" />
            <stop offset="0.52" stopColor="#f5f1e9" />
            <stop offset="1" stopColor="#c9c2b6" />
          </radialGradient>
          <filter id={`${id}-stone-shadow`} x="-45%" y="-35%" width="190%" height="205%">
            <feDropShadow
              dx="0.8"
              dy="2"
              stdDeviation="1.5"
              floodColor="#351907"
              floodOpacity="0.48"
            />
          </filter>
          <filter id={`${id}-glow`} x="-100%" y="-100%" width="300%" height="300%">
            <feDropShadow
              dx="0"
              dy="0"
              stdDeviation="2.2"
              floodColor="#fff7ce"
              floodOpacity="0.95"
            />
          </filter>
        </defs>

        <rect
          x="1"
          y="1"
          width={canvasSize - 2}
          height={canvasSize - 2}
          rx="9"
          fill={`url(#${id}-wood)`}
        />
        <rect
          x="1"
          y="1"
          width={canvasSize - 2}
          height={canvasSize - 2}
          rx="9"
          fill={`url(#${id}-grain)`}
        />
        <rect
          className="board-rim"
          x="3.5"
          y="3.5"
          width={canvasSize - 7}
          height={canvasSize - 7}
          rx="7"
        />

        <g className="board-grid" aria-hidden="true">
          {Array.from({ length: size }, (_, index) => {
            const offset = BOARD_PADDING + index * GRID_STEP
            return (
              <g key={index}>
                <line
                  x1={BOARD_PADDING}
                  y1={offset}
                  x2={BOARD_PADDING + gridLength}
                  y2={offset}
                />
                <line
                  x1={offset}
                  y1={BOARD_PADDING}
                  x2={offset}
                  y2={BOARD_PADDING + gridLength}
                />
              </g>
            )
          })}
        </g>

        {showCoordinates && (
          <g className="board-coordinates" aria-hidden="true">
            {Array.from({ length: size }, (_, index) => {
              const offset = BOARD_PADDING + index * GRID_STEP
              return (
                <g key={index}>
                  <text x={offset} y="16">{COORDINATE_LETTERS[index]}</text>
                  <text x={offset} y={canvasSize - 8}>{COORDINATE_LETTERS[index]}</text>
                  <text x="13" y={offset + 3}>{size - index}</text>
                  <text x={canvasSize - 13} y={offset + 3}>{size - index}</text>
                </g>
              )
            })}
          </g>
        )}

        <g className="board-stars" aria-hidden="true">
          {starPoints(size).map(({ x, y }) => {
            const centre = centreOf(x, y)
            return (
              <circle
                key={`${x}-${y}`}
                cx={centre.x}
                cy={centre.y}
                r="2.25"
              />
            )
          })}
        </g>

        {first !== undefined && last !== undefined && (
          <g className="board-win-line" aria-hidden="true">
            <line
              x1={centreOf(first % size, Math.floor(first / size)).x}
              y1={centreOf(first % size, Math.floor(first / size)).y}
              x2={centreOf(last % size, Math.floor(last / size)).x}
              y2={centreOf(last % size, Math.floor(last / size)).y}
            />
          </g>
        )}

        <g className="board-points">
          {intersections.map(({ index, x, y }) => {
            const stone = board[index] ?? null
            const centre = centreOf(x, y)
            const isLast = pointEquals(lastMove, x, y)
            const isHint = pointEquals(hintPoint, x, y)
            const isPreview = pointEquals(pointerPreview, x, y)
            const isForbidden = forbidden.has(index)
            const isWinning = winning.has(index)
            const point = { x, y }

            return (
              <g
                className={[
                  'board-point',
                  stone ? `has-${stone}` : 'is-empty',
                  isHint ? 'is-hint' : '',
                  isPreview ? 'is-pointer-preview' : '',
                  isWinning ? 'is-winning' : '',
                ].filter(Boolean).join(' ')}
                data-testid={`point-${x}-${y}`}
                key={index}
                role="button"
                // The roving tab stop stays reachable while the engine thinks
                // and after the game ends, so the board can still be reviewed
                // from the keyboard. Activation itself is guarded by `disabled`.
                tabIndex={index === focusedIndex ? 0 : -1}
                aria-disabled={disabled}
                aria-label={accessiblePointName(size, x, y, stone, isForbidden)}
                onFocus={() => setActiveIndex(index)}
                onKeyDown={(event) => handleKeyDown(event, point, index)}
              >
                <rect
                  className="board-hit-area"
                  x={centre.x - GRID_STEP / 2}
                  y={centre.y - GRID_STEP / 2}
                  width={GRID_STEP}
                  height={GRID_STEP}
                />
                {isPreview && !stone && toPlay && (isForbidden ? (
                  <g className="board-forbidden-preview" aria-hidden="true">
                    <line
                      x1={centre.x - 5}
                      y1={centre.y - 5}
                      x2={centre.x + 5}
                      y2={centre.y + 5}
                    />
                    <line
                      x1={centre.x + 5}
                      y1={centre.y - 5}
                      x2={centre.x - 5}
                      y2={centre.y + 5}
                    />
                  </g>
                ) : (
                  <circle
                    className={`board-stone-preview board-stone-preview--${toPlay}`}
                    cx={centre.x}
                    cy={centre.y}
                    r={GRID_STEP * 0.39}
                    fill={`url(#${id}-${toPlay})`}
                  />
                ))}
                {stone && (
                  <circle
                    className="board-stone"
                    cx={centre.x}
                    cy={centre.y}
                    r={GRID_STEP * 0.43}
                    fill={`url(#${id}-${stone})`}
                    filter={`url(#${id}-stone-shadow)`}
                  />
                )}
                {isLast && stone && (
                  <circle
                    className="board-last-move"
                    cx={centre.x}
                    cy={centre.y}
                    r="3.3"
                  />
                )}
                {isHint && (
                  <g className="board-hint" filter={`url(#${id}-glow)`}>
                    <circle cx={centre.x} cy={centre.y} r="7.5" />
                    {!stone && <circle cx={centre.x} cy={centre.y} r="2.2" />}
                  </g>
                )}
              </g>
            )
          })}
        </g>
      </svg>

      {toPlay && (
        <div className="board-turn-a11y" aria-live="polite">
          轮到{toPlay === 'black' ? '黑方' : '白方'}
        </div>
      )}
    </div>
  )
}

export default GomokuBoard
