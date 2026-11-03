import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import type { MarketSnapshot } from './types'

const params = { timeframe: '1h', from: 0, to: 36000, lengths: [30, 120, 840] as [number, number, number] }
const snapshot: MarketSnapshot = { symbol: 'BTCUSD', timeframe: '1h', source: 'test', candles: [
  { timestamp: 0, open: 10, high: 12, low: 9, close: 11, volume: 1 },
] }
const response = (value = snapshot) => ({ ok: true, json: async () => value })

beforeEach(() => { vi.resetModules(); vi.useFakeTimers(); vi.stubGlobal('fetch', vi.fn().mockResolvedValue(response())) })
afterEach(() => { vi.useRealTimers(); vi.unstubAllGlobals() })

describe('market snapshot reuse', () => {
  it('shares concurrent requests and serves the same candles when switching back', async () => {
    const { getMarketSnapshot } = await import('./api')
    const first = getMarketSnapshot(params)
    const duplicate = getMarketSnapshot({ ...params, limit: 500 })
    expect(duplicate).toBe(first)
    expect(await first).toEqual(snapshot)
    await getMarketSnapshot({ ...params, timeframe: '5m' })
    expect(await getMarketSnapshot(params)).toEqual(snapshot)
    expect(fetch).toHaveBeenCalledTimes(2)
  })

  it('keeps candle identity in reactive panes while notifying snapshot replacements', async () => {
    const { reactive, watchEffect } = await import('vue')
    const { getMarketSnapshot } = await import('./api')
    const first = await getMarketSnapshot(params)
    const pane = reactive({ snapshot: first })
    const seen: number[] = []
    const stop = watchEffect(() => { seen.push(pane.snapshot.candles[0]!.close) }, { flush: 'sync' })
    expect(pane.snapshot.candles).toBe(first.candles)
    expect(pane.snapshot.candles[0]).toBe(first.candles[0])
    const next = { ...snapshot, candles: [{ ...snapshot.candles[0]!, close: 25 }] }
    vi.mocked(fetch).mockResolvedValueOnce(response(next) as Response)
    pane.snapshot = await getMarketSnapshot({ ...params, timeframe: '5m' })
    expect(seen).toEqual([11, 25])
    expect(pane.snapshot.candles[0]).toBe(next.candles[0])
    stop()
  })

  it('isolates ranges, limits and indicator lengths', async () => {
    const { getMarketSnapshot } = await import('./api')
    await getMarketSnapshot(params)
    for (const change of [{ from: 60 }, { to: 72000 }, { limit: 10 }, { lengths: [2, 3, 4] as [number, number, number] }]) {
      const changed = { ...snapshot, candles: [{ ...snapshot.candles[0]!, close: 20 }] }
      vi.mocked(fetch).mockResolvedValueOnce(response(changed) as Response)
      expect(await getMarketSnapshot({ ...params, ...change })).toEqual(changed)
    }
    expect(fetch).toHaveBeenCalledTimes(5)
  })

  it('refreshes expired data', async () => {
    const { getMarketSnapshot } = await import('./api')
    await getMarketSnapshot(params)
    vi.advanceTimersByTime(5 * 60 * 1000)
    const refreshed = { ...snapshot, candles: [] }
    vi.mocked(fetch).mockResolvedValueOnce(response(refreshed) as Response)
    expect(await getMarketSnapshot(params)).toEqual(refreshed)
    expect(fetch).toHaveBeenCalledTimes(2)
  })

  it('does not cache errors and permits a successful retry', async () => {
    const { getMarketSnapshot } = await import('./api')
    vi.mocked(fetch).mockResolvedValueOnce({ ok: false, status: 503, json: async () => ({ message: '行情暂不可用，请重试' }) } as Response)
    await expect(getMarketSnapshot(params)).rejects.toThrow('行情暂不可用，请重试')
    expect(await getMarketSnapshot(params)).toEqual(snapshot)
    vi.mocked(fetch).mockRejectedValueOnce(new TypeError('Failed to fetch'))
    await expect(getMarketSnapshot({ ...params, from: 60 })).rejects.toThrow('Failed to fetch')
    expect(await getMarketSnapshot({ ...params, from: 60 })).toEqual(snapshot)
  })

  it('evicts the least recently used snapshot at capacity', async () => {
    const { getMarketSnapshot } = await import('./api')
    for (let from = 0; from < 24; from++) await getMarketSnapshot({ ...params, from })
    await getMarketSnapshot(params)
    await getMarketSnapshot({ ...params, from: 24 })
    expect(await getMarketSnapshot(params)).toEqual(snapshot)
    expect(fetch).toHaveBeenCalledTimes(25)
    expect(await getMarketSnapshot({ ...params, from: 1 })).toEqual(snapshot)
    expect(fetch).toHaveBeenCalledTimes(26)
  })
})
