import { describe, expect, it, vi } from 'vitest'
import { RapfiEngine, type RapfiEngineOptions } from '../RapfiEngine'
import {
  EngineCancelledError,
  EngineRuntimeError,
} from '../../GomokuEngine'
import type { EngineWorkerPort } from '../../protocol'
import type { GenerateMoveInput } from '../../port'
import type { Board } from '../../../game/types'

const VERSION = 'Rapfi 0.43.01 (test)'

class FakeWorker implements EngineWorkerPort {
  posted: unknown[] = []
  onmessage: ((event: { data: unknown }) => void) | null = null
  onerror: ((event: { message?: string }) => void) | null = null
  onmessageerror: ((event: unknown) => void) | null = null
  terminated = false

  postMessage(message: unknown): void {
    this.posted.push(message)
  }

  terminate(): void {
    this.terminated = true
  }

  receive(message: unknown): void {
    this.onmessage?.({ data: message })
  }

  postedMoves(): Array<{ id: number; commands: readonly string[] }> {
    return this.posted.filter(
      (message): message is { type: 'move'; id: number; commands: readonly string[] } =>
        typeof message === 'object'
        && message !== null
        && (message as { type?: string }).type === 'move',
    )
  }
}

const SIZE = 15

function board(): Board {
  const cells: ('black' | 'white' | null)[] = Array.from({ length: SIZE * SIZE }, () => null)
  cells[7 * SIZE + 7] = 'black'
  cells[8 * SIZE + 8] = 'white'
  return cells
}

function input(overrides: Partial<GenerateMoveInput> = {}): GenerateMoveInput {
  return {
    board: board(),
    size: SIZE,
    color: 'black',
    strength: 'high',
    ...overrides,
  }
}

function makeEngine(workers: FakeWorker[], options: Partial<RapfiEngineOptions> = {}) {
  let index = 0
  const factory = () => {
    const worker = workers[index]
    index += 1
    if (!worker) throw new Error(`unexpected worker #${index}`)
    return worker
  }
  return new RapfiEngine({ workerFactory: factory, ...options })
}

async function boot(engine: RapfiEngine, worker: FakeWorker): Promise<string> {
  const initPromise = engine.init()
  worker.receive({ type: 'ready', version: VERSION })
  return initPromise
}

/** Lets the queued job's operation run up to its worker postMessage. */
async function flush(): Promise<void> {
  await Promise.resolve()
  await Promise.resolve()
}

function isCancellation(
  reason: 'aborted' | 'superseded',
): (error: unknown) => boolean {
  return (error: unknown) =>
    error instanceof EngineCancelledError && error.reason === reason
}

describe('RapfiEngine boot', () => {
  it('resolves init() once the worker answers ABOUT', async () => {
    const worker = new FakeWorker()
    const engine = makeEngine([worker])

    const initPromise = engine.init()
    expect(worker.posted).toEqual([{ type: 'init', variant: 'classical' }])

    worker.receive({ type: 'ready', version: VERSION })
    await expect(initPromise).resolves.toBe(VERSION)
  })

  it('asks the worker for the NNUE build when configured as the strongest engine', async () => {
    const worker = new FakeWorker()
    const engine = makeEngine([worker], { variant: 'nnue' })

    const initPromise = engine.init()
    expect(worker.posted).toEqual([{ type: 'init', variant: 'nnue' }])

    worker.receive({ type: 'ready', version: VERSION })
    await expect(initPromise).resolves.toBe(VERSION)
  })

  it('rejects init() when the worker fails to boot', async () => {
    const worker = new FakeWorker()
    const engine = makeEngine([worker])

    const initPromise = engine.init()
    worker.receive({ type: 'boot-error', error: 'fetch failed' })

    await expect(initPromise).rejects.toBeInstanceOf(EngineRuntimeError)
    expect(worker.terminated).toBe(true)
  })

  it('rejects init() on boot timeout and terminates the worker', async () => {
    vi.useFakeTimers()
    try {
      const worker = new FakeWorker()
      const engine = makeEngine([worker], { bootTimeoutMs: 50 })

      const initPromise = engine.init()
      const assertion = expect(initPromise).rejects.toThrow('Rapfi 引擎启动超时')
      await vi.advanceTimersByTimeAsync(50)
      await assertion
      expect(worker.terminated).toBe(true)
    } finally {
      vi.useRealTimers()
    }
  })
})

describe('RapfiEngine generateMove', () => {
  it('round-trips a valid move reply', async () => {
    const worker = new FakeWorker()
    const engine = makeEngine([worker])
    await boot(engine, worker)

    const decisionPromise = engine.generateMove(input())
    await flush()
    const requests = worker.postedMoves()
    expect(requests).toHaveLength(1)
    expect(requests[0]?.commands[0]).toBe('START 15')

    worker.receive({ type: 'response', id: requests[0]!.id, ok: true, move: '6,7' })

    const decision = await decisionPromise
    expect(decision.index).toBe(7 * SIZE + 6)
    expect(decision.source).toBe('worker')
    expect(decision.moveSource).toBe('search')
  })

  it('rejects a reply on an occupied point and recycles the worker', async () => {
    const first = new FakeWorker()
    const second = new FakeWorker()
    const engine = makeEngine([first, second])
    await boot(engine, first)

    const decisionPromise = engine.generateMove(input())
    await flush()
    const request = first.postedMoves()[0]!
    first.receive({ type: 'response', id: request.id, ok: true, move: '7,7' })

    await expect(decisionPromise).rejects.toThrow('非法落点')
    expect(first.terminated).toBe(true)

    // The next request boots a fresh worker.
    const next = engine.generateMove(input())
    second.receive({ type: 'ready', version: VERSION })
    await flush()
    const retry = second.postedMoves()[0]
    expect(retry).toBeDefined()
    second.receive({ type: 'response', id: retry!.id, ok: true, move: '6,7' })
    await expect(next).resolves.toMatchObject({ index: 7 * SIZE + 6 })
  })

  it('rejects an out-of-bounds reply', async () => {
    const worker = new FakeWorker()
    const engine = makeEngine([worker])
    await boot(engine, worker)

    const decisionPromise = engine.generateMove(input())
    await flush()
    const request = worker.postedMoves()[0]!
    worker.receive({ type: 'response', id: request.id, ok: true, move: '15,15' })

    await expect(decisionPromise).rejects.toThrow('非法落点')
    expect(worker.terminated).toBe(true)
  })

  it('rejects a reply on a renju forbidden point', async () => {
    const worker = new FakeWorker()
    const engine = makeEngine([worker])
    await boot(engine, worker)

    const decisionPromise = engine.generateMove(input({ forbidden: [6 * SIZE + 6] }))
    await flush()
    const request = worker.postedMoves()[0]!
    worker.receive({ type: 'response', id: request.id, ok: true, move: '6,6' })

    await expect(decisionPromise).rejects.toThrow('非法落点')
    expect(worker.terminated).toBe(true)
  })

  it('rejects a reply without a move and reports the worker error', async () => {
    const worker = new FakeWorker()
    const engine = makeEngine([worker])
    await boot(engine, worker)

    const decisionPromise = engine.generateMove(input())
    await flush()
    const request = worker.postedMoves()[0]!
    worker.receive({ type: 'response', id: request.id, ok: false, error: 'Rapfi 未返回落点' })

    await expect(decisionPromise).rejects.toThrow('Rapfi 未返回落点')
  })

  it('rejects a white opening move request without contacting the worker', async () => {
    const worker = new FakeWorker()
    const engine = makeEngine([worker])
    await boot(engine, worker)

    await expect(
      engine.generateMove(
        input({ color: 'white', board: Array.from({ length: SIZE * SIZE }, () => null) }),
      ),
    ).rejects.toThrow('执白先行')
    expect(worker.postedMoves()).toHaveLength(0)
  })
})

describe('RapfiEngine stale generation handling', () => {
  it('rejects an in-flight stale search and terminates the worker', async () => {
    const first = new FakeWorker()
    const second = new FakeWorker()
    const engine = makeEngine([first, second])
    await boot(engine, first)

    const decisionPromise = engine.generateMove(input({ generation: 0 }))
    await flush()
    const request = first.postedMoves()[0]
    expect(request).toBeDefined()

    engine.invalidate(1)

    await expect(decisionPromise).rejects.toSatisfy(isCancellation('superseded'))
    expect(first.terminated).toBe(true)

    // A late reply from the terminated worker must not resolve anything:
    // destroyWorker cleared its handlers, so this is a no-op.
    first.receive({ type: 'response', id: request!.id, ok: true, move: '6,7' })

    // The next request uses a fresh worker at the new generation.
    const next = engine.generateMove(input({ generation: 1 }))
    second.receive({ type: 'ready', version: VERSION })
    await flush()
    const retry = second.postedMoves()[0]
    expect(retry).toBeDefined()
    second.receive({ type: 'response', id: retry!.id, ok: true, move: '6,7' })
    await expect(next).resolves.toMatchObject({ index: 7 * SIZE + 6 })
  })

  it('rejects jobs enqueued with an older generation', async () => {
    const worker = new FakeWorker()
    const engine = makeEngine([worker])
    await boot(engine, worker)

    const stale = engine.generateMove(input({ generation: 0 }))
    engine.invalidate(1)
    await expect(stale).rejects.toSatisfy(isCancellation('superseded'))

    // A job tagged with the old generation never reaches the worker.
    await expect(engine.generateMove(input({ generation: 0 })))
      .rejects.toSatisfy(isCancellation('superseded'))
    expect(worker.postedMoves()).toHaveLength(0)
  })
})

describe('RapfiEngine queue serialisation', () => {
  it('runs one request at a time', async () => {
    const worker = new FakeWorker()
    const engine = makeEngine([worker])
    await boot(engine, worker)

    const first = engine.generateMove(input())
    const second = engine.generateMove(input())
    await flush()

    expect(worker.postedMoves()).toHaveLength(1)

    const firstRequest = worker.postedMoves()[0]!
    worker.receive({ type: 'response', id: firstRequest.id, ok: true, move: '6,7' })
    await first
    await flush()

    const secondRequest = worker.postedMoves()[1]
    expect(secondRequest).toBeDefined()
    worker.receive({ type: 'response', id: secondRequest!.id, ok: true, move: '6,7' })
    await expect(second).resolves.toMatchObject({ index: 7 * SIZE + 6 })
  })
})

describe('RapfiEngine abort and disposal', () => {
  it('rejects and terminates the worker when an active search aborts', async () => {
    const worker = new FakeWorker()
    const engine = makeEngine([worker])
    await boot(engine, worker)

    const controller = new AbortController()
    const decisionPromise = engine.generateMove(input({ signal: controller.signal }))
    await flush()
    expect(worker.postedMoves()).toHaveLength(1)

    controller.abort()

    await expect(decisionPromise).rejects.toSatisfy(isCancellation('aborted'))
    expect(worker.terminated).toBe(true)
  })

  it('rejects a queued job that aborts before it starts', async () => {
    const worker = new FakeWorker()
    const engine = makeEngine([worker])
    await boot(engine, worker)

    const controller = new AbortController()
    const active = engine.generateMove(input())
    const queued = engine.generateMove(input({ signal: controller.signal }))
    await flush()
    controller.abort()

    const activeRequest = worker.postedMoves()[0]!
    worker.receive({ type: 'response', id: activeRequest.id, ok: true, move: '6,7' })
    await active

    await expect(queued).rejects.toSatisfy(isCancellation('aborted'))
    expect(worker.postedMoves()).toHaveLength(1)
  })

  it('fails every job on dispose', async () => {
    const worker = new FakeWorker()
    const engine = makeEngine([worker])
    await boot(engine, worker)

    const decisionPromise = engine.generateMove(input())
    await flush()
    engine.dispose()

    await expect(decisionPromise).rejects.toThrow('释放')
    expect(worker.terminated).toBe(true)
  })
})
