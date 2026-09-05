// @vitest-environment jsdom

import { beforeEach, describe, expect, it } from 'vitest'
import {
  EMPTY_STATS,
  clearStats,
  loadStats,
  parseStats,
  recordResult,
  saveStats,
} from '../stats'

describe('parseStats', () => {
  it('returns empty stats for malformed input', () => {
    expect(parseStats(null)).toEqual(EMPTY_STATS)
    expect(parseStats('nonsense')).toEqual(EMPTY_STATS)
    expect(parseStats({ total: -5, wins: 'many' })).toEqual(EMPTY_STATS)
  })

  it('keeps valid values and drops invalid ones', () => {
    const stats = parseStats({
      total: 3,
      wins: 2,
      losses: 1,
      draws: 0,
      streak: 2,
      bestStreak: 2,
      asBlack: { total: 2, wins: 2 },
      asWhite: { total: 1, wins: 0 },
    })
    expect(stats.total).toBe(3)
    expect(stats.asBlack.wins).toBe(2)
  })
})

describe('recordResult', () => {
  it('counts a win and extends a winning streak', () => {
    const first = recordResult(EMPTY_STATS, {
      winner: 'black',
      humanColor: 'black',
      moves: 20,
    })
    expect(first.total).toBe(1)
    expect(first.wins).toBe(1)
    expect(first.streak).toBe(1)
    expect(first.asBlack).toEqual({ total: 1, wins: 1 })

    const second = recordResult(first, {
      winner: 'black',
      humanColor: 'black',
      moves: 12,
    })
    expect(second.streak).toBe(2)
    expect(second.bestStreak).toBe(2)
  })

  it('flips the streak sign on a loss', () => {
    const won = recordResult(EMPTY_STATS, {
      winner: 'black',
      humanColor: 'black',
      moves: 9,
    })
    const lost = recordResult(won, {
      winner: 'white',
      humanColor: 'black',
      moves: 30,
    })
    expect(lost.losses).toBe(1)
    expect(lost.streak).toBe(-1)
    expect(lost.bestStreak).toBe(1)
  })

  it('keeps the streak on a draw', () => {
    const won = recordResult(EMPTY_STATS, {
      winner: 'black',
      humanColor: 'black',
      moves: 9,
    })
    const drew = recordResult(won, {
      winner: 'draw',
      humanColor: 'black',
      moves: 225,
    })
    expect(drew.draws).toBe(1)
    expect(drew.streak).toBe(1)
  })

  it('splits results by the human colour', () => {
    const asWhite = recordResult(EMPTY_STATS, {
      winner: 'white',
      humanColor: 'white',
      moves: 15,
    })
    expect(asWhite.asWhite).toEqual({ total: 1, wins: 1 })
    expect(asWhite.asBlack).toEqual({ total: 0, wins: 0 })
  })
})

describe('persistence', () => {
  beforeEach(() => {
    localStorage.clear()
  })

  it('round-trips through localStorage', () => {
    const stats = recordResult(recordResult(EMPTY_STATS, {
      winner: 'white',
      humanColor: 'black',
      moves: 11,
    }), {
      winner: 'black',
      humanColor: 'black',
      moves: 7,
    })

    saveStats(stats)
    expect(loadStats()).toEqual(stats)
  })

  it('clears to empty', () => {
    saveStats(recordResult(EMPTY_STATS, {
      winner: 'black',
      humanColor: 'black',
      moves: 5,
    }))
    clearStats()
    expect(loadStats()).toEqual(EMPTY_STATS)
  })
})
