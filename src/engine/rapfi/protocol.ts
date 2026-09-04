import type { GenerateMoveInput } from '../port'
import type { EngineWorkerPort } from '../protocol'
import type { EngineStrengthProfile } from '../strength'
import type { Board, BoardSize, Color } from '../../game/types'

/**
 * Piskvork protocol helpers shared by RapfiEngine.ts and the worker glue in
 * `public/engine/rapfi/worker-rapfi.js`.
 *
 * The vendored build preloads `config.toml` with
 * `coord_conversion_mode = "none"`, so Rapfi speaks raw Piskvork coordinates:
 * `Pos(x, y)` packs row-major (`moveIndex() = y * stride + x` in
 * `core/pos.h`) exactly like our `index = y * size + x`, and both
 * `inputCoordConvert` and `outputCoordConvert` are the identity. Therefore
 * `x` is the column, `y` is the row, and the origin is the top-left corner.
 */
export const RAPFI_ENGINE_NAME = 'Rapfi'

/** Piskvork `INFO rule` codes understood by Rapfi's `getOption`. */
export const RAPFI_RULE_CODES: Record<'free' | 'renju', number> = {
  free: 0,
  renju: 2,
}

/** The worker waits for `profile.timeBudgetMs` plus this slack before giving
 * up on a search reply. */
export const RAPFI_SEARCH_SLACK_MS = 10_000

export interface RapfiCoord {
  readonly x: number
  readonly y: number
}

export function indexToCoord(index: number, size: BoardSize): RapfiCoord {
  return { x: index % size, y: Math.floor(index / size) }
}

export function coordToIndex(x: number, y: number, size: number): number {
  return y * size + x
}

const MOVE_LINE_PATTERN = /^(-?\d+),(-?\d+)$/

/**
 * Parses a bare `x,y` engine reply. Piskvork status lines (`OK`,
 * `MESSAGE …`, `ERROR …`, `FORBID …`) never match, so they are ignored.
 */
export function parseMoveLine(line: string): RapfiCoord | null {
  const match = MOVE_LINE_PATTERN.exec(line.trim())
  if (!match) return null
  return { x: Number(match[1]), y: Number(match[2]) }
}

/** Extracts the version from an `ABOUT` reply line. */
export function parseAboutVersion(line: string): string | null {
  if (!line.includes(`name="${RAPFI_ENGINE_NAME}"`)) return null
  const match = /version="([^"]*)"/.exec(line)
  return match?.[1] ?? null
}

function coordText(index: number, size: BoardSize): string {
  const { x, y } = indexToCoord(index, size)
  return `${x},${y}`
}

/**
 * Builds the multi-line `BOARD … DONE` block. Stones are replayed in a
 * synthesised alternating order (black first, as in every real game) so the
 * side to move after the block matches `color`. Piskvork side flags: 1 is the
 * engine's own colour, 2 is the opponent.
 *
 * The whole block must be pushed through one `Module.sendCommand` call: an
 * Emscripten stdin read that finds the queue empty sees EOF, which makes
 * `runProtocol` exit the engine.
 */
export function buildBoardBlock(board: Board, size: BoardSize, color: Color): string {
  const blacks: number[] = []
  const whites: number[] = []
  for (let index = 0; index < board.length; index += 1) {
    const stone = board[index]
    if (stone === 'black') blacks.push(index)
    else if (stone === 'white') whites.push(index)
  }

  const blackFlag = color === 'black' ? 1 : 2
  const whiteFlag = color === 'black' ? 2 : 1
  const entries: string[] = []
  const moveCount = Math.max(blacks.length, whites.length)
  for (let turn = 0; turn < moveCount; turn += 1) {
    const black = blacks[turn]
    const white = whites[turn]
    if (black !== undefined) entries.push(`${coordText(black, size)},${blackFlag}`)
    if (white !== undefined) entries.push(`${coordText(white, size)},${whiteFlag}`)
  }

  return entries.length > 0
    ? `BOARD\n${entries.join('\n')}\nDONE`
    : 'BOARD\nDONE'
}

/**
 * The full command sequence for one move request. `START` resyncs the engine
 * board, the `INFO` lines apply the strength profile, and the final `BOARD`
 * block makes Rapfi think for our side. Every command is a single
 * `sendCommand` payload; the BOARD block carries its own newlines.
 */
export function buildMoveCommands(
  input: GenerateMoveInput,
  profile: EngineStrengthProfile,
): string[] {
  const ruleCode = RAPFI_RULE_CODES[input.ruleSet ?? 'free']
  // Rapfi's skill level is 0-100; derive it from the profile's randomness so
  // weaker levels also choose weaker moves, not just shallower ones.
  const strengthLevel = Math.round((1 - profile.randomness) * 100)

  const commands = [
    `START ${input.size}`,
    `INFO rule ${ruleCode}`,
    `INFO timeout_turn ${profile.timeBudgetMs}`,
    `INFO timeout_match 0`,
    `INFO max_depth ${profile.depth}`,
  ]
  if (strengthLevel < 100) commands.push(`INFO strength ${strengthLevel}`)
  commands.push(buildBoardBlock(input.board, input.size, input.color))
  return commands
}

export type RapfiWorkerRequest =
  | { readonly type: 'init' }
  | { readonly type: 'move'; readonly id: number; readonly commands: readonly string[] }

export type RapfiWorkerResponse =
  | { readonly type: 'ready'; readonly version: string }
  | { readonly type: 'boot-error'; readonly error: string }
  | { readonly type: 'log'; readonly text: string }
  | {
      readonly type: 'response'
      readonly id: number
      readonly ok: boolean
      /** Raw `x,y` reply line; parsed by the engine via `parseMoveLine`. */
      readonly move?: string
      readonly error?: string
    }

export type RapfiWorkerPort = EngineWorkerPort
