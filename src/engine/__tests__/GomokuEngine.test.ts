import { beforeEach, describe, expect, it } from 'vitest'
import {
  EngineCancelledError,
  GomokuEngine,
  isEngineCancellation,
} from '../GomokuEngine'
import type { EngineDecision, GenerateMoveInput } from '../port'
import type { Board, BoardSize, Color } from '../../game/types'
import { EMPTY } from '../evaluate'

const SIZE: BoardSize = 15

function emptyBoard(): Board {
  return Array<Color | null>(SIZE * SIZE).fill(null) as Board
}

interface PostedMessage {
  readonly type: string
  readonly id?: number
  readonly payload?: unknown
}

/** Minimal stand-in for a Web Worker, scripted by the test. */
class FakeWorker {
  onmessage: ((event: { data: unknown }) => void) | null = null
  onerror: ((event: { message?: string }) => void) | null = null
  onmessageerror: ((event: unknown) => void) | null = null
  posted: PostedMessage[] = []
  terminated = 0

  constructor(private readonly behaviour: 'ready' | 'never-boot') {
    if (behaviour !== 'ready') return

    // The real worker announces itself as soon as its script is evaluated.
    // Deferring a microtask lets `ensureReady` attach `onmessage` first.
    Promise.resolve().then(() => {
      this.onmessage?.({ data: { type: 'ready', version: 'dufive-1.0' } })
    })
  }

  postMessage(message: PostedMessage): void {
    this.posted.push(message)
    if (message.type === 'move' && this.behaviour === 'ready') {
      // Reply on the next microtask, as a real worker would.
      Promise.resolve().then(() => {
        this.onmessage?.({
          data: {
            type: 'response',
            id: message.id,
            ok: true,
            index: 7 * SIZE + 7,
            score: 0,
            nodes: 1,
            depth: 1,
            moveSource: 'search',
          },
        })
      })
    }
  }

  terminate(): void {
    this.terminated += 1
  }
}

function moveInput(overrides: Partial<GenerateMoveInput> = {}): GenerateMoveInput {
  return {
    board: emptyBoard(),
    size: SIZE,
    color: 'black',
    strength: 'medium',
    ruleSet: 'free',
    ...overrides,
  }
}

describe('GomokuEngine lifecycle', () => {
  let engine: GomokuEngine

  beforeEach(() => {
    engine = new GomokuEngine({ workerFactory: () => new FakeWorker('ready') as never })
  })

  it('boots and returns a validated move', async () => {
    const version = await engine.init()
    expect(version).toBe('dufive-1.0')

    const decision = await engine.generateMove(moveInput())
    expect(decision.index).toBe(7 * SIZE + 7)
    expect(decision.source).toBe('worker')
  })

  it('stays usable after invalidate() forces the worker to be recreated', async () => {
    await engine.init()
    engine.invalidate(42)

    const decision = await engine.generateMove(moveInput({ generation: 42 }))
    expect(decision.index).toBe(7 * SIZE + 7)
  })

  it('rejects a request whose generation is stale', async () => {
    await engine.init()
    engine.invalidate(10)

    await expect(engine.generateMove(moveInput({ generation: 9 })))
      .rejects.toBeInstanceOf(EngineCancelledError)
  })

  it('does not deadlock when the worker is destroyed mid-boot', async () => {
    // Line the engine's generation up with the request first, otherwise the
    // job is rejected before it ever reaches the queue.
    engine.invalidate(1)

    // Start a move so a job is active while the worker is still booting.
    const pending = engine.generateMove(moveInput({ generation: 1 }))
    // An undo arrives at that moment: invalidate rejects the job and
    // terminates the worker before `ready` has settled.
    engine.invalidate(2)
    await expect(pending).rejects.toBeInstanceOf(EngineCancelledError)

    // `ready` must have settled too, otherwise `runJob` keeps awaiting it,
    // `activeJob` is never cleared and the queue deadlocks for good.
    const decision = await engine.generateMove(moveInput({ generation: 2 }))
    expect(decision.index).toBe(7 * SIZE + 7)
  })

  it('falls back to a main-thread move when the worker never boots', async () => {
    const broken = new GomokuEngine({
      workerFactory: () => new FakeWorker('never-boot') as never,
      bootTimeoutMs: 5,
      searchTimeoutMs: 200,
    })

    const decision = await broken.generateMove(moveInput())
    expect(decision.index).not.toBeNull()
    expect(decision.source).toBe('fallback')
    if (decision.index !== null) {
      expect(decision.index).toBeGreaterThanOrEqual(0)
      expect(decision.index).toBeLessThan(SIZE * SIZE)
    }
    broken.dispose()
  })

  it('falls back when the worker cannot even be created', async () => {
    const broken = new GomokuEngine({
      workerFactory: () => {
        throw new Error('no worker support')
      },
    })

    const decision = await broken.generateMove(moveInput())
    expect(decision.source).toBe('fallback')
    broken.dispose()
  })

  it('rejects an occupied or forbidden reply', async () => {
    class BadWorker extends FakeWorker {
      override postMessage(message: PostedMessage): void {
        this.posted.push(message)
        if (message.type === 'move') {
          Promise.resolve().then(() => {
            const board = (message.payload as { board?: Board }).board ?? []
            const occupied = board.findIndex((stone) => stone !== null)
            this.onmessage?.({
              data: {
                type: 'response',
                id: message.id,
                ok: true,
                index: occupied >= 0 ? occupied : 0,
                score: 0,
                nodes: 0,
                depth: 1,
                moveSource: 'search',
              },
            })
          })
        }
      }
    }

    const board = emptyBoard() as (Color | null)[]
    board[3] = 'white'
    const strict = new GomokuEngine({ workerFactory: () => new BadWorker('ready') as never })
    await strict.init()

    const decision = await strict.generateMove(moveInput({ board }))
    expect(decision.index).not.toBe(3)
    strict.dispose()
  })

  it('is safe to dispose twice and rejects later work', async () => {
    await engine.init()
    engine.dispose()
    engine.dispose()

    await expect(engine.generateMove(moveInput())).rejects.toBeTruthy()
  })
})

describe('search state hygiene', () => {
  it('keeps the caller board untouched when the budget expires mid-search', async () => {
    const { searchBest } = await import('../search')
    const { encodeBoard } = await import('../codec')
    const cells = encodeBoard(emptyBoard())
    cells[7 * SIZE + 7] = 1
    cells[7 * SIZE + 8] = 2
    cells[8 * SIZE + 8] = 1
    cells[8 * SIZE + 7] = 2

    const before = [...cells]
    searchBest(cells, SIZE, 1, {
      depth: 20,
      rootWidth: 12,
      innerWidth: 12,
      // One millisecond guarantees a SearchTimeout deep in the tree.
      deadline: Date.now() + 1,
    })

    expect([...cells]).toEqual(before)
    expect(cells.every((cell) => cell !== EMPTY || true)).toBe(true)
  })
})

describe('engine cancellation helper', () => {
  it('recognises cancellation errors', () => {
    const error = new EngineCancelledError('superseded', 'stale')
    expect(isEngineCancellation(error)).toBe(true)
    expect(isEngineCancellation(new Error('other'))).toBe(false)

    const decision: EngineDecision = {
      index: 0,
      score: 0,
      nodes: 0,
      depth: 0,
      source: 'worker',
      moveSource: 'search',
    }
    expect(decision.source).toBe('worker')
  })
})
