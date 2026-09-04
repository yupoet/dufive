import { describe, expect, it } from 'vitest'
import { BLACK, EMPTY, WHITE, createsFive } from '../../evaluate'
import {
  RAPFI_RULE_CODES,
  buildBoardBlock,
  buildMoveCommands,
  coordToIndex,
  indexToCoord,
  parseAboutVersion,
  parseMoveLine,
} from '../protocol'
import type { GenerateMoveInput } from '../../port'
import type { Board, BoardSize } from '../../../game/types'

const SIZE = 15

function emptyBoard(size: BoardSize): Board {
  return Array.from({ length: size * size }, () => null)
}

function withStones(
  size: BoardSize,
  stones: ReadonlyArray<readonly [number, number, 'black' | 'white']>,
): Board {
  const cells: ('black' | 'white' | null)[] = Array.from({ length: size * size }, () => null)
  for (const [x, y, color] of stones) {
    cells[y * size + x] = color
  }
  return cells
}

describe('rapfi coordinate mapping', () => {
  it('maps Piskvork x,y onto our row-major board index', () => {
    // Rapfi packs Pos(x, y) row-major and the vendored build uses
    // coord_conversion_mode = "none", so x is the column and y the row with
    // the origin at the top-left corner.
    expect(coordToIndex(0, 0, SIZE)).toBe(0)
    expect(coordToIndex(14, 14, SIZE)).toBe(SIZE * SIZE - 1)
    expect(coordToIndex(6, 7, SIZE)).toBe(7 * SIZE + 6)

    for (const size of [13, 15, 19] as const) {
      for (const index of [0, size - 1, size * size - 1, 5 * size + 9]) {
        const { x, y } = indexToCoord(index, size)
        expect(coordToIndex(x, y, size)).toBe(index)
      }
    }
  })

  it('encodes a four-in-a-row position as an exact BOARD block', () => {
    // Black has four in a row on row 7 with one open end at (6, 7); white
    // blocks (11, 7) and holds three stones on row 3. Stone counts are
    // 4-4, so it is black to move, exactly like a real game.
    const board = withStones(SIZE, [
      [7, 7, 'black'],
      [8, 7, 'black'],
      [9, 7, 'black'],
      [10, 7, 'black'],
      [11, 7, 'white'],
      [3, 3, 'white'],
      [4, 3, 'white'],
      [5, 3, 'white'],
    ])

    expect(buildBoardBlock(board, SIZE, 'black')).toBe(
      [
        'BOARD',
        '7,7,1',
        '3,3,2',
        '8,7,1',
        '4,3,2',
        '9,7,1',
        '5,3,2',
        '10,7,1',
        '11,7,2',
        'DONE',
      ].join('\n'),
    )
  })

  it('flags the engine side and move order for a white request', () => {
    // One extra black stone (5-4) means it is white to move: the replayed
    // sequence alternates starting with black (flag 2 for the opponent).
    const board = withStones(SIZE, [
      [7, 7, 'black'],
      [8, 8, 'white'],
      [9, 9, 'black'],
      [6, 6, 'white'],
      [5, 5, 'black'],
      [4, 4, 'white'],
      [3, 3, 'black'],
      [2, 2, 'white'],
      [10, 10, 'black'],
    ])

    expect(buildBoardBlock(board, SIZE, 'white')).toBe(
      [
        'BOARD',
        '3,3,2',
        '2,2,1',
        '5,5,2',
        '4,4,1',
        '7,7,2',
        '6,6,1',
        '9,9,2',
        '8,8,1',
        '10,10,2',
        'DONE',
      ].join('\n'),
    )
  })

  it('encodes an empty board for the opening move', () => {
    expect(buildBoardBlock(emptyBoard(SIZE), SIZE, 'black')).toBe('BOARD\nDONE')
  })

  it('round-trips the winning reply coordinate to the winning board index', () => {
    const board = withStones(SIZE, [
      [7, 7, 'black'],
      [8, 7, 'black'],
      [9, 7, 'black'],
      [10, 7, 'black'],
      [11, 7, 'white'],
      [3, 3, 'white'],
      [4, 3, 'white'],
      [5, 3, 'white'],
    ])

    // A correct engine must answer 6,7 (or 11,7 is taken, so 6,7) to win.
    const reply = parseMoveLine('6,7')
    expect(reply).toEqual({ x: 6, y: 7 })

    const index = coordToIndex(reply!.x, reply!.y, SIZE)
    expect(index).toBe(7 * SIZE + 6)
    expect(indexToCoord(index, SIZE)).toEqual({ x: 6, y: 7 })
    expect(board[index]).toBeNull()

    // Placing black at the decoded index really does complete five.
    const cells = new Uint8Array(SIZE * SIZE).fill(EMPTY)
    for (let i = 0; i < board.length; i += 1) {
      cells[i] = board[i] === 'black' ? BLACK : board[i] === 'white' ? WHITE : EMPTY
    }
    cells[index] = 1
    expect(createsFive(cells, SIZE, index, false)).toBe(true)
  })
})

describe('parseMoveLine', () => {
  it('accepts bare x,y replies', () => {
    expect(parseMoveLine('7,7')).toEqual({ x: 7, y: 7 })
    expect(parseMoveLine('0,0')).toEqual({ x: 0, y: 0 })
    expect(parseMoveLine(' 14,14 ')).toEqual({ x: 14, y: 14 })
    expect(parseMoveLine('-1,-1')).toEqual({ x: -1, y: -1 })
  })

  it('rejects status and message lines', () => {
    expect(parseMoveLine('OK')).toBeNull()
    expect(parseMoveLine('MESSAGE OptiTime 00:00.400 | MaxTime 00:01.000')).toBeNull()
    expect(parseMoveLine('ERROR Coord is not valid or empty.')).toBeNull()
    expect(parseMoveLine('FORBID 0707.')).toBeNull()
    expect(parseMoveLine('name="Rapfi", version="0.43.01"')).toBeNull()
    expect(parseMoveLine('a,b')).toBeNull()
    expect(parseMoveLine('1,2,3')).toBeNull()
    expect(parseMoveLine('')).toBeNull()
  })
})

describe('parseAboutVersion', () => {
  it('extracts the version from an ABOUT reply', () => {
    expect(
      parseAboutVersion(
        'name="Rapfi", version="0.43.01 (Clang 17 on wasm32 simd128)", '
          + 'author="Rapfi developers (see AUTHORS file)", country="China"',
      ),
    ).toBe('0.43.01 (Clang 17 on wasm32 simd128)')
  })

  it('ignores unrelated lines', () => {
    expect(parseAboutVersion('MESSAGE hello')).toBeNull()
    expect(parseAboutVersion('OK')).toBeNull()
  })
})

describe('buildMoveCommands', () => {
  const input = (overrides: Partial<GenerateMoveInput>): GenerateMoveInput => ({
    board: withStones(SIZE, [
      [7, 7, 'black'],
      [8, 8, 'white'],
    ]),
    size: SIZE,
    color: 'black',
    strength: 'high',
    ...overrides,
  })

  it('emits the setup commands and the BOARD block', () => {
    const commands = buildMoveCommands(input({}), {
      label: '高级',
      detail: '',
      depth: 4,
      rootWidth: 12,
      innerWidth: 10,
      timeBudgetMs: 3_000,
      randomness: 0,
      useVcf: true,
    })

    expect(commands).toEqual([
      'START 15',
      'INFO rule 0',
      'INFO timeout_turn 3000',
      'INFO timeout_match 0',
      'INFO max_depth 4',
      'BOARD\n7,7,1\n8,8,2\nDONE',
    ])
  })

  it('uses the renju rule code and handicaps weaker strengths', () => {
    const commands = buildMoveCommands(
      input({ ruleSet: 'renju', strength: 'low' }),
      {
        label: '入门',
        detail: '',
        depth: 1,
        rootWidth: 10,
        innerWidth: 8,
        timeBudgetMs: 400,
        randomness: 0.32,
        useVcf: false,
      },
    )

    expect(commands).toContain('INFO rule 2')
    expect(commands).toContain('INFO timeout_turn 400')
    expect(commands).toContain('INFO max_depth 1')
    // randomness 0.32 -> skill level 68 < 100, so the INFO is sent.
    expect(commands).toContain('INFO strength 68')
  })

  it('sends no strength handicap for full strength', () => {
    const commands = buildMoveCommands(input({ strength: 'full' }), {
      label: '高级',
      detail: '',
      depth: 6,
      rootWidth: 14,
      innerWidth: 10,
      timeBudgetMs: 6_000,
      randomness: 0,
      useVcf: true,
    })
    expect(commands.some((command) => command.startsWith('INFO strength'))).toBe(false)
  })

  it('exposes the piskvork rule codes used above', () => {
    expect(RAPFI_RULE_CODES.free).toBe(0)
    expect(RAPFI_RULE_CODES.renju).toBe(2)
  })
})
