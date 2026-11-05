import {
  BUILTIN_INDICATORS,
  IndicatorRegistry,
  type IndicatorBar,
  type IndicatorCategory,
  type IndicatorDef,
  type InputConfig,
  type PlotPoint,
} from '@getcandlekit/charts'
import type { MessageKey } from './i18n'
import {
  MAX_INDICATORS_PER_TIMEFRAME,
  MAX_OSCILLATOR_INDICATORS,
  type ReplayIndicator,
} from './indicatorModel'

export type { ReplayIndicator, ReplayIndicatorState } from './indicatorModel'
export { MAX_INDICATORS_PER_TIMEFRAME, MAX_OSCILLATOR_INDICATORS } from './indicatorModel'

const MAX_INDICATOR_LENGTH = 5_000

type Series = Array<number | null>

// ── math helpers (the same warm-up conventions as CandleKit's built-ins) ──────

function smaSeries(values: number[], length: number): Series {
  const result: Series = new Array(values.length).fill(null)
  if (length <= 0) return result
  let sum = 0
  for (let index = 0; index < values.length; index += 1) {
    sum += values[index]
    if (index >= length) sum -= values[index - length]
    if (index >= length - 1) result[index] = sum / length
  }
  return result
}

function emaSeries(values: number[], length: number): Series {
  const result: Series = new Array(values.length).fill(null)
  if (length <= 0 || values.length < length) return result
  const factor = 2 / (length + 1)
  let seed = 0
  for (let index = 0; index < length; index += 1) seed += values[index]
  let previous = seed / length
  result[length - 1] = previous
  for (let index = length; index < values.length; index += 1) {
    previous = values[index] * factor + previous * (1 - factor)
    result[index] = previous
  }
  return result
}

/** Wilder's RMA, used by ATR/DMI. */
function rmaSeries(values: number[], length: number): Series {
  const result: Series = new Array(values.length).fill(null)
  if (length <= 0 || values.length < length) return result
  let sum = 0
  for (let index = 0; index < length; index += 1) sum += values[index]
  let previous = sum / length
  result[length - 1] = previous
  for (let index = length; index < values.length; index += 1) {
    previous = (previous * (length - 1) + values[index]) / length
    result[index] = previous
  }
  return result
}

interface DefinedSeries {
  values: number[]
  indexes: number[]
}

function definedSeries(series: Series): DefinedSeries {
  const values: number[] = []
  const indexes: number[] = []
  series.forEach((value, index) => {
    if (value != null && Number.isFinite(value)) {
      values.push(value)
      indexes.push(index)
    }
  })
  return { values, indexes }
}

function emaOfSeries(series: Series, length: number): Series {
  const { values, indexes } = definedSeries(series)
  const smoothed = emaSeries(values, length)
  const result: Series = new Array(series.length).fill(null)
  smoothed.forEach((value, position) => {
    if (value != null) result[indexes[position]] = value
  })
  return result
}

function smaOfSeries(series: Series, length: number): Series {
  const { values, indexes } = definedSeries(series)
  const smoothed = smaSeries(values, length)
  const result: Series = new Array(series.length).fill(null)
  smoothed.forEach((value, position) => {
    if (value != null) result[indexes[position]] = value
  })
  return result
}

function rmaOfSeries(series: Series, length: number): Series {
  const { values, indexes } = definedSeries(series)
  const smoothed = rmaSeries(values, length)
  const result: Series = new Array(series.length).fill(null)
  smoothed.forEach((value, position) => {
    if (value != null) result[indexes[position]] = value
  })
  return result
}

function toPoints(bars: IndicatorBar[], series: Series): PlotPoint[] {
  const points: PlotPoint[] = []
  for (let index = 0; index < bars.length; index += 1) {
    const value = series[index]
    if (value != null && Number.isFinite(value)) points.push({ time: bars[index].time, value })
  }
  return points
}

const closes = (bars: IndicatorBar[]) => bars.map((bar) => bar.close)

function intInput(inputs: Record<string, unknown> | undefined, key: string, fallback: number): number {
  const value = Number(inputs?.[key])
  if (!Number.isFinite(value) || value <= 0) return fallback
  return Math.min(MAX_INDICATOR_LENGTH, Math.max(1, Math.floor(value)))
}

function floatInput(inputs: Record<string, unknown> | undefined, key: string, fallback: number): number {
  const value = Number(inputs?.[key])
  return Number.isFinite(value) && value > 0 ? value : fallback
}

const HLINE_STYLE = { color: '#787b86', linestyle: 'dashed' as const }

// ── classic indicator definitions ─────────────────────────────────────────────

const KDJ: IndicatorDef = {
  name: 'KDJ',
  title: 'Stochastic KDJ',
  shortTitle: 'KDJ',
  category: 'oscillator',
  defaultInputs: { length: 9, k: 3, d: 3 },
  inputConfig: [
    { name: 'length', type: 'int', defval: 9, title: 'Length' },
    { name: 'k', type: 'int', defval: 3, title: 'K Smoothing' },
    { name: 'd', type: 'int', defval: 3, title: 'D Smoothing' },
  ],
  plotConfig: [
    { id: 'k', title: 'K', color: '#ffeb3b', lineWidth: 2 },
    { id: 'd', title: 'D', color: '#29b6f6', lineWidth: 2 },
    { id: 'j', title: 'J', color: '#ff7043', lineWidth: 2 },
  ],
  hlineConfig: [{ price: 20, ...HLINE_STYLE, title: '20' }, { price: 80, ...HLINE_STYLE, title: '80' }],
  calculate: (bars, inputs) => {
    const length = intInput(inputs, 'length', 9)
    const kLength = intInput(inputs, 'k', 3)
    const dLength = intInput(inputs, 'd', 3)
    const kSeries: Series = new Array(bars.length).fill(null)
    const dSeries: Series = new Array(bars.length).fill(null)
    const jSeries: Series = new Array(bars.length).fill(null)
    let previousK = 50
    let previousD = 50
    for (let index = 0; index < bars.length; index += 1) {
      if (index < length - 1) continue
      let highest = -Infinity
      let lowest = Infinity
      for (let offset = 0; offset < length; offset += 1) {
        highest = Math.max(highest, bars[index - offset].high)
        lowest = Math.min(lowest, bars[index - offset].low)
      }
      const rsv = highest === lowest ? 50 : (100 * (bars[index].close - lowest)) / (highest - lowest)
      const k = ((kLength - 1) * previousK + rsv) / kLength
      const d = ((dLength - 1) * previousD + k) / dLength
      previousK = k
      previousD = d
      kSeries[index] = k
      dSeries[index] = d
      jSeries[index] = 3 * k - 2 * d
    }
    return { plots: { k: toPoints(bars, kSeries), d: toPoints(bars, dSeries), j: toPoints(bars, jSeries) } }
  },
}

const OBV: IndicatorDef = {
  name: 'OBV',
  title: 'On Balance Volume',
  shortTitle: 'OBV',
  category: 'oscillator',
  defaultInputs: {},
  inputConfig: [],
  plotConfig: [{ id: 'obv', title: 'OBV', color: '#26a69a', lineWidth: 2 }],
  hlineConfig: [],
  calculate: (bars) => {
    const series: Series = new Array(bars.length).fill(null)
    let value = 0
    for (let index = 0; index < bars.length; index += 1) {
      if (index > 0) {
        const change = bars[index].close - bars[index - 1].close
        if (change > 0) value += bars[index].volume || 0
        else if (change < 0) value -= bars[index].volume || 0
      }
      series[index] = value
    }
    return { plots: { obv: toPoints(bars, series) } }
  },
}

const CCI: IndicatorDef = {
  name: 'CCI',
  title: 'Commodity Channel Index',
  shortTitle: 'CCI',
  category: 'oscillator',
  defaultInputs: { length: 20 },
  inputConfig: [{ name: 'length', type: 'int', defval: 20, title: 'Length' }],
  plotConfig: [{ id: 'cci', title: 'CCI', color: '#ab47bc', lineWidth: 2 }],
  hlineConfig: [{ price: -100, ...HLINE_STYLE, title: '-100' }, { price: 100, ...HLINE_STYLE, title: '100' }],
  calculate: (bars, inputs) => {
    const length = intInput(inputs, 'length', 20)
    const typical = bars.map((bar) => (bar.high + bar.low + bar.close) / 3)
    const average = smaSeries(typical, length)
    const series: Series = new Array(bars.length).fill(null)
    for (let index = length - 1; index < bars.length; index += 1) {
      const mean = average[index]
      if (mean == null) continue
      let deviation = 0
      for (let offset = 0; offset < length; offset += 1) deviation += Math.abs(typical[index - offset] - mean)
      deviation /= length
      series[index] = deviation === 0 ? 0 : (typical[index] - mean) / (0.015 * deviation)
    }
    return { plots: { cci: toPoints(bars, series) } }
  },
}

const WR: IndicatorDef = {
  name: 'WR',
  title: 'Williams %R',
  shortTitle: 'W%R',
  category: 'oscillator',
  defaultInputs: { length: 14 },
  inputConfig: [{ name: 'length', type: 'int', defval: 14, title: 'Length' }],
  plotConfig: [{ id: 'wr', title: 'W%R', color: '#ffa726', lineWidth: 2 }],
  hlineConfig: [{ price: -20, ...HLINE_STYLE, title: '-20' }, { price: -80, ...HLINE_STYLE, title: '-80' }],
  calculate: (bars, inputs) => {
    const length = intInput(inputs, 'length', 14)
    const series: Series = new Array(bars.length).fill(null)
    for (let index = length - 1; index < bars.length; index += 1) {
      let highest = -Infinity
      let lowest = Infinity
      for (let offset = 0; offset < length; offset += 1) {
        highest = Math.max(highest, bars[index - offset].high)
        lowest = Math.min(lowest, bars[index - offset].low)
      }
      series[index] = highest === lowest ? 0 : ((highest - bars[index].close) / (highest - lowest)) * -100
    }
    return { plots: { wr: toPoints(bars, series) } }
  },
}

const DMI: IndicatorDef = {
  name: 'DMI',
  title: 'Directional Movement Index',
  shortTitle: 'DMI',
  category: 'oscillator',
  defaultInputs: { length: 14 },
  inputConfig: [{ name: 'length', type: 'int', defval: 14, title: 'Length' }],
  plotConfig: [
    { id: 'plusDi', title: '+DI', color: '#26a69a', lineWidth: 2 },
    { id: 'minusDi', title: '-DI', color: '#ef5350', lineWidth: 2 },
    { id: 'adx', title: 'ADX', color: '#ffca28', lineWidth: 2 },
  ],
  hlineConfig: [{ price: 20, ...HLINE_STYLE, title: '20' }],
  calculate: (bars, inputs) => {
    const length = intInput(inputs, 'length', 14)
    const trueRange: number[] = new Array(bars.length).fill(0)
    const plusMovement: number[] = new Array(bars.length).fill(0)
    const minusMovement: number[] = new Array(bars.length).fill(0)
    for (let index = 0; index < bars.length; index += 1) {
      const bar = bars[index]
      if (index === 0) {
        trueRange[index] = bar.high - bar.low
        continue
      }
      const previous = bars[index - 1]
      trueRange[index] = Math.max(
        bar.high - bar.low,
        Math.abs(bar.high - previous.close),
        Math.abs(bar.low - previous.close),
      )
      const up = bar.high - previous.high
      const down = previous.low - bar.low
      plusMovement[index] = up > down && up > 0 ? up : 0
      minusMovement[index] = down > up && down > 0 ? down : 0
    }
    const atr = rmaSeries(trueRange, length)
    const plusAverage = rmaSeries(plusMovement, length)
    const minusAverage = rmaSeries(minusMovement, length)
    const plusDi: Series = new Array(bars.length).fill(null)
    const minusDi: Series = new Array(bars.length).fill(null)
    const dx: Series = new Array(bars.length).fill(null)
    for (let index = 0; index < bars.length; index += 1) {
      const atrValue = atr[index]
      const plusValue = plusAverage[index]
      const minusValue = minusAverage[index]
      if (atrValue == null || plusValue == null || minusValue == null || atrValue <= 0) continue
      const plus = (100 * plusValue) / atrValue
      const minus = (100 * minusValue) / atrValue
      plusDi[index] = plus
      minusDi[index] = minus
      const total = plus + minus
      dx[index] = total === 0 ? 0 : (100 * Math.abs(plus - minus)) / total
    }
    return {
      plots: {
        plusDi: toPoints(bars, plusDi),
        minusDi: toPoints(bars, minusDi),
        adx: toPoints(bars, rmaOfSeries(dx, length)),
      },
    }
  },
}

const ROC: IndicatorDef = {
  name: 'ROC',
  title: 'Rate of Change',
  shortTitle: 'ROC',
  category: 'oscillator',
  defaultInputs: { length: 12 },
  inputConfig: [{ name: 'length', type: 'int', defval: 12, title: 'Length' }],
  plotConfig: [{ id: 'roc', title: 'ROC', color: '#42a5f5', lineWidth: 2 }],
  hlineConfig: [{ price: 0, ...HLINE_STYLE, linestyle: 'dotted' }],
  calculate: (bars, inputs) => {
    const length = intInput(inputs, 'length', 12)
    const values = closes(bars)
    const series: Series = new Array(bars.length).fill(null)
    for (let index = length; index < bars.length; index += 1) {
      const previous = values[index - length]
      if (previous === 0) continue
      series[index] = ((values[index] - previous) / previous) * 100
    }
    return { plots: { roc: toPoints(bars, series) } }
  },
}

const TRIX: IndicatorDef = {
  name: 'TRIX',
  title: 'Triple Exponential Average',
  shortTitle: 'TRIX',
  category: 'oscillator',
  defaultInputs: { length: 15, signal: 9 },
  inputConfig: [
    { name: 'length', type: 'int', defval: 15, title: 'Length' },
    { name: 'signal', type: 'int', defval: 9, title: 'Signal' },
  ],
  plotConfig: [
    { id: 'trix', title: 'TRIX', color: '#7e57c2', lineWidth: 2 },
    { id: 'signal', title: 'Signal', color: '#ff6d00', lineWidth: 1 },
  ],
  hlineConfig: [{ price: 0, ...HLINE_STYLE, linestyle: 'dotted' }],
  calculate: (bars, inputs) => {
    const length = intInput(inputs, 'length', 15)
    const signalLength = intInput(inputs, 'signal', 9)
    const values = closes(bars)
    const first = emaSeries(values, length)
    const second = emaOfSeries(first, length)
    const third = emaOfSeries(second, length)
    const trix: Series = new Array(bars.length).fill(null)
    for (let index = 1; index < bars.length; index += 1) {
      const current = third[index]
      const previous = third[index - 1]
      if (current == null || previous == null || previous === 0) continue
      trix[index] = ((current - previous) / previous) * 100
    }
    return { plots: { trix: toPoints(bars, trix), signal: toPoints(bars, smaOfSeries(trix, signalLength)) } }
  },
}

const CLASSIC_INDICATORS: IndicatorDef[] = [KDJ, OBV, CCI, WR, DMI, ROC, TRIX]

export const INDICATOR_LABEL_KEYS: Record<string, MessageKey> = {
  SMA: 'indicator.SMA',
  EMA: 'indicator.EMA',
  WMA: 'indicator.WMA',
  VWAP: 'indicator.VWAP',
  Bollinger: 'indicator.Bollinger',
  RSI: 'indicator.RSI',
  MACD: 'indicator.MACD',
  ATR: 'indicator.ATR',
  KDJ: 'indicator.KDJ',
  OBV: 'indicator.OBV',
  CCI: 'indicator.CCI',
  WR: 'indicator.WR',
  DMI: 'indicator.DMI',
  ROC: 'indicator.ROC',
  TRIX: 'indicator.TRIX',
}

let registry: IndicatorRegistry | null = null

export function createReplayIndicatorRegistry(): IndicatorRegistry {
  // The app renders its own multi-group Stoch pane, so the catalogue keeps
  // CandleKit's other eight built-ins and adds the classic extras.
  return new IndicatorRegistry()
    .registerAll(BUILTIN_INDICATORS.filter((definition) => definition.name !== 'Stochastic'))
    .registerAll(CLASSIC_INDICATORS)
}

export function getReplayIndicatorRegistry(): IndicatorRegistry {
  registry ??= createReplayIndicatorRegistry()
  return registry
}

export function replayIndicatorGroups(): Record<IndicatorCategory, IndicatorDef[]> {
  return getReplayIndicatorRegistry().byCategory()
}

function normalizedParams(
  definition: IndicatorDef,
  raw: unknown,
): Record<string, number | boolean | string> {
  const params: Record<string, number | boolean | string> = {}
  if (!raw || typeof raw !== 'object' || Array.isArray(raw)) return params
  const values = raw as Record<string, unknown>
  for (const config of definition.inputConfig as InputConfig[]) {
    const value = values[config.name]
    if (config.type === 'int') {
      const numeric = Number(value)
      if (Number.isFinite(numeric)) {
        params[config.name] = Math.min(MAX_INDICATOR_LENGTH, Math.max(1, Math.round(numeric)))
      }
    } else if (config.type === 'float') {
      const numeric = Number(value)
      if (Number.isFinite(numeric) && numeric > 0) params[config.name] = numeric
    } else if (config.type === 'bool') {
      if (typeof value === 'boolean') params[config.name] = value
    } else if (config.type === 'string') {
      if (typeof value === 'string' && (!config.options || config.options.includes(value))) {
        params[config.name] = value
      }
    }
  }
  return params
}

/**
 * Drops names this client does not know, clamps parameters to each definition's
 * inputs and applies the same pane limits as the picker. Stored state stays
 * structurally valid even when a newer client wrote an indicator this build
 * has never heard of.
 */
export function normalizeIndicatorList(list: ReplayIndicator[]): ReplayIndicator[] {
  const known = getReplayIndicatorRegistry()
  const selected = new Map<string, ReplayIndicator>()
  let oscillators = 0
  for (const entry of list) {
    if (!entry || typeof entry.name !== 'string') continue
    const definition = known.get(entry.name)
    if (!definition || selected.has(definition.name)) continue
    const isOscillator = definition.category === 'oscillator'
    if (selected.size >= MAX_INDICATORS_PER_TIMEFRAME) break
    if (isOscillator && oscillators >= MAX_OSCILLATOR_INDICATORS) continue
    if (isOscillator) oscillators += 1
    selected.set(definition.name, {
      name: definition.name,
      params: normalizedParams(definition, entry.params),
    })
  }
  return [...selected.values()]
}

export function oscillatorCount(indicators: ReplayIndicator[]): number {
  const known = getReplayIndicatorRegistry()
  return indicators.filter((indicator) => known.get(indicator.name)?.category === 'oscillator').length
}
