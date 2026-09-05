import { describe, expect, it } from 'vitest'
import { boardAtPly, exportRecord, moveAtPly, moveNotation, serializeSgf } from '../record'
import { createGame, playMove, resign } from '../rules'
import type { GameState, Point } from '../types'

function playAll(state: GameState, points: readonly Point[]): GameState {
  let current = state
  for (const point of points) {
    const result = playMove(current, point)
    if (!result.ok) throw new Error(`unexpected failure at ${point.x},${point.y}`)
    current = result.state
  }
  return current
}

describe('boardAtPly', () => {
  it('shows only the first ply stones', () => {
    const game = playAll(createGame(), [
      { x: 7, y: 7 }, { x: 8, y: 8 },
      { x: 6, y: 6 },
    ])

    const afterOne = boardAtPly(game, 1)
    expect(afterOne[7 * 15 + 7]).toBe('black')
    expect(afterOne[8 * 15 + 8]).toBeNull()

    const afterTwo = boardAtPly(game, 2)
    expect(afterTwo[8 * 15 + 8]).toBe('white')
    expect(afterTwo[6 * 15 + 6]).toBeNull()

    expect(boardAtPly(game, 3)[6 * 15 + 6]).toBe('black')
  })

  it('clamps out-of-range plies', () => {
    const game = playAll(createGame(), [{ x: 7, y: 7 }])
    expect(boardAtPly(game, -3)[7 * 15 + 7]).toBeNull()
    expect(boardAtPly(game, 99)[7 * 15 + 7]).toBe('black')
  })
})

describe('moveAtPly', () => {
  it('returns the move that was just played', () => {
    const game = playAll(createGame(), [{ x: 7, y: 7 }, { x: 8, y: 8 }])
    expect(moveAtPly(game, 0)).toBeNull()
    expect(moveAtPly(game, 1)?.point).toEqual({ x: 7, y: 7 })
    expect(moveAtPly(game, 2)?.color).toBe('white')
  })
})

describe('moveNotation', () => {
  it('matches the board labels, rows counted from the bottom', () => {
    const game = createGame()
    expect(moveNotation({ number: 1, color: 'black', point: { x: 7, y: 7 } }, game.size))
      .toBe('H8')
    expect(moveNotation({ number: 2, color: 'white', point: { x: 0, y: 0 } }, game.size))
      .toBe('A15')
    // Column letters skip I, so x=14 on a 15×15 board is P.
    expect(moveNotation({ number: 3, color: 'black', point: { x: 14, y: 14 } }, game.size))
      .toBe('P1')
  })
})

describe('serializeSgf', () => {
  it('emits gomoku SGF with the right properties', () => {
    const game = playAll(createGame(15, 'renju'), [{ x: 7, y: 7 }, { x: 8, y: 8 }])
    const sgf = serializeSgf(game)

    expect(sgf.startsWith('(;GM[4]FF[4]')).toBe(true)
    expect(sgf).toContain('SZ[15]')
    expect(sgf).toContain('RU[renju]')
    expect(sgf).toContain(';B[hh];W[ii]')
    expect(sgf.endsWith(')')).toBe(true)
  })

  it('records the result of a finished game', () => {
    const result = resign(playAll(createGame(), [{ x: 7, y: 7 }]), 'black')
    expect(result.ok).toBe(true)
    if (result.ok) expect(serializeSgf(result.state)).toContain('RE[W]')
  })

  it('marks freestyle rules', () => {
    expect(serializeSgf(createGame())).toContain('RU[freestyle]')
  })
})

describe('exportRecord', () => {
  it('produces a readable text list', () => {
    const game = playAll(createGame(), [
      { x: 7, y: 7 }, { x: 8, y: 8 },
      { x: 6, y: 6 }, { x: 9, y: 9 },
    ])
    const { text } = exportRecord(game)

    const lines = text.split('\n')
    expect(lines[0]).toContain('15×15')
    expect(lines[1]).toContain('4 手')
    expect(lines[1]).toContain('对局中')
    // Column letters skip I: x=8 is J and x=9 is K.
    expect(lines[3]).toBe('1. H8　J7')
    expect(lines[4]).toBe('2. G9　K6')
  })
})
