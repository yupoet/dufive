import type { MoveSource } from './ai'
import type { Cell } from './evaluate'
import type { EngineStrength } from './strength'

export const ENGINE_VERSION = 'dufive-1.0'

export interface MovePayload {
  readonly cells: readonly number[]
  readonly size: number
  readonly color: Cell
  readonly strength: EngineStrength
  readonly exactFiveForBlack?: boolean
  readonly forbidden?: readonly number[]
}

export type WorkerRequest =
  | { readonly type: 'move'; readonly id: number; readonly payload: MovePayload }
  | { readonly type: 'cancel'; readonly id: number }

export type WorkerResponse =
  | { readonly type: 'ready'; readonly version: string }
  | { readonly type: 'log'; readonly text: string }
  | {
      readonly type: 'response'
      readonly id: number
      readonly ok: boolean
      readonly index?: number | null
      readonly score?: number
      readonly nodes?: number
      readonly depth?: number
      readonly moveSource?: MoveSource
      readonly error?: string
    }

export interface EngineWorkerPort {
  onmessage: ((event: { data: unknown }) => void) | null
  onerror: ((event: { message?: string }) => void) | null
  onmessageerror: ((event: unknown) => void) | null
  postMessage(message: unknown): void
  terminate(): void
}
