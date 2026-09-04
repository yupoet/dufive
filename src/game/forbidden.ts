import { DIRECTIONS, isOnBoard, runThrough } from './board'
import type { Board, BoardSize, Color, Point } from './types'

export type ForbiddenKind = 'overline' | 'double-four' | 'double-three'

export const FORBIDDEN_LABELS: Record<ForbiddenKind, string> = {
  overline: '长连',
  'double-four': '双四',
  'double-three': '双三',
}

const MAX_OFFSET = 4

function offsetsInDirection(
  size: BoardSize,
  index: number,
  dx: number,
  dy: number,
): number[] {
  const x = index % size
  const y = Math.floor(index / size)
  const result: number[] = []

  for (let offset = -MAX_OFFSET; offset <= MAX_OFFSET; offset += 1) {
    if (offset === 0) continue
    const nextX = x + dx * offset
    const nextY = y + dy * offset
    if (!isOnBoard({ x: nextX, y: nextY }, size)) continue
    result.push(nextY * size + nextX)
  }

  return result
}

/** The cell one step from `index` along `(dx, dy)`, or null if off the board. */
function stepFrom(
  size: BoardSize,
  index: number,
  dx: number,
  dy: number,
  sign: 1 | -1,
): number | null {
  const x = (index % size) + dx * sign
  const y = Math.floor(index / size) + dy * sign
  if (!isOnBoard({ x, y }, size)) return null
  return y * size + x
}

/**
 * Identifies a shape by the stones that form it, so two different ways of
 * completing the same four count once while two genuinely different fours in
 * one line count twice.
 */
function shapeKey(indexes: readonly number[]): string {
  return [...indexes].sort((first, second) => first - second).join(',')
}

/** Length of the run that `color` would make by playing `cell`. */
function runLengthAfter(
  board: readonly (string | null)[],
  size: BoardSize,
  cell: number,
  color: Color,
  dx: number,
  dy: number,
): number {
  const next = [...board]
  next[cell] = color
  return runThrough(next, size, cell, { dx, dy }).length
}

/**
 * Distinct fours in one direction. A four is a shape that can be completed to
 * exactly five: overlines do not count, because black may not win with six or
 * more.
 */
function directionFours(
  board: readonly (string | null)[],
  size: BoardSize,
  index: number,
  color: Color,
  dx: number,
  dy: number,
): Set<string> {
  const keys = new Set<string>()

  for (const candidate of offsetsInDirection(size, index, dx, dy)) {
    if (board[candidate] !== null) continue

    const next = [...board]
    next[candidate] = color
    const run = runThrough(next, size, candidate, { dx, dy })
    if (run.length !== 5 || !run.includes(index)) continue

    keys.add(shapeKey(run.filter((cell) => cell !== candidate)))
  }

  return keys
}

/**
 * A true open four: both ends are empty *and* completing at either end makes
 * exactly five. `_XXXX_` next to a stray stone is only an apparent open four,
 * because completing towards the stray stone yields an overline.
 */
function isTrueOpenFour(
  board: readonly (string | null)[],
  size: BoardSize,
  run: readonly number[],
  color: Color,
  dx: number,
  dy: number,
): boolean {
  const first = run[0]
  const last = run[run.length - 1]
  if (first === undefined || last === undefined) return false

  const before = stepFrom(size, first, dx, dy, -1)
  const after = stepFrom(size, last, dx, dy, 1)
  if (before === null || after === null) return false
  if (board[before] !== null || board[after] !== null) return false

  return runLengthAfter(board, size, before, color, dx, dy) === 5
    && runLengthAfter(board, size, after, color, dx, dy) === 5
}

/**
 * Distinct open threes in one direction: shapes that become a true open four
 * by adding one stone. "False threes" that can only become an apparent open
 * four are excluded.
 */
function directionOpenThrees(
  board: readonly (string | null)[],
  size: BoardSize,
  index: number,
  color: Color,
  dx: number,
  dy: number,
): Set<string> {
  const keys = new Set<string>()

  for (const candidate of offsetsInDirection(size, index, dx, dy)) {
    if (board[candidate] !== null) continue

    const next = [...board]
    next[candidate] = color
    const run = runThrough(next, size, candidate, { dx, dy })
    if (run.length !== 4 || !run.includes(index)) continue
    if (!isTrueOpenFour(next, size, run, color, dx, dy)) continue

    keys.add(shapeKey(run.filter((cell) => cell !== candidate)))
  }

  return keys
}

/**
 * Renju forbidden-move detection for black. Returns the reason the move is
 * illegal, or `null` when the move is allowed.
 *
 * Five in a row always wins and therefore never counts as forbidden, whichever
 * direction it appears in: every direction is scanned for an exact five before
 * an overline in another direction is reported.
 */
export function forbiddenReason(
  board: Board,
  size: BoardSize,
  point: Point,
  color: Color,
): ForbiddenKind | null {
  if (color !== 'black') return null

  const index = point.y * size + point.x
  if (board[index] !== null) return null

  const next: (string | null)[] = [...board]
  next[index] = color

  let fours = 0
  let openThrees = 0
  let overline = false

  for (const { dx, dy } of DIRECTIONS) {
    const run = runThrough(next, size, index, { dx, dy })
    if (run.length === 5) return null
    if (run.length >= 6) overline = true

    fours += directionFours(next, size, index, color, dx, dy).size
    openThrees += directionOpenThrees(next, size, index, color, dx, dy).size
  }

  if (fours >= 2) return 'double-four'
  if (openThrees >= 2) return 'double-three'
  if (overline) return 'overline'
  return null
}

export function isForbidden(
  board: Board,
  size: BoardSize,
  point: Point,
  color: Color,
): boolean {
  return forbiddenReason(board, size, point, color) !== null
}

/** Every empty point that black may not play under renju rules. */
export function forbiddenIndexes(
  board: Board,
  size: BoardSize,
  color: Color,
): number[] {
  if (color !== 'black') return []

  const indexes: number[] = []
  for (let index = 0; index < board.length; index += 1) {
    if (board[index] !== null) continue
    const point: Point = {
      x: index % size,
      y: Math.floor(index / size),
    }
    if (forbiddenReason(board, size, point, color)) indexes.push(index)
  }

  return indexes
}
