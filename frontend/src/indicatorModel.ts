// Light project-model helpers for indicator selections. This module must stay
// free of charting dependencies so `replay.ts` and the main App bundle do not
// pull the async CandleKit chunk.

export interface ReplayIndicator {
  name: string
  params: Record<string, number | boolean | string>
}

// Indicator selections are stored per timeframe so every replay pane restores
// the set that belongs to its own period.
export type ReplayIndicatorState = Record<string, ReplayIndicator[]>

export const INDICATOR_TIMEFRAMES = ['1m', '5m', '15m', '30m', '1h', '2h', '3h', '4h', '1d', '1w', '1M'] as const
export const MAX_INDICATORS_PER_TIMEFRAME = 8
export const MAX_OSCILLATOR_INDICATORS = 4
export const MAX_INDICATOR_NAME_LENGTH = 64
export const MAX_INDICATOR_PARAMS = 32
export const MAX_INDICATOR_PARAM_STRING = 128

function normalizedParamValues(raw: unknown): Record<string, number | boolean | string> {
  const params: Record<string, number | boolean | string> = {}
  if (!raw || typeof raw !== 'object' || Array.isArray(raw)) return params
  let count = 0
  for (const [key, value] of Object.entries(raw as Record<string, unknown>)) {
    if (count >= MAX_INDICATOR_PARAMS) break
    if (!/^[A-Za-z0-9_]{1,32}$/.test(key)) continue
    if (typeof value === 'boolean' || (typeof value === 'number' && Number.isFinite(value))) {
      params[key] = value
      count += 1
    } else if (typeof value === 'string' && value.length <= MAX_INDICATOR_PARAM_STRING) {
      params[key] = value
      count += 1
    }
  }
  return params
}

/**
 * Structurally sanitises persisted indicator maps. Indicator names are not
 * whitelisted here: the chart layer drops names it does not know, so a client
 * that adds an indicator never needs a server deployment.
 */
export function normalizeReplayIndicators(raw: unknown): ReplayIndicatorState {
  const result: ReplayIndicatorState = {}
  if (!raw || typeof raw !== 'object' || Array.isArray(raw)) return result
  for (const [timeframe, entries] of Object.entries(raw as Record<string, unknown>)) {
    if (!(INDICATOR_TIMEFRAMES as readonly string[]).includes(timeframe)) continue
    if (!Array.isArray(entries)) continue
    const selected = new Map<string, ReplayIndicator>()
    for (const entry of entries) {
      if (selected.size >= MAX_INDICATORS_PER_TIMEFRAME) break
      if (!entry || typeof entry !== 'object' || Array.isArray(entry)) continue
      const candidate = entry as { name?: unknown; params?: unknown }
      if (typeof candidate.name !== 'string') continue
      const name = candidate.name.trim()
      if (!name || name.length > MAX_INDICATOR_NAME_LENGTH || /[\u0000-\u001f]/.test(name)) continue
      if (selected.has(name)) continue
      selected.set(name, { name, params: normalizedParamValues(candidate.params) })
    }
    if (selected.size) result[timeframe] = [...selected.values()]
  }
  return result
}

export function emptyIndicatorState(): ReplayIndicatorState {
  return {}
}

export function activeIndicatorList(state: ReplayIndicatorState, timeframe: string): ReplayIndicator[] {
  return state[timeframe] ?? []
}
