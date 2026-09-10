import type { Candle } from './types'

export type StochLengths = [number, number]
export const STOCH_DEFAULTS: Record<string, StochLengths> = {
  '1m': [10, 20], '5m': [30, 180], '15m': [30, 120], '30m': [30, 120],
  '1h': [30, 120], '2h': [30, 120], '3h': [45, 180], '4h': [30, 210],
  '1d': [10, 70], '1w': [10, 40], '1M': [10, 30],
}
export const STOCH_STORAGE_KEY = 'btcusd.stoch.parameters.v1'

export function validStochLength(value: number): boolean {
  return Number.isSafeInteger(value) && value >= 1
}

export function readStochSettings(raw: string | null): Record<string, StochLengths> {
  const result: Record<string, StochLengths> = {}
  try {
    const parsed: unknown = JSON.parse(raw ?? '{}')
    if (!parsed || typeof parsed !== 'object') return result
    for (const [period, pair] of Object.entries(parsed)) {
      if (Object.hasOwn(STOCH_DEFAULTS, period) && Array.isArray(pair) && pair.length === 2 &&
        pair.every((value) => typeof value === 'number' && validStochLength(value))) {
        result[period] = [pair[0], pair[1]]
      }
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

export function calculateStoch(candles: Candle[], lengths: StochLengths) {
  if (!lengths.every(validStochLength)) throw new RangeError('Stoch lengths must be positive integers')
  const closes = candles.map((candle) => candle.close)
  const first = pair(closes, lengths[0])
  const second = pair(closes, lengths[1])
  return candles.map((candle, index) => ({
    timestamp: candle.timestamp,
    k1: first.k[index], d1: first.d[index], k2: second.k[index], d2: second.d[index],
  }))
}
