import { describe, expect, it } from 'vitest'
import { forbiddenReason } from '../forbidden'
import { findWinLine, playMove, createGame } from '../rules'
import type { Board, BoardSize, Color, Stone } from '../types'

const SIZE: BoardSize = 15

function boardFrom(stones: Record<string, Color>): Board {
  const board = Array<Stone>(SIZE * SIZE).fill(null)
  for (const [key, color] of Object.entries(stones)) {
    const [x, y] = key.split(',').map(Number) as [number, number]
    board[y * SIZE + x] = color
  }
  return board
}

const at = (x: number, y: number): number => y * SIZE + x

describe('renju: five beats a forbidden shape in another direction', () => {
  it('allows an exact five even when another direction is an overline', () => {
    // Black has four vertically through (7,4)-(7,7) and five horizontally
    // through (4,7)-(9,7) once (7,7) is played. The vertical line is an
    // overline, so a single-pass check would wrongly forbid the winning move.
    const board = boardFrom({
      '7,3': 'black', '7,4': 'black', '7,5': 'black', '7,6': 'black',
      '4,7': 'black', '5,7': 'black', '6,7': 'black',
      '8,7': 'black', '9,7': 'black',
      '7,1': 'white', '2,11': 'white',
    })

    const point = { x: 7, y: 7 }
    expect(forbiddenReason(board, SIZE, point, 'black')).toBeNull()

    const game = { ...createGame(SIZE, 'renju'), board, moveNumber: 11 }
    const result = playMove(game, point)
    expect(result.ok).toBe(true)
    if (result.ok) expect(result.state.winner).toBe('black')
  })

  it('finds the five in whichever direction it appears', () => {
    const board = boardFrom({
      '4,7': 'black', '5,7': 'black', '6,7': 'black', '8,7': 'black',
      '7,7': 'black',
    })
    expect(findWinLine(board, SIZE, at(7, 7), 'black', 'renju')).not.toBeNull()
  })
})

describe('renju: two fours or threes in a single line', () => {
  it('forbids two distinct fours on one line', () => {
    // XXX_X_XXX: completing at either gap makes a different five.
    const board = boardFrom({
      '1,7': 'black', '2,7': 'black', '3,7': 'black',
      '7,7': 'black', '8,7': 'black', '9,7': 'black',
      '1,1': 'white', '2,1': 'white',
    })

    expect(forbiddenReason(board, SIZE, { x: 5, y: 7 }, 'black'))
      .toBe('double-four')
  })

  it('treats a four-three on one line as legal, not a double three', () => {
    // Row becomes X X _ X _ X X. The left three (3,4,6) makes a true open
    // four by playing 5. The right shape (6,8,9) only makes an apparent open
    // four by playing 7: completing towards the stones at 3 and 4 would be
    // an overline, so it is a four, not an open three. Renju allows 四三.
    const board = boardFrom({
      '3,7': 'black', '4,7': 'black',
      '8,7': 'black', '9,7': 'black',
      '1,1': 'white', '2,1': 'white',
    })

    expect(forbiddenReason(board, SIZE, { x: 6, y: 7 }, 'black')).toBeNull()
  })

  it('counts an open four as a single four, not two', () => {
    // _XXXX_ has two completing cells but is one four, so it is legal.
    const board = boardFrom({
      '4,7': 'black', '5,7': 'black', '6,7': 'black', '7,7': 'black',
      '1,1': 'white', '2,1': 'white', '3,1': 'white',
    })

    expect(forbiddenReason(board, SIZE, { x: 3, y: 7 }, 'black')).toBeNull()
  })
})

describe('renju: false threes', () => {
  it('does not count a three that can only become an apparent open four', () => {
    // The horizontal "three" (4,7)(5,7)(6,7) looks open, but completing
    // towards the stone at (1,7) yields six in a row, so it is a false three.
    const board = boardFrom({
      '1,7': 'black',
      '4,7': 'black', '5,7': 'black',
      '8,7': 'black',
      '6,4': 'black', '6,5': 'black',
      '0,0': 'white', '1,0': 'white', '2,0': 'white',
    })

    expect(forbiddenReason(board, SIZE, { x: 6, y: 7 }, 'black')).toBeNull()
  })
})
