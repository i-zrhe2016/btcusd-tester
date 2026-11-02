import { describe, expect, it } from 'vitest'
import {
  calculateStoch,
  defaultStochSetting,
  readStochSettings,
  STOCH_DEFAULTS,
  validStochLengths,
} from './stoch'
import type { Candle } from './types'

const candles = (closes: number[]): Candle[] => closes.map((close, timestamp) => ({
  timestamp, close, open: close, high: close + 100, low: close - 100, volume: 1,
}))

describe('Pine close-based Stoch', () => {
  it('uses closes, partial extrema history, and two full SMA windows', () => {
    const result = calculateStoch(candles([10, 20, 30, 20, 10]), [5, 1])
    expect(result.map((p) => p.k1)).toEqual([null, 50, 100, 75, 25])
    expect(result.map((p) => p.d1)).toEqual([null, null, 75, 87.5, 50])
    expect(result.map((p) => p.k2)).toEqual([0, 0, 0, 0, 0])
    expect(result.map((p) => [p.k3, p.d3])).toEqual(Array(5).fill([null, null]))
  })
  it('adds a third group without touching the first two', () => {
    const input = candles([10, 30, 20, 25, 22, 21, 40, 35])
    const two = calculateStoch(input, [3, 2])
    const three = calculateStoch(input, [3, 2, 5])
    expect(three.map((p) => [p.k1, p.d1, p.k2, p.d2]))
      .toEqual(two.map((p) => [p.k1, p.d1, p.k2, p.d2]))
    expect(three.at(-1)?.k3).toBeTypeOf('number')
    expect(three.at(-1)?.d3).toBeTypeOf('number')
  })
  it('returns zero on flat prices after warmup and rounds .5 upward', () => {
    const result = calculateStoch(candles(Array(30).fill(42)), [15, 10])
    expect(result[3].k1).toBeNull()
    expect(result[4].k1).toBe(0)
    expect(result[7].d1).toBeNull()
    expect(result[8].d1).toBe(0)
    expect(result[4].d2).toBe(0)
  })
  it('expires extrema and never changes earlier values with future candles', () => {
    const input = candles([10, 30, 20, 25, 22, 21, 1000])
    const result = calculateStoch(input, [3, 3])
    expect(result[3].k1).toBe(50)
    expect(result[4].k1).toBe(40)
    expect(result.slice(0, 6)).toEqual(calculateStoch(input.slice(0, 6), [3, 3]))
  })
  it('uses the v12 defaults with four active groups and six configurable lengths', () => {
    expect(Object.keys(STOCH_DEFAULTS)).toHaveLength(12)
    expect(defaultStochSetting('1m')).toEqual({ groups: 4, lengths: [30, 80, 150, 300, 600, 1200] })
    expect(defaultStochSetting('4h')).toEqual({ groups: 4, lengths: [10, 60, 420, 840, 1680, 3360] })
    expect(defaultStochSetting('unknown')).toEqual({ groups: 4, lengths: STOCH_DEFAULTS['1h'] })
    const input = candles([10, 30, 20, 25, 22, 21, 40, 35])
    const six = calculateStoch(input, [3, 2, 5, 2, 3, 5])
    expect(six.map(p => [p.k6, p.d6])).toEqual(six.map(p => [p.k3, p.d3]))
    expect(six.map(p => [p.k1, p.d1])).toEqual(calculateStoch(input, [3, 2]).map(p => [p.k1, p.d1]))
  })
  it('handles empty history, rejects invalid lengths and sanitizes saved settings', () => {
    expect(calculateStoch([], [10, 20])).toEqual([])
    for (const length of [0, -1, 1.5, NaN, Infinity]) {
      expect(() => calculateStoch([], [length, 1])).toThrow(RangeError)
    }
    expect(() => calculateStoch([], [10])).toThrow(RangeError)
    expect(() => calculateStoch([], [10, 20, 30, 40, 50, 60, 70])).toThrow(RangeError)
    expect(validStochLengths([1, 2])).toBe(true)
    expect(validStochLengths([1, 2, 3])).toBe(true)
    expect(validStochLengths([1])).toBe(false)
    expect(readStochSettings('{')).toEqual({})
    expect(readStochSettings(JSON.stringify({
      '1m': [7, 21],
      '5m': [7, 21, 63],
      '1h': { groups: 3, lengths: [8, 24, 96] },
      '2h': { groups: 3, lengths: [8, 24] },
      '3h': { groups: 7, lengths: [8, 24, 96] },
      '4h': [0, 2],
      bad: [1, 2],
    }))).toEqual({
      '1m': { groups: 2, lengths: [7, 21, 150, 300, 600, 1200] },
      '5m': { groups: 3, lengths: [7, 21, 63, 1440, 2880, 5760] },
      '1h': { groups: 3, lengths: [8, 24, 96, 480, 960, 1920] },
      '2h': { groups: 3, lengths: [8, 24, 840, 1680, 3360, 6720] },
    })
  })
})
