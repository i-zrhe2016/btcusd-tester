import { describe, expect, it } from 'vitest'
import { calculateStoch, readStochSettings, STOCH_DEFAULTS } from './stoch'
import type { Candle } from './types'

const candles = (closes: number[]): Candle[] => closes.map((close, timestamp) => ({
  timestamp, close, open: close, high: close + 100, low: close - 100, volume: 1,
}))

describe('Pine close-based dual Stoch', () => {
  it('uses closes, partial extrema history, and two full SMA windows', () => {
    const result = calculateStoch(candles([10, 20, 30, 20, 10]), [5, 1])
    expect(result.map((p) => p.k1)).toEqual([null, 75, 100, 75, 25])
    expect(result.map((p) => p.d1)).toEqual([null, null, 87.5, 87.5, 50])
    expect(result.map((p) => p.k2)).toEqual([50, 50, 50, 50, 50])
  })
  it('returns 50 on flat prices after warmup and rounds .5 upward', () => {
    const result = calculateStoch(candles(Array(30).fill(42)), [15, 10])
    expect(result[3].k1).toBeNull()
    expect(result[4].k1).toBe(50)
    expect(result[7].d1).toBeNull()
    expect(result[8].d1).toBe(50)
    expect(result[4].d2).toBe(50)
  })
  it('expires extrema and never changes earlier values with future candles', () => {
    const input = candles([10, 30, 20, 25, 22, 21, 1000])
    const result = calculateStoch(input, [3, 3])
    expect(result[3].k1).toBe(50)
    expect(result[4].k1).toBe(40)
    expect(result.slice(0, 6)).toEqual(calculateStoch(input.slice(0, 6), [3, 3]))
  })
  it('uses all eleven supplied defaults', () => {
    expect(Object.values(STOCH_DEFAULTS)).toEqual([
      [10, 20], [30, 180], [30, 120], [30, 120], [30, 120], [30, 120],
      [45, 180], [30, 210], [10, 70], [10, 40], [10, 30],
    ])
  })
  it('handles empty history, rejects invalid lengths and sanitizes saved settings', () => {
    expect(calculateStoch([], [10, 20])).toEqual([])
    for (const length of [0, -1, 1.5, NaN, Infinity]) {
      expect(() => calculateStoch([], [length, 1])).toThrow(RangeError)
    }
    expect(readStochSettings('{')).toEqual({})
    expect(readStochSettings('{"1m":[7,21],"5m":[0,2],"1h":["3",4],"bad":[1,2]}'))
      .toEqual({ '1m': [7, 21] })
  })
})
