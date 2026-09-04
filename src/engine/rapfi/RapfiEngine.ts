import { EngineCancelledError, EngineRuntimeError } from '../GomokuEngine'
import type {
  EngineDecision,
  EnginePort,
  GenerateMoveInput,
} from '../port'
import type { EngineWorkerPort } from '../protocol'
import { ENGINE_STRENGTH_PROFILES } from '../strength'
import {
  RAPFI_SEARCH_SLACK_MS,
  buildMoveCommands,
  coordToIndex,
  parseMoveLine,
  type RapfiWorkerRequest,
  type RapfiWorkerResponse,
} from './protocol'

export interface RapfiEngineOptions {
  readonly workerFactory?: () => EngineWorkerPort
  readonly bootTimeoutMs?: number
  readonly searchTimeoutMs?: number
  readonly onLog?: (message: string) => void
}

interface WorkerState {
  readonly worker: EngineWorkerPort
  readonly ready: Promise<string>
  readonly resolveReady: (version: string) => void
  readonly rejectReady: (error: Error) => void
  readySettled: boolean
  readonly bootTimer: ReturnType<typeof setTimeout>
}

interface PendingRequest {
  readonly resolve: (response: RapfiWorkerResponse & { type: 'response' }) => void
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

const DEFAULT_BOOT_TIMEOUT_MS = 30_000
const DEFAULT_SEARCH_TIMEOUT_MS = 30_000

function defaultWorkerFactory(): EngineWorkerPort {
  const baseUrl = typeof document === 'undefined'
    ? globalThis.location.href
    : document.baseURI
  const workerUrl = new URL('engine/rapfi/worker-rapfi.js', baseUrl)
  return new Worker(workerUrl, { name: 'dufive-rapfi' }) as unknown as EngineWorkerPort
}

function errorMessage(error: unknown): string {
  return error instanceof Error ? error.message : String(error)
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null
}

function isWorkerResponse(value: unknown): value is RapfiWorkerResponse {
  return isRecord(value) && typeof value.type === 'string'
}

/**
 * Drives the Rapfi WebAssembly engine through its Piskvork worker bridge.
 *
 * All operations are serialised and tagged with the game generation. Because
 * the WebAssembly search is synchronous, a stale or aborted in-flight search
 * can only be stopped by terminating the worker, which is then recreated
 * lazily for the next request (the same policy as `GnuGoEngine`).
 */
export class RapfiEngine implements EnginePort {
  private readonly workerFactory: () => EngineWorkerPort
  private readonly bootTimeoutMs: number
  private readonly searchTimeoutMs: number
  private readonly onLog?: (message: string) => void

  private workerState: WorkerState | null = null
  private pending = new Map<number, PendingRequest>()
  private queue: QueueJob[] = []
  private activeJob: QueueJob | null = null
  private nextRequestId = 0
  private generationValue = 0
  private disposed = false

  constructor(options: RapfiEngineOptions = {}) {
    this.workerFactory = options.workerFactory ?? defaultWorkerFactory
    this.bootTimeoutMs = options.bootTimeoutMs ?? DEFAULT_BOOT_TIMEOUT_MS
    this.searchTimeoutMs = options.searchTimeoutMs ?? DEFAULT_SEARCH_TIMEOUT_MS
    this.onLog = options.onLog
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

    return this.enqueue(generation, input.signal, async (): Promise<EngineDecision> => {
      if (input.color === 'white' && input.board.every((stone) => stone === null)) {
        throw new EngineRuntimeError(
          'no-move',
          'Rapfi 引擎不能在空棋盘上执白先行',
        )
      }

      await this.ensureReady()
      this.assertRunnable(generation, input.signal)

      const profile = ENGINE_STRENGTH_PROFILES[input.strength]
      const commands = buildMoveCommands(input, profile)
      const response = await this.requestMove(commands, profile.timeBudgetMs)

      const move = parseMoveLine(response.move ?? '')
      if (!move) {
        const error = new EngineRuntimeError(
          'protocol',
          `Rapfi 未返回可解析的落点：${response.error ?? '无输出'}`,
        )
        this.destroyWorker(error)
        throw error
      }

      const index = coordToIndex(move.x, move.y, input.size)
      const invalid = move.x < 0
        || move.y < 0
        || move.x >= input.size
        || move.y >= input.size
        || index >= input.board.length
        || input.board[index] !== null
        || input.forbidden?.includes(index) === true
      if (invalid) {
        const error = new EngineRuntimeError(
          'protocol',
          `Rapfi 返回了非法落点：${move.x},${move.y}`,
        )
        this.destroyWorker(error)
        throw error
      }

      return {
        index,
        score: 0,
        nodes: 0,
        depth: 0,
        source: 'worker',
        moveSource: 'search',
      }
    }) as Promise<EngineDecision>
  }

  /**
   * Invalidates every queued or running operation from an older game
   * revision. A synchronous WebAssembly search cannot be interrupted, so a
   * busy worker is terminated and recreated on demand.
   */
  invalidate(nextGeneration = this.generationValue + 1): number {
    if (!Number.isSafeInteger(nextGeneration)) {
      throw new TypeError('Engine generation must be a safe integer')
    }

    this.generationValue = nextGeneration
    const error = new EngineCancelledError(
      'superseded',
      'Rapfi 搜索已被新的对局版本取代',
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

    const error = new EngineRuntimeError('disposed', 'Rapfi 引擎已被释放')
    for (const job of this.queue.splice(0)) this.rejectJob(job, error)
    if (this.activeJob) this.rejectJob(this.activeJob, error)
    this.destroyWorker(error)
  }

  private ensureReady(): Promise<string> {
    if (this.workerState) return this.workerState.ready

    let worker: EngineWorkerPort
    try {
      worker = this.workerFactory()
    } catch (error) {
      return Promise.reject(
        new EngineRuntimeError(
          'boot',
          `无法创建 Rapfi worker：${errorMessage(error)}`,
        ),
      )
    }

    let resolveReady: (version: string) => void = () => {}
    let rejectReady: (error: Error) => void = () => {}
    const ready = new Promise<string>((resolve, reject) => {
      resolveReady = resolve
      rejectReady = reject
    })
    ready.catch(() => {
      // Unhandled rejections are avoided; callers await generateMove instead.
    })

    const state: WorkerState = {
      worker,
      ready,
      resolveReady,
      rejectReady,
      readySettled: false,
      bootTimer: setTimeout(() => {
        const error = new EngineRuntimeError('boot', 'Rapfi 引擎启动超时')
        if (!state.readySettled) {
          state.readySettled = true
          rejectReady(error)
        }
        this.destroyWorker(error)
      }, this.bootTimeoutMs),
    }

    worker.onmessage = (event: { data: unknown }) => {
      const message = event.data
      if (!isWorkerResponse(message) || state !== this.workerState) return

      if (message.type === 'ready') {
        if (state.readySettled) return
        state.readySettled = true
        clearTimeout(state.bootTimer)
        state.resolveReady(message.version)
        return
      }

      if (message.type === 'boot-error') {
        const error = new EngineRuntimeError(
          'boot',
          `Rapfi 引擎启动失败：${message.error}`,
        )
        if (!state.readySettled) {
          state.readySettled = true
          clearTimeout(state.bootTimer)
          state.rejectReady(error)
        }
        this.destroyWorker(error)
        return
      }

      if (message.type === 'log') {
        this.onLog?.(message.text)
        return
      }

      if (message.type === 'response') {
        const pending = this.pending.get(message.id)
        if (!pending) return
        this.pending.delete(message.id)
        clearTimeout(pending.timer)
        if (message.ok) {
          pending.resolve(message)
        } else {
          pending.reject(
            new EngineRuntimeError(
              'no-move',
              message.error ?? 'Rapfi 请求失败',
            ),
          )
        }
      }
    }

    worker.onerror = (event: { message?: string }) => {
      const error = new EngineRuntimeError(
        'crash',
        `Rapfi worker 异常：${event.message ?? 'unknown'}`,
      )
      if (!state.readySettled) {
        state.readySettled = true
        clearTimeout(state.bootTimer)
        state.rejectReady(error)
      }
      this.destroyWorker(error)
    }

    worker.onmessageerror = () => {
      const error = new EngineRuntimeError(
        'protocol',
        'Rapfi worker 返回了无法解析的消息',
      )
      this.rejectAllPending(error)
    }

    this.workerState = state

    const initMessage: RapfiWorkerRequest = { type: 'init' }
    worker.postMessage(initMessage)
    return state.ready
  }

  private requestMove(
    commands: readonly string[],
    timeBudgetMs: number,
  ): Promise<RapfiWorkerResponse & { type: 'response' }> {
    const state = this.workerState
    if (!state) {
      return Promise.reject(
        new EngineRuntimeError('boot', 'Rapfi 引擎尚未启动'),
      )
    }

    this.nextRequestId += 1
    const id = this.nextRequestId
    const message: RapfiWorkerRequest = { type: 'move', id, commands }

    return new Promise((resolve, reject) => {
      const timeoutMs = Math.max(
        this.searchTimeoutMs,
        timeBudgetMs + RAPFI_SEARCH_SLACK_MS,
      )
      const timer = setTimeout(() => {
        this.pending.delete(id)
        const error = new EngineRuntimeError('timeout', 'Rapfi 思考超时')
        reject(error)
        this.destroyWorker(error)
      }, timeoutMs)

      this.pending.set(id, { resolve, reject, timer })
      state.worker.postMessage(message)
    })
  }

  private rejectAllPending(error: Error): void {
    for (const [id, pending] of this.pending.entries()) {
      this.pending.delete(id)
      clearTimeout(pending.timer)
      pending.reject(error)
    }
  }

  private destroyWorker(error: Error): void {
    const state = this.workerState
    if (!state) return

    clearTimeout(state.bootTimer)
    // Booting Rapfi compiles WebAssembly, which can take seconds. If the
    // worker is destroyed mid-boot, `ready` must settle or every queued job
    // awaits forever and the queue deadlocks.
    if (!state.readySettled) {
      state.readySettled = true
      state.rejectReady(error)
    }
    this.rejectAllPending(error)
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
          const error = new EngineCancelledError('aborted', 'Rapfi 搜索已中止')
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
      throw new EngineRuntimeError('disposed', 'Rapfi 引擎已被释放')
    }
  }

  private assertRunnable(generation: number, signal?: AbortSignal): void {
    this.assertNotDisposed()
    if (generation !== this.generationValue) {
      throw new EngineCancelledError('superseded', 'Rapfi 搜索已过期')
    }
    if (signal?.aborted) {
      throw new EngineCancelledError('aborted', 'Rapfi 搜索已中止')
    }
  }
}
