import {
  BLACK,
  BoardEvaluator,
  EMPTY,
  FIVE,
  FOUR,
  createsFive,
  createsOverline,
  moveScore,
  other,
  pointThreat,
  type Cell,
} from './evaluate'
import { neighborIndexes } from '../game/board'

export class SearchTimeout extends Error {
  constructor() {
    super('gomoku search exceeded its time budget')
    this.name = 'SearchTimeout'
  }
}

export interface SearchLimits {
  readonly depth: number
  readonly rootWidth: number
  readonly innerWidth: number
  readonly deadline: number
  /** Renju: a black overline is not a win. */
  readonly exactFiveForBlack?: boolean
  readonly forbidden?: (index: number) => boolean
  readonly shouldStop?: () => boolean
}

export interface ScoredMove {
  readonly index: number
  readonly score: number
}

export interface SearchOutcome {
  readonly index: number | null
  readonly score: number
  readonly nodes: number
  readonly depth: number
  readonly ordered: readonly ScoredMove[]
}

/** Empty points worth considering: within two steps of a stone, or the centre. */
export function candidateIndexes(cells: Uint8Array, size: number): number[] {
  for (let index = 0; index < cells.length; index += 1) {
    if (cells[index] !== EMPTY) return neighborIndexes(cells, size, 2)
  }

  const centre = Math.floor(size / 2)
  return [centre * size + centre]
}

export function scoredMoves(
  cells: Uint8Array,
  size: number,
  color: Cell,
  limit: number,
  accept?: (index: number) => boolean,
): ScoredMove[] {
  const scored: ScoredMove[] = []

  for (const index of candidateIndexes(cells, size)) {
    if (cells[index] !== EMPTY) continue
    // Filtering happens before the width limit so renju's forbidden points
    // never push strong legal moves off the end of the list.
    if (accept && !accept(index)) continue
    scored.push({ index, score: moveScore(cells, size, index, color) })
  }

  scored.sort((first, second) => second.score - first.score)
  return scored.slice(0, limit)
}

/** Every empty point that would immediately complete five for `color`. */
export function completionPoints(
  cells: Uint8Array,
  size: number,
  color: Cell,
  exactFive = false,
): number[] {
  const points: number[] = []

  for (const index of candidateIndexes(cells, size)) {
    if (cells[index] !== EMPTY) continue
    cells[index] = color
    const won = createsFive(cells, size, index, exactFive)
    cells[index] = EMPTY
    if (won) points.push(index)
  }

  return points
}

interface SearchContext {
  readonly cells: Uint8Array
  readonly size: number
  readonly evaluator: BoardEvaluator
  readonly limits: SearchLimits
  nodes: number
}

function negamax(
  context: SearchContext,
  color: Cell,
  depth: number,
  alpha: number,
  beta: number,
  ply: number,
): number {
  context.nodes += 1
  if (Date.now() > context.limits.deadline) throw new SearchTimeout()
  if (context.limits.shouldStop?.()) throw new SearchTimeout()
  if (depth <= 0) return context.evaluator.score(color)

  const moves = scoredMoves(
    context.cells,
    context.size,
    color,
    context.limits.innerWidth,
  )
  if (moves.length === 0) return context.evaluator.score(color)

  const exactFive = context.limits.exactFiveForBlack === true && color === BLACK
  let best = -Infinity

  for (const move of moves) {
    context.evaluator.place(move.index, color)
    let value: number | null = null
    // A SearchTimeout can unwind from the recursion below, so the stone must
    // be removed on every path or the board keeps phantom stones.
    try {
      if (exactFive && createsOverline(context.cells, context.size, move.index)) {
        // Black may not complete six or more under renju rules.
      } else if (
        createsFive(context.cells, context.size, move.index, exactFive)
      ) {
        value = FIVE - ply
      } else {
        value = -negamax(
          context,
          other(color),
          depth - 1,
          -beta,
          -alpha,
          ply + 1,
        )
      }
    } finally {
      context.evaluator.remove(move.index)
    }

    if (value === null) continue
    if (value > best) best = value
    if (best > alpha) alpha = best
    if (alpha >= beta) break
  }

  return best
}

/**
 * Iterative-deepening alpha-beta search. When the budget runs out the best
 * move from the last completed depth is kept, so a slow device simply searches
 * one ply less instead of failing.
 */
export function searchBest(
  cells: Uint8Array,
  size: number,
  color: Cell,
  limits: SearchLimits,
): SearchOutcome {
  const evaluator = new BoardEvaluator(cells, size)
  const context: SearchContext = { cells, size, evaluator, limits, nodes: 0 }
  const exactFive = limits.exactFiveForBlack === true && color === BLACK

  const ordered = scoredMoves(
    cells,
    size,
    color,
    limits.rootWidth,
    limits.forbidden ? (index) => !limits.forbidden?.(index) : undefined,
  )
  const fallback = ordered[0]
  if (!fallback) {
    return { index: null, score: 0, nodes: 0, depth: 0, ordered: [] }
  }

  let best = fallback
  let bestScore = -Infinity
  let completedDepth = 0

  for (let depth = 1; depth <= limits.depth; depth += 1) {
    try {
      const roots = [
        best,
        ...ordered.filter((move) => move.index !== best.index),
      ]
      let alpha = -Infinity
      let localBest: ScoredMove | null = null
      let localScore = -Infinity

      for (const move of roots) {
        evaluator.place(move.index, color)
        let value: number
        try {
          const won = createsFive(cells, size, move.index, exactFive)
          value = won
            ? FIVE
            : -negamax(context, other(color), depth - 1, -Infinity, -alpha, 1)
        } finally {
          evaluator.remove(move.index)
        }

        if (value > localScore) {
          localScore = value
          localBest = move
        }
        if (localScore > alpha) alpha = localScore
      }

      if (localBest) {
        best = localBest
        bestScore = localScore
        completedDepth = depth
      }
    } catch (error) {
      if (!(error instanceof SearchTimeout)) throw error
      break
    }

    if (bestScore >= FIVE) break
  }

  const ranked = [
    best,
    ...ordered.filter((move) => move.index !== best.index),
  ]

  return {
    index: best.index,
    score: bestScore,
    nodes: context.nodes,
    depth: completedDepth,
    ordered: ranked,
  }
}

/**
 * Win-by-continuous-four search. Every move is a four, so the opponent has at
 * most one legal reply, which makes the line forcing. Returns the first move
 * of a winning sequence, or `null`.
 */
export function findVcfWin(
  cells: Uint8Array,
  size: number,
  color: Cell,
  maxDepth: number,
  limits: Pick<SearchLimits, 'deadline' | 'exactFiveForBlack' | 'shouldStop'>,
): number | null {
  const exactFiveFor = (side: Cell): boolean =>
    limits.exactFiveForBlack === true && side === BLACK

  const step = (depth: number): number | null => {
    if (depth <= 0) return null
    if (Date.now() > limits.deadline) throw new SearchTimeout()
    if (limits.shouldStop?.()) throw new SearchTimeout()

    const immediate = completionPoints(
      cells,
      size,
      color,
      exactFiveFor(color),
    )
    if (immediate.length > 0) return immediate[0] ?? null

    const rival = other(color)
    const fours: ScoredMove[] = []
    for (const index of candidateIndexes(cells, size)) {
      if (cells[index] !== EMPTY) continue
      const threat = pointThreat(cells, size, index, color)
      if (threat >= FOUR) fours.push({ index, score: threat })
    }
    fours.sort((first, second) => second.score - first.score)

    for (const move of fours) {
      let won: number | null = null
      cells[move.index] = color
      // A SearchTimeout can unwind from the recursion, so both stones are
      // removed on every path.
      try {
        const blocks = completionPoints(cells, size, color, exactFiveFor(color))
        const rivalWinsNow = completionPoints(
          cells,
          size,
          rival,
          exactFiveFor(rival),
        ).length > 0

        if (blocks.length >= 2) {
          won = rivalWinsNow ? null : move.index
        } else if (blocks.length === 1 && !rivalWinsNow) {
          const block = blocks[0] as number
          cells[block] = rival
          try {
            won = step(depth - 1)
          } finally {
            cells[block] = EMPTY
          }
          if (won !== null) won = move.index
        }
      } finally {
        cells[move.index] = EMPTY
      }

      if (won !== null) return won
    }

    return null
  }

  return step(maxDepth)
}
