import type {
  Board,
  Color,
  GameState,
  MoveRecord,
  Point,
  Stone,
} from './types'

/** Column labels shared by the board, the move list and exports. The letter
 * `I` is skipped, following board-game convention. */
export const COORDINATE_LETTERS = 'ABCDEFGHJKLMNOPQRST'

/** SGF coordinates use consecutive lowercase letters with no `I` skip. */
const SGF_LETTERS = 'abcdefghijklmnopqrstuvwxyz'

/** The board after `ply` moves: stones from `moves[0..ply)`. */
export function boardAtPly(state: GameState, ply: number): Board {
  const total = Math.min(Math.max(ply, 0), state.moves.length)
  const board = Array<Stone>(state.size * state.size).fill(null)

  for (let index = 0; index < total; index += 1) {
    const move = state.moves[index]
    if (move) board[move.point.y * state.size + move.point.x] = move.color
  }

  return board
}

/** The last move shown at a given ply, for the marker on the board. */
export function moveAtPly(state: GameState, ply: number): MoveRecord | null {
  const total = Math.min(Math.max(ply, 0), state.moves.length)
  return total > 0 ? state.moves[total - 1] ?? null : null
}

/** Human notation matching the board labels: column letter plus row number,
 * counted from the bottom, so the centre of 15×15 is `H8`. */
export function moveNotation(move: MoveRecord, size: number): string {
  return `${COORDINATE_LETTERS[move.point.x]}${size - move.point.y}`
}

/**
 * SGF export. Gomoku uses `GM[4]`; SGF coordinates are lowercase letters with
 * the column first and rows counted from the top, which matches the app's
 * `index = y * size + x` layout directly.
 */
export function serializeSgf(state: GameState): string {
  const properties = [
    '(;GM[4]',
    'FF[4]',
    `CA[UTF-8]`,
    `SZ[${state.size}]`,
    `RU[${state.ruleSet === 'renju' ? 'renju' : 'freestyle'}]`,
    'PB[黑方]',
    'PW[白方]',
  ]

  if (state.winner === 'draw') properties.push('RE[0]')
  else if (state.winner) properties.push(`RE[${state.winner === 'black' ? 'B' : 'W'}]`)

  const moves = state.moves
    .map((move) => `;${move.color === 'black' ? 'B' : 'W'}[${SGF_LETTERS[move.point.x]}${SGF_LETTERS[move.point.y]}]`)
    .join('')

  return `${properties.join('')}${moves})`
}

/** Plain-text move list, one line per pair of moves. */
export function serializeMoveList(state: GameState): string {
  const lines: string[] = []
  for (let index = 0; index < state.moves.length; index += 2) {
    const black = state.moves[index]
    const white = state.moves[index + 1]
    const pair = `${moveNotation(black, state.size)}${white ? `　${moveNotation(white, state.size)}` : ''}`
    lines.push(`${index / 2 + 1}. ${pair}`)
  }

  const header = `${state.size}×${state.size} ${state.ruleSet === 'renju' ? '黑方禁手' : '无禁手'}`
  const result = state.winner === 'draw'
    ? '和棋'
    : state.winner
      ? `${state.winner === 'black' ? '黑' : '白'}胜${state.finishReason === 'resignation' ? '（认输）' : ''}`
      : '对局中'

  return [`嘟嘟五子棋 · ${header}`, `共 ${state.moves.length} 手 · ${result}`, '', ...lines].join('\n')
}

/** Both export formats, ready for the clipboard. */
export function exportRecord(state: GameState): { readonly sgf: string; readonly text: string } {
  return { sgf: serializeSgf(state), text: serializeMoveList(state) }
}

export function pointToNotation(point: Point, size: number, color: Color): string {
  return moveNotation({ number: 0, color, point }, size)
}
