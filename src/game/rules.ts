import { indexToPoint, isOnBoard, pointToIndex, runThrough } from './board'
import { forbiddenReason } from './forbidden'
import {
  BOARD_SIZES,
  type Board,
  type BoardSize,
  type Color,
  type GameErrorCode,
  type GameFrame,
  type GameResult,
  type GameState,
  type Point,
  type RuleSet,
  type Stone,
} from './types'
import { DIRECTIONS } from './board'

const ERROR_MESSAGES: Record<GameErrorCode, string> = {
  finished: '这一局已经结束了。',
  'out-of-bounds': '落子超出了棋盘。',
  occupied: '这个交叉点已经有棋子。',
  forbidden: '黑方禁手：长连、双四、双三不可落子。',
  'nothing-to-undo': '还没有可以撤销的落子。',
}

function success(state: GameState): GameResult {
  return { ok: true, state }
}

function failure(state: GameState, code: GameErrorCode): GameResult {
  return {
    ok: false,
    state,
    error: { code, message: ERROR_MESSAGES[code] },
  }
}

function frameFromState(state: GameState): GameFrame {
  return {
    size: state.size,
    ruleSet: state.ruleSet,
    board: state.board,
    toPlay: state.toPlay,
    moveNumber: state.moveNumber,
    phase: state.phase,
    winner: state.winner,
    winLine: state.winLine,
    finishReason: state.finishReason,
    resignedBy: state.resignedBy,
    moves: state.moves,
    lastMove: state.lastMove,
  }
}

function withHistory(
  state: GameState,
  next: Omit<GameFrame, 'size' | 'ruleSet'>,
): GameState {
  return {
    size: state.size,
    ruleSet: state.ruleSet,
    ...next,
    revision: state.revision + 1,
    history: [...state.history, frameFromState(state)],
  }
}

/**
 * Returns the five indexes that form the winning line through `index`, or
 * `null`. Under renju rules a black overline is not a win, so runs longer than
 * five are rejected for black.
 */
export function findWinLine(
  board: Board,
  size: BoardSize,
  index: number,
  color: Color,
  ruleSet: RuleSet = 'free',
): number[] | null {
  if (board[index] !== color) {
    const placed = [...board]
    placed[index] = color
    return findWinLine(placed, size, index, color, ruleSet)
  }

  for (const direction of DIRECTIONS) {
    const run = runThrough(board, size, index, direction)
    if (run.length < 5) continue
    if (run.length > 5 && ruleSet === 'renju' && color === 'black') continue

    const position = run.indexOf(index)
    const start = Math.max(0, Math.min(position, run.length - 5))
    return run.slice(start, start + 5)
  }

  return null
}

export function createGame(
  size: BoardSize = 15,
  ruleSet: RuleSet = 'free',
): GameState {
  if (!BOARD_SIZES.includes(size)) {
    throw new Error('Board size must be 13, 15, or 19')
  }

  return {
    size,
    ruleSet,
    board: Array<Stone>(size * size).fill(null),
    toPlay: 'black',
    moveNumber: 0,
    phase: 'playing',
    winner: null,
    winLine: [],
    finishReason: null,
    resignedBy: null,
    moves: [],
    lastMove: null,
    revision: 0,
    history: [],
  }
}

export function playMove(state: GameState, point: Point): GameResult {
  if (state.phase === 'finished') return failure(state, 'finished')
  if (!isOnBoard(point, state.size)) return failure(state, 'out-of-bounds')

  const index = pointToIndex(point, state.size)
  if (state.board[index] !== null) return failure(state, 'occupied')

  const color = state.toPlay
  if (
    state.ruleSet === 'renju'
    && forbiddenReason(state.board, state.size, point, color)
  ) {
    return failure(state, 'forbidden')
  }

  const board = [...state.board]
  board[index] = color

  const move = { number: state.moveNumber + 1, color, point }
  const moveNumber = state.moveNumber + 1
  const winLine = findWinLine(board, state.size, index, color, state.ruleSet)

  if (winLine) {
    return success(withHistory(state, {
      board,
      toPlay: color,
      moveNumber,
      phase: 'finished',
      winner: color,
      winLine,
      finishReason: 'five',
      resignedBy: null,
      moves: [...state.moves, move],
      lastMove: move,
    }))
  }

  const boardFull = moveNumber >= state.size * state.size

  return success(withHistory(state, {
    board,
    toPlay: color === 'black' ? 'white' : 'black',
    moveNumber,
    phase: boardFull ? 'finished' : 'playing',
    winner: boardFull ? 'draw' : null,
    winLine: [],
    finishReason: boardFull ? 'draw' : null,
    resignedBy: null,
    moves: [...state.moves, move],
    lastMove: move,
  }))
}

export function listLegalMoves(state: GameState): readonly Point[] {
  if (state.phase !== 'playing') return []

  const checkForbidden = state.ruleSet === 'renju'
  const legal: Point[] = []
  for (let index = 0; index < state.board.length; index += 1) {
    if (state.board[index] !== null) continue
    const point = indexToPoint(index, state.size)
    if (
      checkForbidden
      && forbiddenReason(state.board, state.size, point, state.toPlay)
    ) continue
    legal.push(point)
  }

  return legal
}

export function undo(state: GameState): GameResult {
  const previous = state.history[state.history.length - 1]
  if (!previous) return failure(state, 'nothing-to-undo')

  return success({
    ...previous,
    revision: state.revision + 1,
    history: state.history.slice(0, -1),
  })
}

export function resign(
  state: GameState,
  color: Color = state.toPlay,
): GameResult {
  if (state.phase === 'finished') return failure(state, 'finished')

  return success(withHistory(state, {
    ...frameFromState(state),
    phase: 'finished',
    winner: color === 'black' ? 'white' : 'black',
    finishReason: 'resignation',
    resignedBy: color,
  }))
}
