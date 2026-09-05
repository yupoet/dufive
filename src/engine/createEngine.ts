import { GomokuEngine } from './GomokuEngine'
import type { EngineKind, EnginePort } from './port'

/**
 * Builds the requested engine. The Rapfi WebAssembly build is loaded lazily so
 * its 1.3 MB module and GPL glue stay out of the application bundle until the
 * player actually picks that engine.
 */
export async function createEngine(kind: EngineKind): Promise<EnginePort> {
  if (kind === 'rapfi' || kind === 'rapfi-nnue') {
    const { RapfiEngine } = await import('./rapfi/RapfiEngine')
    return new RapfiEngine({ variant: kind === 'rapfi-nnue' ? 'nnue' : 'classical' })
  }

  return new GomokuEngine()
}
