export const ENGINE_STRENGTHS = [
  'low',
  'medium',
  'high',
  'full',
] as const

export type EngineStrength = (typeof ENGINE_STRENGTHS)[number]

export interface EngineStrengthProfile {
  readonly label: string
  readonly detail: string
  readonly depth: number
  readonly rootWidth: number
  readonly innerWidth: number
  readonly timeBudgetMs: number
  readonly randomness: number
  readonly useVcf: boolean
}

export const ENGINE_STRENGTH_PROFILES: Record<
  EngineStrength,
  EngineStrengthProfile
> = {
  low: {
    label: '入门',
    detail: '会看眼前一步',
    depth: 1,
    rootWidth: 10,
    innerWidth: 8,
    timeBudgetMs: 400,
    randomness: 0.32,
    useVcf: false,
  },
  medium: {
    label: '初级',
    detail: '能防活三',
    depth: 2,
    rootWidth: 12,
    innerWidth: 10,
    timeBudgetMs: 1_200,
    randomness: 0.12,
    useVcf: false,
  },
  high: {
    label: '中级',
    detail: '算冲四与活三',
    depth: 4,
    rootWidth: 12,
    innerWidth: 10,
    timeBudgetMs: 3_000,
    randomness: 0,
    useVcf: true,
  },
  full: {
    label: '高级',
    detail: '连续冲四搜杀',
    depth: 6,
    rootWidth: 14,
    innerWidth: 10,
    timeBudgetMs: 6_000,
    randomness: 0,
    useVcf: true,
  },
}

export function isEngineStrength(value: unknown): value is EngineStrength {
  return typeof value === 'string'
    && ENGINE_STRENGTHS.includes(value as EngineStrength)
}

/** Reduced limits used when the Web Worker is unavailable and the search has
 * to run on the main thread. */
export function fallbackProfile(strength: EngineStrength): EngineStrengthProfile {
  const profile = ENGINE_STRENGTH_PROFILES[strength]
  return {
    ...profile,
    depth: Math.min(profile.depth, 2),
    rootWidth: Math.min(profile.rootWidth, 8),
    innerWidth: Math.min(profile.innerWidth, 8),
    timeBudgetMs: Math.min(profile.timeBudgetMs, 400),
  }
}
