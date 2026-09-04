export const BOARD_SIZES = [13, 15, 19] as const

export type BoardSize = (typeof BOARD_SIZES)[number]
export type Color = 'black' | 'white'
export type Stone = Color | null
export type Board = readonly Stone[]
export type GamePhase = 'playing' | 'finished'
export type FinishReason = 'five' | 'resignation' | 'draw' | null

/** `free` has no restrictions; `renju` forbids overline, double-four and
 * double-three for black only, and a black overline does not win. */
export type RuleSet = 'free' | 'renju'

export interface Point {
  readonly x: number
  readonly y: number
}

export interface MoveRecord {
  readonly number: number
  readonly color: Color
  readonly point: Point
}

export interface GameFrame {
  readonly size: BoardSize
  readonly ruleSet: RuleSet
  readonly board: Board
  readonly toPlay: Color
  readonly moveNumber: number
  readonly phase: GamePhase
  readonly winner: Color | 'draw' | null
  readonly winLine: readonly number[]
  readonly finishReason: FinishReason
  readonly resignedBy: Color | null
  readonly moves: readonly MoveRecord[]
  readonly lastMove: MoveRecord | null
}

export interface GameState extends GameFrame {
  readonly revision: number
  readonly history: readonly GameFrame[]
}

export type GameErrorCode =
  | 'finished'
  | 'out-of-bounds'
  | 'occupied'
  | 'forbidden'
  | 'nothing-to-undo'

export interface GameError {
  readonly code: GameErrorCode
  readonly message: string
}

export type GameResult =
  | {
      readonly ok: true
      readonly state: GameState
    }
  | {
      readonly ok: false
      readonly state: GameState
      readonly error: GameError
    }
