import type { Candle } from './types'

export type StochGroupCount = 2 | 3 | 4 | 5 | 6
export type StochLengths = [number, number, number, number, number, number]
export type StochLineKey = 'k1' | 'd1' | 'k2' | 'd2' | 'k3' | 'd3' | 'k4' | 'd4' | 'k5' | 'd5' | 'k6' | 'd6'

export interface StochSetting {
  groups: StochGroupCount
  lengths: StochLengths
}

export interface StochPoint {
  timestamp: number
  k1: number | null
  d1: number | null
  k2: number | null
  d2: number | null
  k3: number | null
  d3: number | null
  k4: number | null
  d4: number | null
  k5: number | null
  d5: number | null
  k6: number | null
  d6: number | null
}

export const STOCH_DEFAULTS: Record<string, StochLengths> = {
  '1m': [30, 80, 150, 300, 600, 1200],
  '5m': [30, 180, 720, 1440, 2880, 5760],
  '15m': [10, 40, 160, 320, 640, 1280],
  '30m': [10, 60, 480, 960, 1920, 3840],
  '90m': [40, 160, 320, 640, 1280, 2560],
  '1h': [10, 40, 240, 480, 960, 1920],
  '2h': [30, 120, 840, 1680, 3360, 6720],
  '3h': [20, 80, 560, 1120, 2240, 4480],
  '4h': [10, 60, 420, 840, 1680, 3360],
  '1d': [10, 70, 280, 560, 1120, 2240],
  '1w': [10, 40, 120, 240, 480, 960],
  '1M': [10, 30, 120, 240, 480, 960],
}
export const STOCH_STORAGE_KEY = 'btcusd.stoch.parameters.v1'
export const STOCH_VISIBILITY_KEY = 'btcusd.stoch.visible'

// New projects start with the indicator hidden; every project keeps its own choice.
export function stochVisibilityKey(projectId?: string): string {
  return projectId ? `${STOCH_VISIBILITY_KEY}.${projectId}` : STOCH_VISIBILITY_KEY
}

export function validStochLength(value: number): boolean {
  return Number.isSafeInteger(value) && value >= 1
}

export function validStochLengths(lengths: readonly number[]): boolean {
  return lengths.length >= 2 && lengths.length <= 6 && lengths.every(validStochLength)
}

export function defaultStochSetting(period: string): StochSetting {
  const lengths = STOCH_DEFAULTS[period] ?? STOCH_DEFAULTS['1h']
  return { groups: 4, lengths: [...lengths] as StochLengths }
}

function numberEntries(value: unknown[]): value is number[] {
  return value.length >= 2 && value.length <= 6 &&
    value.every((entry) => typeof entry === 'number' && validStochLength(entry))
}

function storedSetting(period: string, value: unknown): StochSetting | null {
  if (!Object.hasOwn(STOCH_DEFAULTS, period)) return null
  const fallback = STOCH_DEFAULTS[period]
  // Legacy v1 entries are bare [K1, K2] or [K1, K2, K3] arrays.
  if (Array.isArray(value)) {
    if (!numberEntries(value)) return null
    return {
      groups: value.length as StochGroupCount,
      lengths: fallback.map((length, index) => value[index] ?? length) as StochLengths,
    }
  }
  if (!value || typeof value !== 'object') return null
  const candidate = value as { groups?: unknown; lengths?: unknown }
  if (typeof candidate.groups !== 'number' || !Number.isInteger(candidate.groups) ||
      candidate.groups < 2 || candidate.groups > 6) return null
  if (!Array.isArray(candidate.lengths) || !numberEntries(candidate.lengths)) return null
  return {
    groups: candidate.groups as StochGroupCount,
    lengths: fallback.map((length, index) => candidate.lengths instanceof Array
      ? candidate.lengths[index] ?? length : length) as StochLengths,
  }
}

export function readStochSettings(raw: string | null): Record<string, StochSetting> {
  const result: Record<string, StochSetting> = {}
  try {
    const parsed: unknown = JSON.parse(raw ?? '{}')
    if (!parsed || typeof parsed !== 'object' || Array.isArray(parsed)) return result
    for (const [period, value] of Object.entries(parsed)) {
      const setting = storedSetting(period, value)
      if (setting) result[period] = setting
    }
  } catch { /* Ignore unavailable or corrupt saved settings. */ }
  return result
}

function sma(values: Array<number | null>, length: number): Array<number | null> {
  let sum = 0
  let count = 0
  return values.map((value, index) => {
    if (value !== null) { sum += value; count += 1 }
    const expired = values[index - length]
    if (index >= length && expired != null) { sum -= expired; count -= 1 }
    return count === length ? sum / length : null
  })
}

function pair(closes: number[], length: number) {
  const smooth = Math.max(1, Math.round(length / 10 * 3))
  const lows: number[] = []
  const highs: number[] = []
  let lowHead = 0
  let highHead = 0
  // Pine lowest/highest use available history; SMA waits for its full window.
  const raw = closes.map((close, index) => {
    while (lowHead < lows.length && lows[lowHead] <= index - length) lowHead++
    while (highHead < highs.length && highs[highHead] <= index - length) highHead++
    while (lows.length > lowHead && closes[lows[lows.length - 1]] >= close) lows.pop()
    while (highs.length > highHead && closes[highs[highs.length - 1]] <= close) highs.pop()
    lows.push(index)
    highs.push(index)
    const low = closes[lows[lowHead]]
    const high = closes[highs[highHead]]
    return high === low ? 0 : (close - low) / (high - low) * 100
  })
  const k = sma(raw, smooth)
  return { k, d: sma(k, smooth) }
}

export function calculateStoch(candles: Candle[], lengths: readonly number[]): StochPoint[] {
  if (!validStochLengths(lengths)) {
    throw new RangeError('Stoch lengths must contain two to six positive integers')
  }
  const closes = candles.map((candle) => candle.close)
  const pairs = lengths.map((length) => pair(closes, length))
  return candles.map((candle, index) => ({
    timestamp: candle.timestamp,
    k1: pairs[0].k[index], d1: pairs[0].d[index],
    k2: pairs[1].k[index], d2: pairs[1].d[index],
    k3: pairs[2]?.k[index] ?? null, d3: pairs[2]?.d[index] ?? null,
    k4: pairs[3]?.k[index] ?? null, d4: pairs[3]?.d[index] ?? null,
    k5: pairs[4]?.k[index] ?? null, d5: pairs[4]?.d[index] ?? null,
    k6: pairs[5]?.k[index] ?? null, d6: pairs[5]?.d[index] ?? null,
  }))
}
