import {
  BLACK,
  EMPTY,
  FIVE,
  createsFive,
  other,
  type Cell,
} from './evaluate'
import {
  SearchTimeout,
  candidateIndexes,
  findVcfWin,
  scoredMoves,
  searchBest,
} from './search'
import {
  ENGINE_STRENGTH_PROFILES,
  type EngineStrength,
  type EngineStrengthProfile,
} from './strength'

export const VCF_DEPTH = 8

export interface MoveRequest {
  readonly cells: Uint8Array
  readonly size: number
  readonly color: Cell
  readonly strength: EngineStrength
  /** Renju: a black overline neither wins nor is a legal threat. */
  readonly exactFiveForBlack?: boolean
  readonly forbidden?: (index: number) => boolean
  readonly random?: () => number
  readonly shouldStop?: () => boolean
  readonly profileOverride?: EngineStrengthProfile
}

export type MoveSource = 'immediate' | 'vcf' | 'search'

export interface MoveDecision {
  readonly index: number | null
  readonly score: number
  readonly nodes: number
  readonly depth: number
  readonly source: MoveSource
}

const RANDOM_CHOICE_WINDOW = 5

function legalCandidates(request: MoveRequest): number[] {
  const candidates = candidateIndexes(request.cells, request.size).filter(
    (index) => request.cells[index] === EMPTY,
  )
  if (!request.forbidden) return candidates
  return candidates.filter((index) => !request.forbidden?.(index))
}

/**
 * Picks the engine's move. The order matters: an immediate five always wins,
 * a forced sequence of fours is found before the general search, and the
 * general search degrades gracefully when its time budget expires.
 */
export function chooseMove(request: MoveRequest): MoveDecision {
  const { cells, size, color } = request
  const random = request.random ?? Math.random
  const profile = request.profileOverride
    ?? ENGINE_STRENGTH_PROFILES[request.strength]
  const deadline = Date.now() + profile.timeBudgetMs
  const exactFiveFor = (side: Cell): boolean =>
    request.exactFiveForBlack === true && side === BLACK

  const candidates = legalCandidates(request)
  if (candidates.length === 0) {
    return { index: null, score: 0, nodes: 0, depth: 0, source: 'search' }
  }

  for (const index of candidates) {
    cells[index] = color
    const won = createsFive(cells, size, index, exactFiveFor(color))
    cells[index] = EMPTY
    if (won) {
      return { index, score: FIVE, nodes: 0, depth: 1, source: 'immediate' }
    }
  }

  if (profile.useVcf) {
    try {
      const win = findVcfWin(cells, size, color, VCF_DEPTH, {
        deadline,
        exactFiveForBlack: request.exactFiveForBlack,
        shouldStop: request.shouldStop,
      })
      if (win !== null && !request.forbidden?.(win)) {
        return { index: win, score: FIVE, nodes: 0, depth: 1, source: 'vcf' }
      }
    } catch (error) {
      if (!(error instanceof SearchTimeout)) throw error
    }
  }

  const outcome = searchBest(cells, size, color, {
    depth: profile.depth,
    rootWidth: profile.rootWidth,
    innerWidth: profile.innerWidth,
    deadline,
    exactFiveForBlack: request.exactFiveForBlack,
    forbidden: request.forbidden,
    shouldStop: request.shouldStop,
  })

  const ranked = outcome.ordered.length > 0
    ? outcome.ordered
    : scoredMoves(cells, size, color, profile.rootWidth)

  let chosen = outcome.index
  let source: MoveSource = 'search'
  if (chosen === null) {
    chosen = ranked[0]?.index ?? candidates[0] ?? null
    source = 'search'
  }

  if (profile.randomness > 0 && random() < profile.randomness) {
    const window = ranked
      .slice(0, RANDOM_CHOICE_WINDOW)
      .filter((move) => !request.forbidden?.(move.index))
    const pick = window[Math.floor(random() * window.length)]
    if (pick) chosen = pick.index
  }

  return {
    index: chosen,
    score: outcome.score,
    nodes: outcome.nodes,
    depth: outcome.depth,
    source,
  }
}

/**
 * Counts the opponent's immediate five threats. Two or more means the
 * position cannot be saved by a single blocking move.
 */
export function immediateThreats(
  cells: Uint8Array,
  size: number,
  color: Cell,
  exactFiveForBlack = false,
): number[] {
  const rival = other(color)
  const threats: number[] = []

  for (const index of candidateIndexes(cells, size)) {
    if (cells[index] !== EMPTY) continue
    cells[index] = rival
    const won = createsFive(
      cells,
      size,
      index,
      exactFiveForBlack && rival === BLACK,
    )
    cells[index] = EMPTY
    if (won) threats.push(index)
  }

  return threats
}
