import { describe, expect, it } from 'vitest'
import { CRYPTO_MARKETS, isSupportedSymbol } from './symbols'
import { applyManualTrade, createReplayProjectFromDraft, draftFromProject, reconcileReplayProject } from './replay'

const draft = { name: 'Market replay', symbol: 'BTCUSD', timeframe: '1h', fromInput: '2026-01-01T00:00', toInput: '2026-01-02T00:00', speed: 1 }

describe('mainstream market replay', () => {
  it('supports the selected market-cap top ten and refuses unknown or USDT markets', () => {
    expect(CRYPTO_MARKETS.map((market) => market.symbol)).toEqual([
      'BTCUSD', 'ETHUSD', 'BNBUSD', 'XRPUSD', 'SOLUSD', 'TRXUSD', 'ZECUSD', 'HYPEUSD', 'DOGEUSD', 'XMRUSD',
    ])
    for (const market of CRYPTO_MARKETS) {
      expect(createReplayProjectFromDraft({ ...draft, symbol: market.symbol }).symbol).toBe(market.symbol)
    }
    expect(isSupportedSymbol('BTCUSDT')).toBe(false)
    expect(() => createReplayProjectFromDraft({ ...draft, symbol: 'UNKNOWNUSD' })).toThrow('Unsupported')
  })

  it('clears positions, drawings and cursor on a different asset but preserves a USD alias', () => {
    const base = createReplayProjectFromDraft(draft)
    const traded = { ...applyManualTrade(base, { side: 'buy', candleIndex: 3, timestamp: base.from + 10800, price: 65000 }), cursorIndex: 3, cursorTimestamp: base.from + 10800 }
    const alias = createReplayProjectFromDraft({ ...draftFromProject(traded), symbol: 'btc-usd' }, traded)
    expect(alias.trades).toEqual(traded.trades)
    expect(alias.cursorIndex).toBe(3)
    const eth = createReplayProjectFromDraft({ ...draftFromProject(traded), symbol: 'ETHUSD' }, traded)
    expect(eth.trades).toEqual([])
    expect(eth.drawings).toEqual([])
    expect(eth.cursorIndex).toBe(0)
    expect(eth.cursorTimestamp).toBeUndefined()
  })

  it('never clamps an ETH project to BTC history', () => {
    const project = createReplayProjectFromDraft({ ...draft, symbol: 'ETHUSD' })
    const metadata = { symbol: 'BTCUSD', base_timeframe: '1m', source: 'test', candle_count: 2, first_timestamp: project.to + 600, last_timestamp: project.to + 1200, supported_timeframes: ['1h'] }
    expect(reconcileReplayProject(project, metadata)).toBe(project)
    const aligned = reconcileReplayProject(project, { ...metadata, symbol: 'ETHUSD' })
    expect(aligned.from).toBe(metadata.first_timestamp)
    expect(aligned.to).toBe(metadata.last_timestamp + 60)
  })
})
