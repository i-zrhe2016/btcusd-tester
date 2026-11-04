export type PreviewCandle = { t: number; o: number; h: number; l: number; c: number }

export type PreviewTimeframe = {
  id: string
  label: string
  step: number
  base: number
  drift: number
  volatility: number
  seed: number
}

export const PREVIEW_CANDLE_COUNT = 76
export const PREVIEW_TRADES = [
  { index: 24, side: 'buy' as const, label: 'BUY #1' },
  { index: 40, side: 'sell' as const, label: 'SELL #2' },
]
export const PREVIEW_INITIAL_CURSOR = 34

const END = Date.UTC(2024, 10, 4, 0, 0, 0)

export const PREVIEW_TIMEFRAMES: PreviewTimeframe[] = [
  { id: '1m', label: '1m', step: 60, base: 61400, drift: 0.00002, volatility: 0.005, seed: 23 },
  { id: '5m', label: '5m', step: 300, base: 61400, drift: 0.00003, volatility: 0.0085, seed: 41 },
  { id: '15m', label: '15m', step: 900, base: 61400, drift: 0.00005, volatility: 0.011, seed: 67 },
  { id: '1h', label: '1H', step: 3600, base: 61400, drift: 0.00007, volatility: 0.015, seed: 89 },
  { id: '4h', label: '4H', step: 14400, base: 61400, drift: 0.0001, volatility: 0.022, seed: 113 },
  { id: '1d', label: '1D', step: 86400, base: 61400, drift: 0.0002, volatility: 0.034, seed: 151 },
]

function mulberry32(seed: number) {
  let value = seed >>> 0
  return () => {
    value = (value + 0x6d2b79f5) >>> 0
    let t = value
    t = Math.imul(t ^ (t >>> 15), t | 1)
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61)
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296
  }
}

export function buildPreviewSeries(timeframe: PreviewTimeframe, count = PREVIEW_CANDLE_COUNT): PreviewCandle[] {
  const random = mulberry32(timeframe.seed)
  const candles: PreviewCandle[] = []
  const start = END / 1000 - count * timeframe.step
  let base = timeframe.base * 0.972
  let previousClose = base

  for (let index = 0; index < count; index += 1) {
    const noise = (random() - 0.5) * timeframe.volatility * 1.35
    base *= 1 + timeframe.drift + noise
    const wave = (
      Math.sin(index / 24 + timeframe.seed * 0.11) * 0.55
      + Math.sin(index / 7.5 + timeframe.seed * 0.37) * 0.28
    ) * timeframe.volatility
    const open = previousClose
    const close = base * (1 + wave)
    const high = Math.max(open, close) * (1 + random() * timeframe.volatility * 0.55)
    const low = Math.min(open, close) * (1 - random() * timeframe.volatility * 0.55)
    candles.push({ t: start + index * timeframe.step, o: open, h: high, l: low, c: close })
    previousClose = close
  }
  return candles
}

export function formatPreviewPrice(value: number): string {
  return Math.round(value).toLocaleString('en-US')
}

export function formatPreviewClock(timestamp: number): string {
  return new Date(timestamp * 1000).toISOString().slice(0, 16).replace('T', ' ')
}
