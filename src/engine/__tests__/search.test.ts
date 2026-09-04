import { describe, expect, it } from 'vitest'
import {
  BLACK,
  EMPTY,
  WHITE,
  analyzeDirection,
  createsFive,
  pointThreat,
} from '../evaluate'
import {
  candidateIndexes,
  completionPoints,
  findVcfWin,
  searchBest,
} from '../search'
import { chooseMove, immediateThreats } from '../ai'
import type { Cell } from '../evaluate'

const SIZE = 15

function emptyBoard(): Uint8Array {
  return new Uint8Array(SIZE * SIZE)
}

function at(x: number, y: number): number {
  return y * SIZE + x
}

function place(cells: Uint8Array, moves: readonly [number, number, Cell][]): void {
  for (const [x, y, color] of moves) cells[at(x, y)] = color
}

describe('pattern evaluation', () => {
  it('recognises a completed five', () => {
    const cells = emptyBoard()
    place(cells, [[3, 5, BLACK], [4, 5, BLACK], [5, 5, BLACK], [6, 5, BLACK]])
    cells[at(7, 5)] = BLACK
    expect(createsFive(cells, SIZE, at(7, 5))).toBe(true)
  })

  it('does not treat a four as a five', () => {
    const cells = emptyBoard()
    place(cells, [[3, 5, BLACK], [4, 5, BLACK], [5, 5, BLACK]])
    cells[at(6, 5)] = BLACK
    expect(createsFive(cells, SIZE, at(6, 5))).toBe(false)
  })

  it('respects the exact-five rule for black overlines', () => {
    const cells = emptyBoard()
    place(cells, [
      [2, 5, BLACK], [3, 5, BLACK], [4, 5, BLACK], [5, 5, BLACK], [7, 5, BLACK],
    ])
    cells[at(6, 5)] = BLACK
    expect(createsFive(cells, SIZE, at(6, 5))).toBe(true)
    expect(createsFive(cells, SIZE, at(6, 5), true)).toBe(false)
  })

  it('scores an open three above a blocked three', () => {
    const openBoard = emptyBoard()
    place(openBoard, [[5, 5, BLACK], [6, 5, BLACK]])
    const openScore = analyzeDirection(openBoard, SIZE, at(7, 5), BLACK, 1, 0)

    const blockedBoard = emptyBoard()
    place(blockedBoard, [[5, 5, BLACK], [6, 5, BLACK], [8, 5, WHITE]])
    const blockedScore = analyzeDirection(blockedBoard, SIZE, at(7, 5), BLACK, 1, 0)

    expect(openScore).toBeGreaterThan(blockedScore)
  })

  it('detects a broken three such as XX_X', () => {
    const cells = emptyBoard()
    place(cells, [[4, 5, BLACK], [5, 5, BLACK], [7, 5, BLACK]])
    expect(pointThreat(cells, SIZE, at(6, 5), BLACK)).toBeGreaterThan(0)
  })
})

describe('candidate generation', () => {
  it('returns the centre on an empty board', () => {
    const candidates = candidateIndexes(emptyBoard(), SIZE)
    expect(candidates).toEqual([at(7, 7)])
  })

  it('only considers points near existing stones', () => {
    const cells = emptyBoard()
    cells[at(7, 7)] = BLACK
    const candidates = candidateIndexes(cells, SIZE)
    expect(candidates).toContain(at(7, 8))
    expect(candidates).toContain(at(9, 9))
    expect(candidates).not.toContain(at(0, 0))
  })
})

describe('chooseMove', () => {
  it('completes five immediately when it can', () => {
    const cells = emptyBoard()
    place(cells, [
      [3, 5, BLACK], [4, 5, BLACK], [5, 5, BLACK], [6, 5, BLACK],
      [3, 9, WHITE], [4, 9, WHITE], [5, 9, WHITE],
    ])

    const decision = chooseMove({
      cells,
      size: SIZE,
      color: BLACK,
      strength: 'low',
    })

    expect(decision.source).toBe('immediate')
    expect([at(2, 5), at(7, 5)]).toContain(decision.index)
  })

  it('blocks the opponent when they threaten five', () => {
    const cells = emptyBoard()
    place(cells, [
      [3, 5, WHITE], [4, 5, WHITE], [5, 5, WHITE], [6, 5, WHITE],
      [3, 9, BLACK], [4, 9, BLACK],
    ])

    const decision = chooseMove({
      cells,
      size: SIZE,
      color: BLACK,
      strength: 'medium',
      // The medium profile adds 12% randomness; pin it so the assertion is
      // about blocking, not about the dice.
      random: () => 1,
    })

    expect([at(2, 5), at(7, 5)]).toContain(decision.index)
  })

  it('never returns an occupied point', () => {
    const cells = emptyBoard()
    place(cells, [
      [7, 7, BLACK], [7, 8, WHITE], [8, 7, BLACK], [6, 8, WHITE],
    ])

    const decision = chooseMove({
      cells,
      size: SIZE,
      color: BLACK,
      strength: 'high',
    })

    expect(decision.index).not.toBeNull()
    if (decision.index !== null) {
      expect(cells[decision.index]).toBe(EMPTY)
    }
  })

  it('avoids forbidden points it is given', () => {
    const cells = emptyBoard()
    place(cells, [[7, 7, BLACK], [7, 8, WHITE]])

    const decision = chooseMove({
      cells,
      size: SIZE,
      color: BLACK,
      strength: 'medium',
      forbidden: (index) => index === at(7, 6),
      random: () => 1,
    })

    expect(decision.index).not.toBe(at(7, 6))
  })

  it('respects the time budget and still returns a move', () => {
    const cells = emptyBoard()
    place(cells, [
      [7, 7, BLACK], [7, 8, WHITE], [8, 8, BLACK], [6, 7, WHITE],
      [8, 7, BLACK], [6, 8, WHITE], [9, 9, BLACK], [5, 6, WHITE],
    ])

    const started = Date.now()
    const decision = chooseMove({
      cells,
      size: SIZE,
      color: BLACK,
      strength: 'full',
      profileOverride: undefined,
    })

    expect(decision.index).not.toBeNull()
    expect(Date.now() - started).toBeLessThan(15_000)
  })
})

describe('threat helpers', () => {
  it('finds the opponent completion points', () => {
    const cells = emptyBoard()
    place(cells, [[3, 5, WHITE], [4, 5, WHITE], [5, 5, WHITE], [6, 5, WHITE]])
    expect(immediateThreats(cells, SIZE, BLACK).sort()).toEqual(
      [at(2, 5), at(7, 5)].sort(),
    )
  })

  it('lists completion points for a colour', () => {
    const cells = emptyBoard()
    place(cells, [
      [3, 5, BLACK], [4, 5, BLACK], [5, 5, BLACK], [6, 5, BLACK],
    ])
    expect(completionPoints(cells, SIZE, BLACK).sort()).toEqual(
      [at(2, 5), at(7, 5)].sort(),
    )
  })
})

describe('VCF search', () => {
  it('finds a win by continuous fours', () => {
    const cells = emptyBoard()
    // Black has two separate threes that can be driven by fours.
    place(cells, [
      [4, 4, BLACK], [5, 4, BLACK], [6, 4, BLACK],
      [4, 6, BLACK], [5, 6, BLACK], [6, 6, BLACK],
      [0, 12, WHITE], [1, 12, WHITE],
    ])

    const win = findVcfWin(cells, SIZE, BLACK, 8, {
      deadline: Date.now() + 5_000,
    })

    expect(win).not.toBeNull()
  })

  it('returns null when there is no forcing win', () => {
    const cells = emptyBoard()
    place(cells, [[7, 7, BLACK], [0, 0, WHITE]])

    const win = findVcfWin(cells, SIZE, BLACK, 4, {
      deadline: Date.now() + 2_000,
    })

    expect(win).toBeNull()
  })
})

describe('searchBest', () => {
  it('picks a legal move and reports the depth it completed', () => {
    const cells = emptyBoard()
    place(cells, [[7, 7, BLACK], [7, 8, WHITE]])

    const outcome = searchBest(cells, SIZE, BLACK, {
      depth: 2,
      rootWidth: 8,
      innerWidth: 8,
      deadline: Date.now() + 2_000,
    })

    expect(outcome.index).not.toBeNull()
    expect(outcome.depth).toBeGreaterThan(0)
    expect(outcome.ordered.length).toBeGreaterThan(0)
  })

  it('keeps the board unchanged after searching', () => {
    const cells = emptyBoard()
    place(cells, [[7, 7, BLACK], [7, 8, WHITE]])
    const before = [...cells]

    searchBest(cells, SIZE, BLACK, {
      depth: 3,
      rootWidth: 8,
      innerWidth: 8,
      deadline: Date.now() + 2_000,
    })

    expect([...cells]).toEqual(before)
  })
})

describe('VCF with renju restrictions', () => {
  it('does not start a forced win on a forbidden point', () => {
    const cells = emptyBoard()
    // Two threes that a VCF would normally drive with fours.
    place(cells, [
      [4, 4, BLACK], [5, 4, BLACK], [6, 4, BLACK],
      [4, 6, BLACK], [5, 6, BLACK], [6, 6, BLACK],
      [0, 12, WHITE], [1, 12, WHITE],
    ])

    // Every point the VCF wants to use is forbidden, so there is no win.
    const allForbidden = () => true
    const win = findVcfWin(cells, SIZE, BLACK, 8, {
      deadline: Date.now() + 5_000,
      forbidden: allForbidden,
    })

    expect(win).toBeNull()
  })

  it('still finds a forced win when the path is legal', () => {
    const cells = emptyBoard()
    place(cells, [
      [4, 4, BLACK], [5, 4, BLACK], [6, 4, BLACK],
      [4, 6, BLACK], [5, 6, BLACK], [6, 6, BLACK],
      [0, 12, WHITE], [1, 12, WHITE],
    ])

    const win = findVcfWin(cells, SIZE, BLACK, 8, {
      deadline: Date.now() + 5_000,
      forbidden: () => false,
    })

    expect(win).not.toBeNull()
  })

  it('wins when the only block left to the defender is forbidden', () => {
    const cells = emptyBoard()
    // White has three in a row; black stones close the left end, so the four
    // white is about to make can only be answered at (7,7).
    place(cells, [
      [3, 7, WHITE], [4, 7, WHITE], [5, 7, WHITE],
      [2, 7, BLACK],
      [0, 0, BLACK], [1, 0, BLACK], [2, 0, BLACK],
    ])

    // White attacks, so the defender is black and renju restrictions apply.
    const win = findVcfWin(cells, SIZE, WHITE, 4, {
      deadline: Date.now() + 2_000,
      forbidden: (index) => index === at(7, 7),
    })

    // (6,7) makes a four whose single defence is illegal for black.
    expect(win).toBe(at(6, 7))
  })
})
