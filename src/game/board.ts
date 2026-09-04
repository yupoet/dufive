import type { BoardSize, Point } from './types'

export const DIRECTIONS = [
  { dx: 1, dy: 0 },
  { dx: 0, dy: 1 },
  { dx: 1, dy: 1 },
  { dx: 1, dy: -1 },
] as const

export function isOnBoard(point: Point, size: BoardSize): boolean {
  return point.x >= 0
    && point.y >= 0
    && point.x < size
    && point.y < size
}

export function pointToIndex(point: Point, size: BoardSize): number {
  return point.y * size + point.x
}

export function indexToPoint(index: number, size: BoardSize): Point {
  return { x: index % size, y: Math.floor(index / size) }
}

export function opponent(color: 'black' | 'white'): 'black' | 'white' {
  return color === 'black' ? 'white' : 'black'
}

/**
 * Collects every occupied or empty index within `radius` steps of a stone,
 * ordered by board index. The AI uses this to keep its candidate list small.
 */
export function neighborIndexes(
  board: ArrayLike<unknown>,
  size: number,
  radius = 2,
): number[] {
  const found = new Set<number>()

  for (let index = 0; index < board.length; index += 1) {
    if (!board[index]) continue
    const x = index % size
    const y = Math.floor(index / size)

    for (let dy = -radius; dy <= radius; dy += 1) {
      for (let dx = -radius; dx <= radius; dx += 1) {
        const nextX = x + dx
        const nextY = y + dy
        if (nextX < 0 || nextY < 0 || nextX >= size || nextY >= size) continue
        found.add(nextY * size + nextX)
      }
    }
  }

  return [...found].sort((first, second) => first - second)
}

/**
 * Returns the indexes of the maximal run of `color` through `index` along one
 * direction, or an empty array when `index` does not hold `color`.
 */
export function runThrough(
  board: readonly unknown[],
  size: BoardSize,
  index: number,
  direction: { readonly dx: number; readonly dy: number },
): number[] {
  const color = board[index]
  if (!color) return []

  const x = index % size
  const y = Math.floor(index / size)
  const stones: number[] = [index]

  for (const step of [1, -1]) {
    for (let offset = 1; offset < size; offset += 1) {
      const nextX = x + direction.dx * offset * step
      const nextY = y + direction.dy * offset * step
      if (nextX < 0 || nextY < 0 || nextX >= size || nextY >= size) break
      const nextIndex = nextY * size + nextX
      if (board[nextIndex] !== color) break
      stones.push(nextIndex)
    }
  }

  return stones.sort((first, second) => first - second)
}
