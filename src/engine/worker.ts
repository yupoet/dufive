/// <reference lib="webworker" />
import { chooseMove } from './ai'
import { ENGINE_VERSION, type WorkerRequest, type WorkerResponse } from './protocol'

const cancelled = new Set<number>()

function post(message: WorkerResponse): void {
  self.postMessage(message)
}

function fail(id: number, error: unknown): void {
  post({
    type: 'response',
    id,
    ok: false,
    error: error instanceof Error ? error.message : String(error),
  })
}

self.onmessage = (event: MessageEvent) => {
  const request = event.data as WorkerRequest

  if (request.type === 'cancel') {
    cancelled.add(request.id)
    return
  }

  if (request.type !== 'move') return

  const { id, payload } = request
  const forbidden = payload.forbidden ? new Set(payload.forbidden) : undefined

  try {
    const decision = chooseMove({
      cells: Uint8Array.from(payload.cells),
      size: payload.size,
      color: payload.color,
      strength: payload.strength,
      exactFiveForBlack: payload.exactFiveForBlack,
      forbidden: forbidden ? (index) => forbidden.has(index) : undefined,
      shouldStop: () => cancelled.has(id),
    })

    post({
      type: 'response',
      id,
      ok: true,
      index: decision.index,
      score: decision.score,
      nodes: decision.nodes,
      depth: decision.depth,
      moveSource: decision.source,
    })
  } catch (error) {
    fail(id, error)
  } finally {
    cancelled.delete(id)
  }
}

self.onerror = (message) => {
  post({ type: 'log', text: String(message) })
}

post({ type: 'ready', version: ENGINE_VERSION })
