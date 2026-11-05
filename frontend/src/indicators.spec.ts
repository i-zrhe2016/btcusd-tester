import { describe, expect, it } from 'vitest'
import type { IndicatorBar, IndicatorDef } from '@getcandlekit/charts'
import {
  createReplayIndicatorRegistry,
  normalizeIndicatorList,
  oscillatorCount,
  replayIndicatorGroups,
  type ReplayIndicator,
} from './indicators'
import { normalizeReplayIndicators } from './indicatorModel'

function bar(time: number, high: number, low: number, close: number, open = close, volume = 1): IndicatorBar {
  return { time, open, high, low, close, volume }
}

function definitionFor(name: string): IndicatorDef {
  const definition = createReplayIndicatorRegistry().get(name)
  if (!definition) throw new Error(`missing ${name}`)
  return definition
}

function plot(definition: IndicatorDef, bars: IndicatorBar[], inputs: Record<string, unknown>, id: string) {
  return definition.calculate(bars, inputs).plots[id] ?? []
}

describe('replay indicator registry', () => {
  it('offers the eight classic built-ins plus seven extras and hides CandleKit Stochastic', () => {
    const groups = replayIndicatorGroups()
    const names = Object.values(groups).flat().map((definition) => definition.name).sort()
    expect(names).toHaveLength(15)
    expect(names).not.toContain('Stochastic')
    expect(names).toEqual([
      'ATR', 'Bollinger', 'CCI', 'DMI', 'EMA', 'KDJ', 'MACD', 'OBV',
      'ROC', 'RSI', 'SMA', 'TRIX', 'VWAP', 'WMA', 'WR',
    ])
    expect(groups.overlay.length + groups.oscillator.length + groups.pattern.length).toBe(15)
  })
})

describe('classic indicator math', () => {
  it('computes KDJ with Wilder-style smoothing and 50 warm-up seeds', () => {
    const bars = [
      bar(1, 3, 1, 2),
      bar(2, 4, 2, 3),
      bar(3, 5, 3, 4),
      bar(4, 6, 4, 5),
    ]
    const definition = definitionFor('KDJ')
    const k = plot(definition, bars, { length: 3, k: 3, d: 3 }, 'k')
    const d = plot(definition, bars, { length: 3, k: 3, d: 3 }, 'd')
    const j = plot(definition, bars, { length: 3, k: 3, d: 3 }, 'j')

    expect(k.map((point) => point.time)).toEqual([3, 4])
    expect(k[0].value).toBeCloseTo(58.3333, 4)
    expect(d[0].value).toBeCloseTo(52.7778, 4)
    expect(j[0].value).toBeCloseTo(69.4444, 4)
    expect(k[1].value).toBeCloseTo(63.8889, 4)
    expect(d[1].value).toBeCloseTo(56.4815, 4)
    expect(j[1].value).toBeCloseTo(78.7037, 4)
  })

  it('falls back to 50 when every KDJ range is flat', () => {
    const bars = [bar(1, 5, 5, 5), bar(2, 5, 5, 5), bar(3, 5, 5, 5)]
    const k = plot(definitionFor('KDJ'), bars, { length: 3, k: 3, d: 3 }, 'k')
    expect(k[0].value).toBe(50)
  })

  it('accumulates OBV from signed volume', () => {
    const bars = [
      bar(1, 0, 0, 10, 10, 5),
      bar(2, 0, 0, 11, 10, 3),
      bar(3, 0, 0, 10, 11, 4),
      bar(4, 0, 0, 10, 10, 6),
      bar(5, 0, 0, 12, 10, 2),
    ]
    const obv = plot(definitionFor('OBV'), bars, {}, 'obv')
    expect(obv.map((point) => point.value)).toEqual([0, 3, -1, -1, 1])
  })

  it('computes CCI from typical-price deviation and guards flat windows', () => {
    const bars = [bar(1, 1, 1, 1), bar(2, 2, 2, 2), bar(3, 3, 3, 3)]
    const cci = plot(definitionFor('CCI'), bars, { length: 3 }, 'cci')
    expect(cci).toHaveLength(1)
    expect(cci[0].value).toBeCloseTo(100, 6)

    const flat = [bar(1, 2, 2, 2), bar(2, 2, 2, 2), bar(3, 2, 2, 2)]
    expect(plot(definitionFor('CCI'), flat, { length: 3 }, 'cci')[0].value).toBe(0)
  })

  it('computes Williams %R over the lookback window', () => {
    const bars = [
      bar(1, 10, 4, 6),
      bar(2, 12, 6, 9),
      bar(3, 11, 5, 7),
    ]
    const wr = plot(definitionFor('WR'), bars, { length: 3 }, 'wr')
    // HH = 12, LL = 4, close = 7 -> -(12 - 7) / 8 * 100
    expect(wr[0].value).toBeCloseTo(-62.5, 6)
  })

  it('computes DMI directional lines and a lagging ADX', () => {
    const bars = [
      bar(1, 11, 9, 10),
      bar(2, 12, 10, 11),
      bar(3, 13, 11, 12),
      bar(4, 14, 12, 13),
    ]
    const definition = definitionFor('DMI')
    const inputs = { length: 2 }
    const plus = plot(definition, bars, inputs, 'plusDi')
    const minus = plot(definition, bars, inputs, 'minusDi')
    const adx = plot(definition, bars, inputs, 'adx')

    expect(plus.map((point) => point.time)).toEqual([2, 3, 4])
    expect(plus.map((point) => point.value)).toEqual([25, 37.5, 43.75])
    expect(minus.every((point) => point.value === 0)).toBe(true)
    expect(adx.map((point) => point.time)).toEqual([3, 4])
    expect(adx.every((point) => point.value === 100)).toBe(true)
  })

  it('computes ROC against the close N bars back', () => {
    const bars = [10, 12, 11, 15].map((close, index) => bar(index + 1, close, close, close))
    const roc = plot(definitionFor('ROC'), bars, { length: 2 }, 'roc')
    expect(roc.map((point) => point.time)).toEqual([3, 4])
    expect(roc[0].value).toBeCloseTo(10, 6)
    expect(roc[1].value).toBeCloseTo(25, 6)
  })

  it('computes TRIX from a triple EMA and keeps the signal line on warm-up', () => {
    const bars = [10, 11, 12, 13, 14].map((close, index) => bar(index + 1, close, close, close))
    const definition = definitionFor('TRIX')
    const trix = plot(definition, bars, { length: 2, signal: 2 }, 'trix')
    expect(trix).toHaveLength(1)
    expect(trix[0].time).toBe(5)
    expect(trix[0].value).toBeCloseTo(8.6957, 4)
    expect(plot(definition, bars, { length: 2, signal: 2 }, 'signal')).toHaveLength(0)
  })
})

describe('normalizing stored selections', () => {
  it('keeps only supported timeframes and structurally valid entries', () => {
    expect(normalizeReplayIndicators({
      '1h': [
        { name: ' MACD ', params: { fast: 12, slow: 26, signal: 9 } },
        { name: 'MACD', params: { fast: 99 } },
        { name: 'KDJ', params: { length: 9 } },
        { name: '', params: {} },
        { name: 'x'.repeat(65) },
        { name: 'SMA', params: { length: '20', enabled: true, bad: null } },

      ],
      '7m': [{ name: 'RSI' }],
      '1d': 'nope',
    })).toEqual({
      '1h': [
        { name: 'MACD', params: { fast: 12, slow: 26, signal: 9 } },
        { name: 'KDJ', params: { length: 9 } },
        { name: 'SMA', params: { length: '20', enabled: true } },
      ],
    })
  })

  it('caps entries per timeframe and sizes numbers and strings', () => {
    const entries = Array.from({ length: 12 }, (_, index) => ({ name: `IND${index}`, params: {} }))
    expect(normalizeReplayIndicators({ '1h': entries })['1h']).toHaveLength(8)

    const stored = normalizeReplayIndicators({
      '1h': [{
        name: 'SMA',
        params: { length: Number.POSITIVE_INFINITY, text: 'x'.repeat(129), ok: 'y'.repeat(128), 'bad-key': 1 },
      }],
    })
    expect(stored['1h'][0].params).toEqual({ ok: 'y'.repeat(128) })
  })

  it('returns an empty state for malformed documents', () => {
    expect(normalizeReplayIndicators(null)).toEqual({})
    expect(normalizeReplayIndicators([])).toEqual({})
    expect(normalizeReplayIndicators({ '1h': {} })).toEqual({})
  })

  it('clamps picker selections to known indicators and pane limits', () => {
    const list: ReplayIndicator[] = [
      { name: 'SMA', params: { length: 0 } },
      { name: 'SMA', params: { length: 99 } },
      { name: 'NOPE', params: {} },
      ...['RSI', 'MACD', 'KDJ', 'CCI', 'WR'].map((name) => ({ name, params: {} })),
    ]
    const normalized = normalizeIndicatorList(list)
    expect(normalized[0]).toEqual({ name: 'SMA', params: { length: 1 } })
    expect(normalized.map((indicator) => indicator.name)).toEqual(['SMA', 'RSI', 'MACD', 'KDJ', 'CCI'])
    expect(oscillatorCount(normalized)).toBe(4)
  })
})
