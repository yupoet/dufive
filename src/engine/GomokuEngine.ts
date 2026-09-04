import { chooseMove, type MoveSource } from './ai'
import { encodeBoard, encodeColor } from './codec'
import type { Cell } from './evaluate'
import {
  ENGINE_VERSION,
  type EngineWorkerPort,
  type MovePayload,
  type WorkerRequest,
  type WorkerResponse,
} from './protocol'
import {
  fallbackProfile,
} from './strength'
import type {
  EngineDecision,
  EnginePort,
  GenerateMoveInput,
} from './port'
import type { Board, BoardSize, Color, Point } from '../game/types'

export interface GomokuEngineOptions {
  readonly workerFactory?: () => EngineWorkerPort
  readonly bootTimeoutMs?: number
  readonly searchTimeoutMs?: number
  readonly random?: () => number
}

type RuntimeErrorCode =
  | 'boot'
  | 'crash'
  | 'disposed'
  | 'protocol'
  | 'timeout'
  | 'no-move'

interface WorkerState {
  readonly worker: EngineWorkerPort
  readonly ready: Promise<string>
  readonly resolveReady: (version: string) => void
  readonly rejectReady: (error: Error) => void
  readySettled: boolean
  readonly bootTimer: ReturnType<typeof setTimeout>
}

interface PendingRequest {
  readonly epoch: number
  readonly resolve: (response: WorkerResponse & { type: 'response' }) => void
  readonly reject: (error: Error) => void
  readonly timer: ReturnType<typeof setTimeout>
}

interface QueueJob {
  generation: number
  signal?: AbortSignal
  operation: () => Promise<unknown>
  resolve: (value: unknown) => void
  reject: (error: Error) => void
  abortListener?: () => void
  settled: boolean
}

const DEFAULT_BOOT_TIMEOUT_MS = 8_000
const DEFAULT_SEARCH_TIMEOUT_MS = 20_000

export class EngineRuntimeError extends Error {
  readonly code: RuntimeErrorCode

  constructor(code: RuntimeErrorCode, message: string) {
    super(message)
    this.name = 'EngineRuntimeError'
    this.code = code
  }
}

export class EngineCancelledError extends Error {
  readonly reason: 'aborted' | 'superseded'

  constructor(reason: 'aborted' | 'superseded', message: string) {
    super(message)
    this.name = 'EngineCancelledError'
    this.reason = reason
  }
}

export function isEngineCancellation(error: unknown): error is EngineCancelledError {
  return error instanceof EngineCancelledError
}

function defaultWorkerFactory(): EngineWorkerPort {
  const worker = new Worker(new URL('./worker.ts', import.meta.url), {
    type: 'module',
    name: 'dufive-ai',
  })
  return worker as unknown as EngineWorkerPort
}

function errorMessage(error: unknown): string {
  return error instanceof Error ? error.message : String(error)
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null
}

function isWorkerResponse(value: unknown): value is WorkerResponse {
  return isRecord(value) && typeof value.type === 'string'
}

function toPayload(input: GenerateMoveInput): MovePayload {
  return {
    cells: [...encodeBoard(input.board)],
    size: input.size,
    color: encodeColor(input.color),
    strength: input.strength,
    exactFiveForBlack: input.ruleSet === 'renju',
    forbidden: input.forbidden ? [...input.forbidden] : undefined,
  }
}

/**
 * Runs the search in a Web Worker. Operations are serialised, tagged with the
 * game revision, and cancellable, so a reply from an undone or restarted game
 * can never be applied.
 */
export class GomokuEngine implements EnginePort {
  private readonly workerFactory: () => EngineWorkerPort
  private readonly bootTimeoutMs: number
  private readonly searchTimeoutMs: number
  private readonly random: () => number

  private workerState: WorkerState | null = null
  private pending = new Map<number, PendingRequest>()
  private queue: QueueJob[] = []
  private activeJob: QueueJob | null = null
  private nextRequestId = 0
  private generationValue = 0
  private disposed = false

  constructor(options: GomokuEngineOptions = {}) {
    this.workerFactory = options.workerFactory ?? defaultWorkerFactory
    this.bootTimeoutMs = options.bootTimeoutMs ?? DEFAULT_BOOT_TIMEOUT_MS
    this.searchTimeoutMs = options.searchTimeoutMs ?? DEFAULT_SEARCH_TIMEOUT_MS
    this.random = options.random ?? Math.random
  }

  get generation(): number {
    return this.generationValue
  }

  init(): Promise<string> {
    this.assertNotDisposed()
    return this.ensureReady()
  }

  generateMove(input: GenerateMoveInput): Promise<EngineDecision> {
    const generation = input.generation ?? this.generationValue

    return this.enqueue(generation, input.signal, async () => {
      // Booting lives inside the try block so a worker that cannot start at
      // all falls through to the main-thread fallback instead of rejecting
      // every move.
      try {
        await this.ensureReady()
        const response = await this.request(
          'move',
          toPayload(input),
          generation,
        )
        const index = response.index

        if (typeof index !== 'number' || !Number.isInteger(index)) {
          throw new EngineRuntimeError('protocol', '搜子引擎没有返回落点')
        }
        if (index < 0 || index >= input.board.length) {
          throw new EngineRuntimeError('protocol', '搜子引擎返回了越界落点')
        }
        if (input.board[index] !== null) {
          throw new EngineRuntimeError('protocol', '搜子引擎返回了已占用的落点')
        }
        if (input.forbidden?.includes(index)) {
          throw new EngineRuntimeError('protocol', '搜子引擎返回了禁手点')
        }

        return {
          index,
          score: response.score ?? 0,
          nodes: response.nodes ?? 0,
          depth: response.depth ?? 0,
          source: 'worker' as const,
          moveSource: response.moveSource ?? ('search' as MoveSource),
        }
      } catch (error) {
        if (isEngineCancellation(error)) throw error
        return this.searchOnMainThread(input, errorMessage(error))
      }
    }) as Promise<EngineDecision>
  }

  /**
   * Invalidates every queued or running operation from an older game
   * revision. A synchronous search cannot be interrupted, so the worker is
   * terminated when it is busy with stale work.
   */
  invalidate(nextGeneration = this.generationValue + 1): number {
    if (!Number.isSafeInteger(nextGeneration)) {
      throw new TypeError('Engine generation must be a safe integer')
    }

    this.generationValue = nextGeneration
    const error = new EngineCancelledError(
      'superseded',
      'Gomoku search was superseded by a newer game revision',
    )

    const staleJobs = this.queue.filter((job) => job.generation !== nextGeneration)
    this.queue = this.queue.filter((job) => job.generation === nextGeneration)
    for (const job of staleJobs) this.rejectJob(job, error)

    if (this.activeJob && this.activeJob.generation !== nextGeneration) {
      this.rejectJob(this.activeJob, error)
      this.destroyWorker(error)
    }

    return nextGeneration
  }

  dispose(): void {
    if (this.disposed) return
    this.disposed = true

    const error = new EngineRuntimeError('disposed', 'Gomoku engine has been disposed')
    for (const job of this.queue.splice(0)) this.rejectJob(job, error)
    if (this.activeJob) this.rejectJob(this.activeJob, error)
    this.destroyWorker(error)
  }

  /**
   * Last-resort path when the worker cannot start: run a shallow search on the
   * main thread so the game stays playable offline.
   */
  private searchOnMainThread(
    input: GenerateMoveInput,
    reason: string,
  ): EngineDecision {
    const cells = encodeBoard(input.board)
    const color: Cell = encodeColor(input.color)
    const forbidden = input.forbidden ? new Set(input.forbidden) : undefined
    const profile = fallbackProfile(input.strength)

    const decision = chooseMove({
      cells,
      size: input.size,
      color,
      strength: input.strength,
      exactFiveForBlack: input.ruleSet === 'renju',
      forbidden: forbidden ? (index) => forbidden.has(index) : undefined,
      random: this.random,
      profileOverride: profile,
    })

    if (decision.index === null) {
      throw new EngineRuntimeError('no-move', `${reason}；且没有可用落点。`)
    }

    return {
      index: decision.index,
      score: decision.score,
      nodes: decision.nodes,
      depth: decision.depth,
      source: 'fallback',
      moveSource: decision.source,
    }
  }

  private ensureReady(): Promise<string> {
    if (this.workerState) return this.workerState.ready

    let resolveReady: (version: string) => void = () => {}
    let rejectReady: (error: Error) => void = () => {}
    const ready = new Promise<string>((resolve, reject) => {
      resolveReady = resolve
      rejectReady = reject
    })
    ready.catch(() => {
      // Prevented unhandled rejection; callers await generateMove instead.
    })

    let worker: EngineWorkerPort
    try {
      worker = this.workerFactory()
    } catch (error) {
      const failure = new EngineRuntimeError(
        'boot',
        `无法创建搜子 worker：${errorMessage(error)}`,
      )
      this.workerState = null
      return Promise.reject(failure)
    }

    const state: WorkerState = {
      worker,
      ready,
      resolveReady,
      rejectReady,
      readySettled: false,
      bootTimer: setTimeout(() => {
        state.readySettled = true
        rejectReady(
          new EngineRuntimeError('boot', '搜子引擎启动超时'),
        )
        this.destroyWorker(
          new EngineRuntimeError('boot', '搜子引擎启动超时'),
        )
      }, this.bootTimeoutMs),
    }

    worker.onmessage = (event: { data: unknown }) => {
      const message = event.data
      if (!isWorkerResponse(message)) return

      if (message.type === 'ready') {
        if (state.readySettled) return
        state.readySettled = true
        clearTimeout(state.bootTimer)
        state.resolveReady(
          typeof message.version === 'string'
            ? message.version
            : ENGINE_VERSION,
        )
        return
      }

      if (message.type === 'log') return

      if (message.type === 'response') {
        const pending = this.pending.get(message.id)
        if (!pending) return
        this.pending.delete(message.id)
        clearTimeout(pending.timer)
        pending.resolve(message)
      }
    }

    worker.onerror = (event: { message?: string }) => {
      const error = new EngineRuntimeError(
        'crash',
        `搜子引擎异常：${event.message ?? 'unknown'}`,
      )
      if (!state.readySettled) {
        state.readySettled = true
        clearTimeout(state.bootTimer)
        state.rejectReady(error)
      }
      this.rejectAllPending(error)
      this.destroyWorker(error)
    }

    worker.onmessageerror = () => {
      const error = new EngineRuntimeError(
        'protocol',
        '搜子引擎返回了无法解析的消息',
      )
      this.rejectAllPending(error)
    }

    this.workerState = state
    return state.ready
  }

  private request(
    kind: 'move',
    payload: MovePayload,
    generation: number,
  ): Promise<WorkerResponse & { type: 'response' }> {
    const state = this.workerState
    if (!state) {
      return Promise.reject(
        new EngineRuntimeError('disposed', '搜子引擎尚未启动'),
      )
    }

    this.nextRequestId += 1
    const id = this.nextRequestId
    const message: WorkerRequest = { type: kind, id, payload }

    return new Promise((resolve, reject) => {
      const timer = setTimeout(() => {
        this.pending.delete(id)
        state.worker.postMessage({ type: 'cancel', id } satisfies WorkerRequest)
        reject(new EngineRuntimeError('timeout', '搜子引擎思考超时'))
        this.destroyWorker(
          new EngineRuntimeError('timeout', '搜子引擎思考超时'),
        )
      }, this.searchTimeoutMs)

      this.pending.set(id, { epoch: generation, resolve, reject, timer })
      state.worker.postMessage(message)
    })
  }

  private rejectAllPending(error: Error): void {
    for (const pending of this.pending.values()) {
      clearTimeout(pending.timer)
      pending.reject(error)
    }
    this.pending.clear()
  }

  private destroyWorker(error: Error): void {
    const state = this.workerState
    if (!state) return

    clearTimeout(state.bootTimer)
    // A worker destroyed while it is still booting must settle `ready`,
    // otherwise queued jobs keep awaiting a promise that never resolves and
    // the queue deadlocks.
    if (!state.readySettled) {
      state.readySettled = true
      state.rejectReady(error)
    }
    for (const pending of this.pending.values()) {
      clearTimeout(pending.timer)
      pending.reject(error)
    }
    this.pending.clear()
    state.worker.onmessage = null
    state.worker.onerror = null
    state.worker.onmessageerror = null
    state.worker.terminate()
    this.workerState = null
  }

  private enqueue<T>(
    generation: number,
    signal: AbortSignal | undefined,
    operation: () => Promise<T>,
  ): Promise<T> {
    try {
      this.assertRunnable(generation, signal)
    } catch (error) {
      return Promise.reject(error)
    }

    return new Promise<T>((resolve, reject) => {
      const job: QueueJob = {
        generation,
        signal,
        operation,
        resolve: (value) => resolve(value as T),
        reject,
        settled: false,
      }

      if (signal) {
        job.abortListener = () => {
          const error = new EngineCancelledError(
            'aborted',
            'Gomoku search was aborted',
          )
          if (job === this.activeJob) {
            this.rejectJob(job, error)
            this.destroyWorker(error)
          } else {
            this.queue = this.queue.filter((queued) => queued !== job)
            this.rejectJob(job, error)
          }
        }
        signal.addEventListener('abort', job.abortListener, { once: true })
      }

      this.queue.push(job)
      this.drainQueue()
    })
  }

  private drainQueue(): void {
    if (this.activeJob || this.disposed) return

    while (this.queue.length > 0) {
      const job = this.queue.shift()
      if (!job || job.settled) continue

      try {
        this.assertRunnable(job.generation, job.signal)
      } catch (error) {
        this.rejectJob(job, error)
        continue
      }

      this.activeJob = job
      void this.runJob(job)
      return
    }
  }

  private async runJob(job: QueueJob): Promise<void> {
    try {
      const value = await job.operation()
      this.assertRunnable(job.generation, job.signal)
      this.resolveJob(job, value)
    } catch (error) {
      this.rejectJob(
        job,
        error instanceof Error ? error : new Error(String(error)),
      )
    } finally {
      if (this.activeJob === job) this.activeJob = null
      this.drainQueue()
    }
  }

  private resolveJob(job: QueueJob, value: unknown): void {
    if (job.settled) return
    job.settled = true
    this.removeAbortListener(job)
    job.resolve(value)
  }

  private rejectJob(job: QueueJob, error: unknown): void {
    if (job.settled) return
    job.settled = true
    this.removeAbortListener(job)
    job.reject(error instanceof Error ? error : new Error(String(error)))
  }

  private removeAbortListener(job: QueueJob): void {
    if (job.signal && job.abortListener) {
      job.signal.removeEventListener('abort', job.abortListener)
    }
  }

  private assertNotDisposed(): void {
    if (this.disposed) {
      throw new EngineRuntimeError('disposed', 'Gomoku engine has been disposed')
    }
  }

  private assertRunnable(generation: number, signal?: AbortSignal): void {
    this.assertNotDisposed()
    if (generation !== this.generationValue) {
      throw new EngineCancelledError('superseded', 'Gomoku search is stale')
    }
    if (signal?.aborted) {
      throw new EngineCancelledError('aborted', 'Gomoku search was aborted')
    }
  }
}

/**
 * The forbidden points the engine must avoid, computed once per move from the
 * authoritative rules layer.
 */
export function forbiddenIndexesFor(
  board: Board,
  size: BoardSize,
  color: Color,
  isForbiddenPoint: (point: Point) => boolean,
): number[] {
  if (color !== 'black') return []

  const indexes: number[] = []
  for (let index = 0; index < board.length; index += 1) {
    if (board[index] !== null) continue
    const point: Point = {
      x: index % size,
      y: Math.floor(index / size),
    }
    if (isForbiddenPoint(point)) indexes.push(index)
  }

  return indexes
}
