import { describe, expect, it } from 'vitest'
import { createGame, findWinLine, listLegalMoves, playMove, resign, undo } from '../rules'
import { forbiddenReason } from '../forbidden'
import type { Board, BoardSize, Color, GameState, Stone } from '../types'

function boardFrom(size: BoardSize, stones: Record<number, Color>): Board {
  const board = Array<Stone>(size * size).fill(null)
  for (const [key, color] of Object.entries(stones)) {
    board[Number(key)] = color
  }
  return board
}

function playSequence(
  state: GameState,
  points: readonly { x: number; y: number }[],
): GameState {
  let current = state
  for (const point of points) {
    const result = playMove(current, point)
    if (!result.ok) throw new Error(`unexpected failure: ${result.error.code}`)
    current = result.state
  }
  return current
}

describe('createGame', () => {
  it('starts on an empty 15×15 board with black to play', () => {
    const game = createGame()
    expect(game.size).toBe(15)
    expect(game.ruleSet).toBe('free')
    expect(game.toPlay).toBe('black')
    expect(game.board).toHaveLength(225)
    expect(game.board.every((stone) => stone === null)).toBe(true)
  })

  it('rejects unsupported board sizes', () => {
    // @ts-expect-error exercising the runtime guard
    expect(() => createGame(17)).toThrow()
  })
})

describe('playMove', () => {
  it('places stones and alternates colours', () => {
    const game = playSequence(createGame(), [{ x: 7, y: 7 }, { x: 7, y: 8 }])
    expect(game.board[7 * 15 + 7]).toBe('black')
    expect(game.board[8 * 15 + 7]).toBe('white')
    expect(game.toPlay).toBe('black')
    expect(game.moveNumber).toBe(2)
  })

  it('rejects occupied and out-of-bounds points', () => {
    const game = playSequence(createGame(), [{ x: 7, y: 7 }])
    expect(playMove(game, { x: 7, y: 7 }).ok).toBe(false)
    expect(playMove(game, { x: -1, y: 3 }).ok).toBe(false)
    expect(playMove(game, { x: 15, y: 3 }).ok).toBe(false)
  })

  it('detects a horizontal win and reports the winning line', () => {
    const game = playSequence(createGame(), [
      { x: 0, y: 0 }, { x: 0, y: 1 },
      { x: 1, y: 0 }, { x: 1, y: 1 },
      { x: 2, y: 0 }, { x: 2, y: 1 },
      { x: 3, y: 0 }, { x: 3, y: 1 },
      { x: 4, y: 0 },
    ])

    expect(game.phase).toBe('finished')
    expect(game.winner).toBe('black')
    expect(game.finishReason).toBe('five')
    expect(game.winLine).toEqual([0, 1, 2, 3, 4])
  })

  it('detects vertical and diagonal wins', () => {
    const vertical = playSequence(createGame(), [
      { x: 1, y: 1 }, { x: 5, y: 5 },
      { x: 1, y: 2 }, { x: 6, y: 5 },
      { x: 1, y: 3 }, { x: 7, y: 5 },
      { x: 1, y: 4 }, { x: 8, y: 5 },
      { x: 1, y: 5 },
    ])
    expect(vertical.winner).toBe('black')
    expect(vertical.winLine).toEqual([
      1 * 15 + 1,
      2 * 15 + 1,
      3 * 15 + 1,
      4 * 15 + 1,
      5 * 15 + 1,
    ])

    const diagonal = playSequence(createGame(), [
      { x: 2, y: 2 }, { x: 0, y: 5 },
      { x: 3, y: 3 }, { x: 0, y: 6 },
      { x: 4, y: 4 }, { x: 0, y: 7 },
      { x: 5, y: 5 }, { x: 0, y: 8 },
      { x: 6, y: 6 },
    ])
    expect(diagonal.winner).toBe('black')
    expect(diagonal.winLine).toHaveLength(5)
  })

  it('lets an overline win under free-style rules', () => {
    const board = boardFrom(15, {
      [0]: 'black', [1]: 'black', [2]: 'black', [3]: 'black', [5]: 'black',
    })
    const line = findWinLine(board, 15, 4, 'black', 'free')
    expect(line).not.toBeNull()
  })

  it('does not let a black overline win under renju rules', () => {
    const board = boardFrom(15, {
      [0]: 'black', [1]: 'black', [2]: 'black', [3]: 'black', [5]: 'black',
    })
    expect(findWinLine(board, 15, 4, 'black', 'renju')).toBeNull()
  })

  it('plays a black overline when renju restrictions are off', () => {
    const board = boardFrom(15, {
      [0]: 'black', [1]: 'black', [2]: 'black', [3]: 'black', [5]: 'black',
    })
    const game: GameState = { ...createGame(15, 'free'), board, moveNumber: 5 }
    const result = playMove(game, { x: 4, y: 0 })

    expect(result.ok).toBe(true)
    if (result.ok) {
      expect(result.state.winner).toBe('black')
      expect(result.state.finishReason).toBe('five')
    }
  })

  it('blocks a black overline as a forbidden move under renju rules', () => {
    const board = boardFrom(15, {
      [0]: 'black', [1]: 'black', [2]: 'black', [3]: 'black', [5]: 'black',
    })
    const game: GameState = { ...createGame(15, 'renju'), board, moveNumber: 5 }
    const result = playMove(game, { x: 4, y: 0 })
    expect(result.ok).toBe(false)
    if (!result.ok) expect(result.error.code).toBe('forbidden')
  })

  it('declares a draw when the last point is filled without a win', () => {
    const size: BoardSize = 13
    const board = Array<Stone>(size * size).fill(null)
    const palette: Stone[] = ['black', 'black', 'white', 'white']
    for (let y = 0; y < size; y += 1) {
      for (let x = 0; x < size; x += 1) {
        if (x === 0 && y === 0) continue
        board[y * size + x] = palette[(x + 2 * y) % 4] ?? null
      }
    }

    const game: GameState = {
      ...createGame(size, 'free'),
      board,
      moveNumber: size * size - 1,
      toPlay: 'black',
    }
    const result = playMove(game, { x: 0, y: 0 })

    expect(result.ok).toBe(true)
    if (result.ok) {
      expect(result.state.phase).toBe('finished')
      expect(result.state.winner).toBe('draw')
      expect(result.state.finishReason).toBe('draw')
    }
  })
})

describe('undo', () => {
  it('restores the previous position and turn', () => {
    const game = playSequence(createGame(), [{ x: 7, y: 7 }, { x: 7, y: 8 }])
    const result = undo(game)
    expect(result.ok).toBe(true)
    if (result.ok) {
      expect(result.state.board[8 * 15 + 7]).toBeNull()
      expect(result.state.toPlay).toBe('white')
      expect(result.state.moveNumber).toBe(1)
    }
  })

  it('reports when there is nothing to undo', () => {
    const result = undo(createGame())
    expect(result.ok).toBe(false)
    if (!result.ok) expect(result.error.code).toBe('nothing-to-undo')
  })

  it('reopens a finished game', () => {
    const game = playSequence(createGame(), [
      { x: 0, y: 0 }, { x: 0, y: 1 },
      { x: 1, y: 0 }, { x: 1, y: 1 },
      { x: 2, y: 0 }, { x: 2, y: 1 },
      { x: 3, y: 0 }, { x: 3, y: 1 },
      { x: 4, y: 0 },
    ])
    const result = undo(game)
    expect(result.ok).toBe(true)
    if (result.ok) {
      expect(result.state.phase).toBe('playing')
      expect(result.state.winner).toBeNull()
      expect(result.state.winLine).toEqual([])
    }
  })
})

describe('resign', () => {
  it('awards the win to the opponent', () => {
    const result = resign(createGame(), 'black')
    expect(result.ok).toBe(true)
    if (result.ok) {
      expect(result.state.phase).toBe('finished')
      expect(result.state.winner).toBe('white')
      expect(result.state.finishReason).toBe('resignation')
      expect(result.state.resignedBy).toBe('black')
    }
  })
})

describe('listLegalMoves', () => {
  it('lists every empty point on an empty board', () => {
    expect(listLegalMoves(createGame())).toHaveLength(225)
  })

  it('excludes forbidden points for black under renju rules', () => {
    const board = boardFrom(15, {
      [0]: 'black', [1]: 'black', [2]: 'black', [3]: 'black', [5]: 'black',
    })
    const game: GameState = {
      ...createGame(15, 'renju'),
      board,
      moveNumber: 5,
      toPlay: 'black',
    }
    const legal = listLegalMoves(game)
    expect(legal).toHaveLength(225 - 6)
    expect(legal.some((point) => point.x === 4 && point.y === 0)).toBe(false)
  })

  it('returns nothing once the game is finished', () => {
    const game = playSequence(createGame(), [
      { x: 0, y: 0 }, { x: 0, y: 1 },
      { x: 1, y: 0 }, { x: 1, y: 1 },
      { x: 2, y: 0 }, { x: 2, y: 1 },
      { x: 3, y: 0 }, { x: 3, y: 1 },
      { x: 4, y: 0 },
    ])
    expect(listLegalMoves(game)).toHaveLength(0)
  })
})

describe('findWinLine', () => {
  it('returns null for a four', () => {
    const board = boardFrom(15, { [0]: 'white', [1]: 'white', [2]: 'white' })
    expect(findWinLine(board, 15, 3, 'white', 'free')).toBeNull()
  })

  it('returns five indexes for a completed line', () => {
    const board = boardFrom(15, {
      [0]: 'white', [1]: 'white', [2]: 'white', [3]: 'white',
    })
    const line = findWinLine(board, 15, 4, 'white', 'free')
    expect(line).toEqual([0, 1, 2, 3, 4])
  })
})

describe('forbiddenReason', () => {
  it('never forbids white', () => {
    const board = boardFrom(15, {
      [0]: 'white', [1]: 'white', [2]: 'white', [3]: 'white', [5]: 'white',
    })
    expect(forbiddenReason(board, 15, { x: 4, y: 0 }, 'white')).toBeNull()
  })

  it('flags a long connection for black', () => {
    const board = boardFrom(15, {
      [0]: 'black', [1]: 'black', [2]: 'black', [3]: 'black', [5]: 'black',
    })
    expect(forbiddenReason(board, 15, { x: 4, y: 0 }, 'black')).toBe('overline')
  })

  it('flags a double four', () => {
    const size = 15
    const at = (x: number, y: number) => y * size + x
    const board = boardFrom(size, {
      [at(2, 5)]: 'black',
      [at(3, 5)]: 'black',
      [at(4, 5)]: 'black',
      [at(5, 2)]: 'black',
      [at(5, 3)]: 'black',
      [at(5, 4)]: 'black',
    })
    expect(forbiddenReason(board, size, { x: 5, y: 5 }, 'black')).toBe('double-four')
  })

  it('flags a double three', () => {
    const size = 15
    const at = (x: number, y: number) => y * size + x
    const board = boardFrom(size, {
      [at(3, 5)]: 'black',
      [at(4, 5)]: 'black',
      [at(5, 3)]: 'black',
      [at(5, 4)]: 'black',
    })
    expect(forbiddenReason(board, size, { x: 5, y: 5 }, 'black')).toBe('double-three')
  })

  it('allows a double three that completes five', () => {
    const size = 15
    const at = (x: number, y: number) => y * size + x
    const board = boardFrom(size, {
      [at(1, 5)]: 'black',
      [at(2, 5)]: 'black',
      [at(3, 5)]: 'black',
      [at(4, 5)]: 'black',
      [at(5, 3)]: 'black',
      [at(5, 4)]: 'black',
    })
    expect(forbiddenReason(board, size, { x: 5, y: 5 }, 'black')).toBeNull()
  })

  it('allows ordinary shapes', () => {
    const board = boardFrom(15, { [15]: 'black' })
    expect(forbiddenReason(board, 15, { x: 3, y: 3 }, 'black')).toBeNull()
  })
})
