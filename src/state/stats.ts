import type { Color, GameState } from '../game/types'

export interface GameStats {
  readonly total: number
  readonly wins: number
  readonly losses: number
  readonly draws: number
  /** Positive counts a winning streak, negative a losing streak. */
  readonly streak: number
  readonly bestStreak: number
  readonly asBlack: { readonly total: number; readonly wins: number }
  readonly asWhite: { readonly total: number; readonly wins: number }
}

export interface FinishedGame {
  readonly winner: Color | 'draw'
  readonly humanColor: Color
  readonly moves: number
}

const STORAGE_KEY = 'dufive-stats-v1'

export const EMPTY_STATS: GameStats = {
  total: 0,
  wins: 0,
  losses: 0,
  draws: 0,
  streak: 0,
  bestStreak: 0,
  asBlack: { total: 0, wins: 0 },
  asWhite: { total: 0, wins: 0 },
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null
}

function count(value: unknown): number {
  return typeof value === 'number' && Number.isFinite(value) && value >= 0
    ? Math.floor(value)
    : 0
}

/** Parses stored statistics, falling back to empty for anything malformed. */
export function parseStats(value: unknown): GameStats {
  if (!isRecord(value)) return EMPTY_STATS

  const asBlack = isRecord(value.asBlack) ? value.asBlack : {}
  const asWhite = isRecord(value.asWhite) ? value.asWhite : {}
  const stats: GameStats = {
    total: count(value.total),
    wins: count(value.wins),
    losses: count(value.losses),
    draws: count(value.draws),
    streak: Math.trunc(count(value.streak)) || 0,
    bestStreak: count(value.bestStreak),
    asBlack: { total: count(asBlack.total), wins: count(asBlack.wins) },
    asWhite: { total: count(asWhite.total), wins: count(asWhite.wins) },
  }
  return stats
}

export function loadStats(): GameStats {
  if (typeof localStorage === 'undefined') return EMPTY_STATS
  try {
    return parseStats(JSON.parse(localStorage.getItem(STORAGE_KEY) ?? 'null'))
  } catch {
    return EMPTY_STATS
  }
}

export function saveStats(stats: GameStats): void {
  if (typeof localStorage === 'undefined') return
  try {
    localStorage.setItem(STORAGE_KEY, JSON.stringify(stats))
  } catch {
    // Private-mode WebViews can refuse storage; stats are optional.
  }
}

export function clearStats(): void {
  if (typeof localStorage === 'undefined') return
  try {
    localStorage.removeItem(STORAGE_KEY)
  } catch {
    // Nothing to clean up.
  }
}

/**
 * Folds a finished game into the running statistics. Only human-versus-engine
 * games are counted, and a draw keeps the current streak.
 */
export function recordResult(stats: GameStats, game: FinishedGame): GameStats {
  const won = game.winner === game.humanColor
  const lost = game.winner !== 'draw' && !won

  const streak = game.winner === 'draw'
    ? stats.streak
    : won
      ? stats.streak >= 0 ? stats.streak + 1 : 1
      : stats.streak <= 0 ? stats.streak - 1 : -1

  const side = game.humanColor === 'black' ? stats.asBlack : stats.asWhite

  return {
    total: stats.total + 1,
    wins: stats.wins + (won ? 1 : 0),
    losses: stats.losses + (lost ? 1 : 0),
    draws: stats.draws + (game.winner === 'draw' ? 1 : 0),
    streak,
    bestStreak: Math.max(stats.bestStreak, streak),
    asBlack: game.humanColor === 'black'
      ? { total: side.total + 1, wins: side.wins + (won ? 1 : 0) }
      : stats.asBlack,
    asWhite: game.humanColor === 'white'
      ? { total: side.total + 1, wins: side.wins + (won ? 1 : 0) }
      : stats.asWhite,
  }
}

/**
 * The outcome to record for a finished game, or null when the game is still
 * open or is a local two-player game with no "human" side to credit.
 */
export function outcomeFor(
  game: GameState,
  humanColor: Color,
  isEngineGame: boolean,
): FinishedGame | null {
  if (!isEngineGame || game.phase !== 'finished' || game.winner === null) {
    return null
  }
  return {
    winner: game.winner,
    humanColor,
    moves: game.moves.length,
  }
}
