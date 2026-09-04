import { BLACK, EMPTY, WHITE, type Cell } from './evaluate'
import { indexToPoint } from '../game/board'
import type { Board, BoardSize, Point, Stone } from '../game/types'

/** Converts the rules-layer board into the numeric board the search uses. */
export function encodeBoard(board: Board): Uint8Array {
  const cells = new Uint8Array(board.length)
  for (let index = 0; index < board.length; index += 1) {
    const stone: Stone = board[index] ?? null
    cells[index] = stone === 'black' ? BLACK : stone === 'white' ? WHITE : EMPTY
  }
  return cells
}

export function encodeColor(color: 'black' | 'white'): Cell {
  return color === 'black' ? BLACK : WHITE
}

export function decodePoint(index: number, size: BoardSize): Point {
  return indexToPoint(index, size)
}

export function isPlayableCell(value: number | undefined): boolean {
  return value === BLACK || value === WHITE
}
