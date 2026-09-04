import type { MoveSource } from './ai'
import type { EngineStrength } from './strength'
import type { Board, BoardSize, Color } from '../game/types'

export interface GenerateMoveInput {
  readonly board: Board
  readonly size: BoardSize
  readonly color: Color
  readonly strength: EngineStrength
  readonly ruleSet?: 'free' | 'renju'
  /** Forbidden indexes (renju black) that the engine must avoid. */
  readonly forbidden?: readonly number[]
  readonly generation?: number
  readonly signal?: AbortSignal
}

export interface EngineDecision {
  readonly index: number
  readonly score: number
  readonly nodes: number
  readonly depth: number
  readonly source: 'worker' | 'fallback'
  readonly moveSource: MoveSource
}

export type EngineKind = 'built-in' | 'rapfi'

/**
 * Common contract for every dufive engine. Implementations must serialise
 * their operations and reject stale replies, so that a move from an undone or
 * restarted game can never reach the board.
 */
export interface EnginePort {
  readonly generation: number
  init(): Promise<string>
  invalidate(nextGeneration?: number): number
  generateMove(input: GenerateMoveInput): Promise<EngineDecision>
  dispose(): void
}
