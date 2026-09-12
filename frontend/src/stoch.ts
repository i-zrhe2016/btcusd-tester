import type { Candle } from './types'

export type StochGroupCount = 2 | 3
export type StochLengths = [number, number, number]
export type StochLineKey = 'k1' | 'd1' | 'k2' | 'd2' | 'k3' | 'd3'

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
}

export const STOCH_DEFAULTS: Record<string, StochLengths> = {
  '1m': [10, 20, 840], '5m': [30, 180, 840], '15m': [30, 120, 960], '30m': [30, 120, 480],
  '1h': [30, 120, 840], '2h': [30, 120, 840], '3h': [45, 180, 840], '4h': [30, 210, 840],
  '1d': [10, 70, 280], '1w': [10, 40, 120], '1M': [10, 30, 120],
}
export const STOCH_STORAGE_KEY = 'btcusd.stoch.parameters.v1'

export function validStochLength(value: number): boolean {
  return Number.isSafeInteger(value) && value >= 1
}

export function validStochLengths(lengths: readonly number[]): boolean {
  return lengths.length >= 2 && lengths.length <= 3 && lengths.every(validStochLength)
}

export function defaultStochSetting(period: string): StochSetting {
  const lengths = STOCH_DEFAULTS[period] ?? STOCH_DEFAULTS['1m']
  return { groups: 2, lengths: [...lengths] as StochLengths }
}

function numberEntries(value: unknown[]): value is number[] {
  return value.length >= 2 && value.length <= 3 &&
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
      lengths: [value[0], value[1], value[2] ?? fallback[2]] as StochLengths,
    }
  }
  if (!value || typeof value !== 'object') return null
  const candidate = value as { groups?: unknown; lengths?: unknown }
  if (candidate.groups !== 2 && candidate.groups !== 3) return null
  if (!Array.isArray(candidate.lengths) || !numberEntries(candidate.lengths)) return null
  return {
    groups: candidate.groups,
    lengths: [
      candidate.lengths[0],
      candidate.lengths[1],
      candidate.lengths[2] ?? fallback[2],
    ] as StochLengths,
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
  const smooth = Math.max(1, Math.round(length * 0.3))
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
    return high === low ? 50 : (close - low) / (high - low) * 100
  })
  const k = sma(raw, smooth)
  return { k, d: sma(k, smooth) }
}

export function calculateStoch(candles: Candle[], lengths: readonly number[]): StochPoint[] {
  if (!validStochLengths(lengths)) {
    throw new RangeError('Stoch lengths must contain two or three positive integers')
  }
  const closes = candles.map((candle) => candle.close)
  const pairs = lengths.map((length) => pair(closes, length))
  return candles.map((candle, index) => ({
    timestamp: candle.timestamp,
    k1: pairs[0].k[index], d1: pairs[0].d[index],
    k2: pairs[1].k[index], d2: pairs[1].d[index],
    k3: pairs[2]?.k[index] ?? null, d3: pairs[2]?.d[index] ?? null,
  }))
}
