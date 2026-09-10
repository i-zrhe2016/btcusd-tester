import { describe, expect, it } from 'vitest'
import {
  applyManualTrade,
  clampReplayCursor,
  closeManualPosition,
  createReplayProjectFromDraft,
  loadReplayProjects,
  nextReplayWindowStart,
  normalizeSpeed,
  reconcileReplayProject,
  replayCursorIndexAtOrBefore,
  replayDelayMs,
  replayUnloadedTimestamps,
  replayWindowEnd,
  saveReplayProjects,
  shouldPrefetchReplay,
  summarizeManualTrades,
  timeframeStepSeconds,
  REPLAY_PAGE_SIZE,
  REPLAY_PREFETCH_THRESHOLD,
  type ReplayProject,
  type ReplayDrawing,
} from './replay'

function createMemoryStorage() {
  const entries = new Map<string, string>()
  return {
    getItem(key: string) {
      return entries.get(key) ?? null
    },
    setItem(key: string, value: string) {
      entries.set(key, value)
    },
  }
}

describe('replay helpers', () => {
  it('normalizes replay projects from draft input', () => {
    const project = createReplayProjectFromDraft({
      name: '  Demo Replay  ',
      symbol: 'btcusd',
      timeframe: '1h',
      fromInput: '2026-08-27T00:00',
      toInput: '2026-08-27T02:00',
      speed: 1.5,
    })

    expect(project).toMatchObject<Partial<ReplayProject>>({
      name: 'Demo Replay',
      symbol: 'BTCUSD',
      timeframe: '1h',
      from: 1787788800,
      to: 1787796000,
      speed: 1.5,
      cursorIndex: 0,
      trades: [],
    })
  })

  it('round-trips stored replay projects', () => {
    const storage = createMemoryStorage()
    const project = createReplayProjectFromDraft({
      name: 'Replay One',
      symbol: 'BTCUSD',
      timeframe: '1m',
      fromInput: '2026-08-27T00:00',
      toInput: '2026-08-27T01:00',
      speed: 2,
    })

    saveReplayProjects([project], storage)
    const projects = loadReplayProjects(storage)

    expect(projects).toHaveLength(1)
    expect(projects[0]).toMatchObject({
      id: project.id,
      name: 'Replay One',
      symbol: 'BTCUSD',
      timeframe: '1m',
      from: project.from,
      to: project.to,
      speed: 2,
      cursorIndex: 0,
      trades: [],
      drawings: [],
    })
  })

  it('persists CandleKit drawings and keeps them when the project settings stay unchanged', () => {
    const storage = createMemoryStorage()
    const project = createReplayProjectFromDraft({
      name: 'Drawing Replay',
      symbol: 'BTCUSD',
      timeframe: '1m',
      fromInput: '2026-08-27T00:00',
      toInput: '2026-08-27T01:00',
      speed: 1,
    })
    const drawing: ReplayDrawing = {
      id: 'drawing-1',
      tool: 'TrendLine',
      points: [
        { timestamp: project.from + 60, price: 100 },
        { timestamp: project.from + 300, price: 110 },
      ],
      style: { color: '#facc15', width: 2, dashed: false, fill: null },
    }
    const projectWithDrawing = { ...project, drawings: [drawing] }

    saveReplayProjects([projectWithDrawing], storage)
    const loaded = loadReplayProjects(storage)[0]
    const edited = createReplayProjectFromDraft({
      name: 'Drawing Replay',
      symbol: 'BTCUSD',
      timeframe: '1m',
      fromInput: '2026-08-27T00:00',
      toInput: '2026-08-27T01:00',
      speed: 1.5,
    }, loaded)

    expect(loaded.drawings).toEqual([drawing])
    expect(edited.drawings).toEqual([drawing])
  })

  it('loads old v1 replay projects, preserves trades, and clears old trend lines', () => {
    const storage = createMemoryStorage()
    storage.setItem('btcusd.replay.projects.v1', JSON.stringify([{
      id: 'legacy-project',
      name: 'Legacy Replay',
      symbol: 'BTCUSD',
      timeframe: '1m',
      from: 1787788800,
      to: 1787796000,
      speed: 1,
      cursorIndex: 12,
      trendLines: [{
        id: 'legacy-line',
        start: { timestamp: 1787788860, price: 100 },
        end: { timestamp: 1787789160, price: 110 },
      }],
      createdAt: '2026-08-27T00:00:00.000Z',
      updatedAt: '2026-08-27T00:00:00.000Z',
    }]))

    expect(loadReplayProjects(storage)[0]).toMatchObject({
      id: 'legacy-project',
      trades: [],
      drawings: [],
    })
    expect(storage.getItem('btcusd.replay.projects.v1')).toContain('legacy-line')
  })

  it('clamps replay cursors to the available candle range', () => {
    expect(clampReplayCursor(-3, 12)).toBe(0)
    expect(clampReplayCursor(4, 12)).toBe(4)
    expect(clampReplayCursor(99, 12)).toBe(11)
    expect(clampReplayCursor(5, 0)).toBe(0)
  })

  it('maps a saved progress timestamp to the current timeframe window', () => {
    const candles = [{ timestamp: 100 }, { timestamp: 200 }, { timestamp: 360 }]

    expect(replayCursorIndexAtOrBefore(candles, 90)).toBe(0)
    expect(replayCursorIndexAtOrBefore(candles, 250)).toBe(1)
    expect(replayCursorIndexAtOrBefore(candles, 999)).toBe(2)
  })

  it('creates bounded lazy-loading windows', () => {
    expect(timeframeStepSeconds('1m')).toBe(60)
    expect(timeframeStepSeconds('5m')).toBe(300)
    expect(timeframeStepSeconds('3h')).toBe(10800)
    expect(REPLAY_PAGE_SIZE).toBe(60)
    expect(REPLAY_PREFETCH_THRESHOLD).toBe(15)
    expect(replayWindowEnd(1_000, 20_000, '1m')).toBe(4_600)
    expect(replayWindowEnd(1_000, 4_300, '1m')).toBe(4_300)
    expect(nextReplayWindowStart(4_539, '1m', 4_600)).toBe(4_600)
    expect(nextReplayWindowStart(undefined, '1m', 4_600)).toBe(4_600)
  })

  it('creates future timestamps for the unloaded drawing area', () => {
    expect(replayUnloadedTimestamps(1_000, '1m', 3)).toEqual([1_060, 1_120, 1_180])
    expect(replayUnloadedTimestamps(1_000, '1h', 2)).toEqual([4_600, 8_200])
    expect(replayUnloadedTimestamps(undefined, '1m', 3)).toEqual([])
    expect(replayUnloadedTimestamps(1_000, '1m', -1)).toEqual([])
  })

  it('prefetches only when the current batch has 15 or fewer unplayed candles', () => {
    expect(shouldPrefetchReplay(44, 60, true)).toBe(true)
    expect(shouldPrefetchReplay(43, 60, true)).toBe(false)
    expect(shouldPrefetchReplay(59, 60, true)).toBe(true)
    expect(shouldPrefetchReplay(44, 60, false)).toBe(false)
    expect(shouldPrefetchReplay(0, 0, true)).toBe(false)
  })

  it('normalizes playback speed and derives the timer delay', () => {
    expect(normalizeSpeed(0.1)).toBe(0.25)
    expect(normalizeSpeed(2.5)).toBe(2.5)
    expect(normalizeSpeed(12)).toBe(8)
    expect(normalizeSpeed(Number.NaN)).toBe(1)
    expect(replayDelayMs(0.25)).toBe(3600)
    expect(replayDelayMs(2)).toBe(450)
    expect(replayDelayMs(8)).toBe(120)
  })

  it('moves projects into the current market coverage after a data refresh', () => {
    const project = createReplayProjectFromDraft({
      name: 'Yesterday Replay',
      symbol: 'BTCUSD',
      timeframe: '1m',
      fromInput: '2026-08-27T00:00',
      toInput: '2026-08-27T04:00',
      speed: 1,
    })
    const aligned = reconcileReplayProject(project, {
      symbol: 'BTCUSD',
      base_timeframe: '1m',
      source: 'Parquet',
      candle_count: 241,
      first_timestamp: 2_000,
      last_timestamp: 2_240,
      supported_timeframes: ['1m'],
    })

    expect(aligned).toMatchObject({
      from: 2_000,
      to: 2_240 + 60,
      cursorIndex: 0,
      trades: [],
    })
    expect(aligned).not.toBe(project)
  })

  it('opens and closes long positions with fixed size manual trades', () => {
    const project = createReplayProjectFromDraft({
      name: 'Manual Replay',
      symbol: 'BTCUSD',
      timeframe: '1m',
      fromInput: '2026-08-27T00:00',
      toInput: '2026-08-27T01:00',
      speed: 1,
    })

    const longProject = applyManualTrade(project, {
      side: 'buy',
      candleIndex: 3,
      timestamp: project.from + 180,
      price: 100,
    })
    const closedProject = applyManualTrade(longProject, {
      side: 'sell',
      candleIndex: 5,
      timestamp: project.from + 300,
      price: 112,
    })

    expect(longProject.trades[0]).toMatchObject({
      side: 'buy',
      action: 'open-long',
      quantity: 1,
      realizedPnl: null,
    })
    expect(longProject.cursorTimestamp).toBe(project.from + 180)
    expect(closedProject.trades[1]).toMatchObject({
      side: 'sell',
      action: 'close-long',
      realizedPnl: 12,
    })
    expect(summarizeManualTrades(closedProject.trades, 112, 5)).toMatchObject({
      side: 'flat',
      quantity: 0,
      realizedPnl: 12,
      unrealizedPnl: 0,
      netPnl: 12,
    })
  })

  it('opens and closes short positions with buy and sell', () => {
    const project = createReplayProjectFromDraft({
      name: 'Short Replay',
      symbol: 'BTCUSD',
      timeframe: '1m',
      fromInput: '2026-08-27T00:00',
      toInput: '2026-08-27T01:00',
      speed: 1,
    })

    const shortProject = applyManualTrade(project, {
      side: 'sell',
      candleIndex: 1,
      timestamp: project.from + 60,
      price: 120,
    })
    const closedProject = applyManualTrade(shortProject, {
      side: 'buy',
      candleIndex: 4,
      timestamp: project.from + 240,
      price: 105,
    })

    expect(shortProject.trades[0]).toMatchObject({
      side: 'sell',
      action: 'open-short',
    })
    expect(summarizeManualTrades(shortProject.trades, 110, 1)).toMatchObject({
      side: 'short',
      quantity: 1,
      unrealizedPnl: 10,
      netPnl: 10,
    })
    expect(closedProject.trades[1]).toMatchObject({
      side: 'buy',
      action: 'close-short',
      realizedPnl: 15,
    })
  })

  it('closes the entire current position with an explicit close action', () => {
    const project = createReplayProjectFromDraft({
      name: 'Close Replay',
      symbol: 'BTCUSD',
      timeframe: '1m',
      fromInput: '2026-08-27T00:00',
      toInput: '2026-08-27T01:00',
      speed: 1,
    })

    const firstLong = applyManualTrade(project, {
      side: 'buy',
      candleIndex: 1,
      timestamp: project.from + 60,
      price: 100,
    })
    const secondLong = applyManualTrade(firstLong, {
      side: 'buy',
      candleIndex: 2,
      timestamp: project.from + 120,
      price: 110,
    })
    const closedProject = closeManualPosition(secondLong, {
      candleIndex: 4,
      timestamp: project.from + 240,
      price: 112,
    })

    expect(closedProject.trades.at(-1)).toMatchObject({
      side: 'sell',
      action: 'close-long',
      quantity: 2,
      realizedPnl: 14,
    })
    expect(summarizeManualTrades(closedProject.trades, 112, 4)).toMatchObject({
      side: 'flat',
      quantity: 0,
      realizedPnl: 14,
      unrealizedPnl: 0,
    })
    expect(closeManualPosition(project, {
      candleIndex: 4,
      timestamp: project.from + 240,
      price: 112,
    })).toBe(project)
  })

  it('drops future manual trades when trading after rewinding', () => {
    const project = createReplayProjectFromDraft({
      name: 'Rewind Replay',
      symbol: 'BTCUSD',
      timeframe: '1m',
      fromInput: '2026-08-27T00:00',
      toInput: '2026-08-27T01:00',
      speed: 1,
    })
    const first = applyManualTrade(project, {
      side: 'buy',
      candleIndex: 2,
      timestamp: project.from + 120,
      price: 100,
    })
    const future = applyManualTrade(first, {
      side: 'sell',
      candleIndex: 8,
      timestamp: project.from + 480,
      price: 106,
    })
    const rewritten = applyManualTrade(future, {
      side: 'sell',
      candleIndex: 4,
      timestamp: project.from + 240,
      price: 103,
    })

    expect(rewritten.trades).toHaveLength(2)
    expect(rewritten.trades.map((trade) => trade.candleIndex)).toEqual([2, 4])
    expect(rewritten.trades[1]).toMatchObject({
      action: 'close-long',
      realizedPnl: 3,
    })
  })
})
