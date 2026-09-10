import { describe, expect, it } from 'vitest'
import {
  applyManualTrade,
  clampReplayCursor,
  closeManualPosition,
  createReplayProjectFromDraft,
  draftFromProject,
  loadReplayProjects,
  nextReplayWindowStart,
  normalizeSpeed,
  reanchorManualTrades,
  reconcileReplayProject,
  replayCursorIndexAtOrBefore,
  replayCursorIndexAtOrAfter,
  replayDelayMs,
  nextReplayPaneTimeframe,
  normalizeReplayPanes,
  replayPaneNeedsReload,
  replayPaneWindow,
  replayProgressLabel,
  withReplayPaneTimeframe,
  replayUnloadedTimestamps,
  replayWindowEnd,
  replayWindowRange,
  saveReplayProjects,
  shouldPrefetchReplay,
  summarizeManualTrades,
  timeframeStepSeconds,
  REPLAY_FORWARD_CANDLES,
  REPLAY_HISTORY_CANDLES,
  REPLAY_PAGE_SIZE,
  REPLAY_PANE_FORWARD_CANDLES,
  REPLAY_PANE_HISTORY_CANDLES,
  REPLAY_PANE_WINDOW_LIMIT,
  REPLAY_PREFETCH_THRESHOLD,
  REPLAY_TIMEFRAMES,
  REPLAY_WINDOW_LIMIT,
  type ManualTrade,
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

  it('maps an empty cursor timestamp to the first candle inside the project range', () => {
    const candles = [{ timestamp: 100 }, { timestamp: 200 }, { timestamp: 360 }]

    expect(replayCursorIndexAtOrAfter(candles, 90)).toBe(0)
    expect(replayCursorIndexAtOrAfter(candles, 200)).toBe(1)
    expect(replayCursorIndexAtOrAfter(candles, 300)).toBe(2)
    expect(replayCursorIndexAtOrAfter(candles, 999)).toBe(2)
    expect(replayCursorIndexAtOrAfter([], 100)).toBe(0)
  })

  it('loads a long history window behind the cursor', () => {
    const project = { from: 1_000_000, to: 9_000_000, timeframe: '1m' }
    const window = replayWindowRange(2_000_000, project)

    expect(REPLAY_HISTORY_CANDLES).toBe(500)
    expect(REPLAY_FORWARD_CANDLES).toBe(30)
    expect(REPLAY_WINDOW_LIMIT).toBe(531)
    expect(window.from).toBe(2_000_000 - (500 * 60))
    expect(window.to).toBe(2_000_000 + (30 * 60))
    expect(window.limit).toBe(531)
  })

  it('keeps the history window inside the project and dataframe bounds', () => {
    const project = { from: 1_000_000, to: 1_001_800, timeframe: '1m' }

    expect(replayWindowRange(30_000, project).from).toBe(0)
    expect(replayWindowRange(1_000_000, project).to).toBe(1_001_800)
  })

  it('counts replay progress from the project start instead of the loaded history', () => {
    const candles = [{ timestamp: 100 }, { timestamp: 200 }, { timestamp: 360 }]
    const project = { from: 200, cursorIndex: 1 } as ReplayProject

    expect(replayProgressLabel(project, [])).toBe('0 / 0')
    expect(replayProgressLabel(project, candles)).toBe('1 / 2')
    expect(replayProgressLabel({ ...project, cursorIndex: 2 }, candles)).toBe('2 / 2')
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

  it('keeps trades, drawings and progress when the replay timeframe changes', () => {
    const project = createReplayProjectFromDraft({
      name: 'BTCUSD 1m Replay',
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
    const traded = applyManualTrade({ ...project, drawings: [drawing] }, {
      side: 'buy',
      candleIndex: 3,
      timestamp: project.from + 180,
      price: 100,
    })

    const switched = createReplayProjectFromDraft({
      ...draftFromProject(traded),
      name: 'BTCUSD 5m Replay',
      timeframe: '5m',
    }, traded)

    expect(switched).toMatchObject({
      id: project.id,
      timeframe: '5m',
      cursorTimestamp: project.from + 180,
      createdAt: traded.createdAt,
    })
    expect(switched.trades).toHaveLength(1)
    expect(switched.drawings).toEqual([drawing])

    const fiveMinuteCandles = Array.from({ length: 12 }, (_, index) => ({
      timestamp: project.from + index * 300,
    }))
    const reanchored = reanchorManualTrades(switched.trades, fiveMinuteCandles)

    expect(reanchored[0].candleIndex).toBe(0)
    expect(summarizeManualTrades(reanchored, 100, 0)).toMatchObject({
      side: 'long',
      quantity: 1,
      averagePrice: 100,
    })
  })

  it('re-anchors manual trades onto the loaded candle window by timestamp', () => {
    const candles = [{ timestamp: 1_000 }, { timestamp: 1_060 }, { timestamp: 1_120 }]
    const createTrade = (overrides: Partial<ManualTrade>): ManualTrade => ({
      id: 'trade-1',
      candleIndex: 0,
      timestamp: 1_000,
      side: 'buy',
      action: 'open-long',
      price: 100,
      quantity: 1,
      realizedPnl: null,
      createdAt: '2026-08-27T00:00:00.000Z',
      ...overrides,
    })
    const beforeWindow = createTrade({ id: 'before-window', candleIndex: 5, timestamp: 1_040 })
    const insideWindow = createTrade({ id: 'inside-window', candleIndex: 9, timestamp: 1_120 })
    const afterWindow = createTrade({ id: 'after-window', candleIndex: 1, timestamp: 1_300 })

    const reanchored = reanchorManualTrades([beforeWindow, insideWindow, afterWindow], candles)

    expect(reanchored.map((trade) => trade.candleIndex)).toEqual([0, 2, 3])
    expect(reanchored.map((trade) => trade.id)).toEqual(['before-window', 'inside-window', 'after-window'])
    expect(reanchorManualTrades([], candles)).toEqual([])

    const stable = [createTrade({ candleIndex: 0, timestamp: 1_000 })]
    expect(reanchorManualTrades(stable, candles)).toBe(stable)
  })
})

describe('replay multi-timeframe panes', () => {
  it('keeps the project timeframe as the primary pane and defaults old projects to one pane', () => {
    expect(normalizeReplayPanes(undefined, '1h')).toEqual(['1h'])
    expect(normalizeReplayPanes([], '5m')).toEqual(['5m'])
    expect(normalizeReplayPanes('1h', '5m')).toEqual(['5m'])
  })

  it('deduplicates panes, drops unknown timeframes, and caps the layout at four panes', () => {
    expect(normalizeReplayPanes(['15m', '1h', '15m', 'bogus', '1d', '4h'], '1h'))
      .toEqual(['1h', '15m', '1d', '4h'])
    expect(normalizeReplayPanes(['1h', '5m', '15m', '30m', '1d'], '1h'))
      .toEqual(['1h', '5m', '15m', '30m'])
  })

  it('picks the next unused default pane timeframe', () => {
    expect(nextReplayPaneTimeframe(['1h'])).toBe('5m')
    expect(nextReplayPaneTimeframe(['1h', '5m', '15m', '30m'])).toBe('4h')
    expect(nextReplayPaneTimeframe(REPLAY_TIMEFRAMES)).toBe('1m')
    expect(withReplayPaneTimeframe(['1h', '5m'], 1, '4h')).toEqual(['1h', '4h'])
    expect(withReplayPaneTimeframe(['1h', '5m'], 1, '1h')).toEqual(['5m', '1h'])
    expect(withReplayPaneTimeframe(['1h', '5m'], 1, 'bogus')).toEqual(['1h', '5m'])
    expect(withReplayPaneTimeframe(['1h', '5m'], 0, '4h')).toEqual(['1h', '5m'])
  })

  it('loads each pane with its own timeframe around the shared cursor', () => {
    const project = { from: 1_000_000, to: 9_000_000 }
    const window = replayPaneWindow(2_000_000, project, '5m')

    expect(REPLAY_PANE_HISTORY_CANDLES).toBe(500)
    expect(REPLAY_PANE_FORWARD_CANDLES).toBe(500)
    expect(REPLAY_PANE_WINDOW_LIMIT).toBe(1001)
    expect(window.from).toBe(2_000_000 - (500 * 300))
    expect(window.to).toBe(2_000_000 + (500 * 300))
    expect(window.limit).toBe(1001)
    expect(replayPaneWindow(30_000, project, '5m').from).toBe(0)
    expect(replayPaneWindow(8_999_000, project, '5m').to).toBe(9_000_000)
  })

  it('reloads a pane only when the cursor leaves its loaded candles', () => {
    const candles = [{ timestamp: 100 }, { timestamp: 200 }, { timestamp: 300 }]

    expect(replayPaneNeedsReload([], 100)).toBe(true)
    expect(replayPaneNeedsReload(candles, 99)).toBe(true)
    expect(replayPaneNeedsReload(candles, 100)).toBe(false)
    expect(replayPaneNeedsReload(candles, 250)).toBe(false)
    expect(replayPaneNeedsReload(candles, 300)).toBe(false)
    expect(replayPaneNeedsReload(candles, 301)).toBe(true)
  })

  it('keeps the split layout when the primary timeframe changes', () => {
    const project = {
      ...createReplayProjectFromDraft({
        name: 'Pane replay',
        symbol: 'BTCUSD',
        timeframe: '1h',
        fromInput: '2026-08-27T00:00',
        toInput: '2026-08-27T06:00',
        speed: 1,
      }),
      panes: ['1h', '15m'],
    }

    const switched = createReplayProjectFromDraft(
      { ...draftFromProject(project), timeframe: '4h' },
      project,
    )
    expect(switched.panes).toEqual(['4h', '15m'])

    const collapsed = createReplayProjectFromDraft(
      { ...draftFromProject(project), timeframe: '15m' },
      project,
    )
    expect(collapsed.panes).toEqual(['15m'])
  })

  it('persists panes with the project and normalizes stored projects', () => {
    const storage = createMemoryStorage()
    const project = createReplayProjectFromDraft({
      name: 'Pane replay',
      symbol: 'BTCUSD',
      timeframe: '1h',
      fromInput: '2026-08-27T00:00',
      toInput: '2026-08-27T06:00',
      speed: 1,
    })

    expect(project.panes).toEqual(['1h'])
    saveReplayProjects([{ ...project, panes: ['1h', '15m'] }], storage)
    expect(loadReplayProjects(storage).map((stored) => stored.panes)).toEqual([['1h', '15m']])

    saveReplayProjects([{ ...project, panes: ['1h', '1h', 'bogus'] }], storage)
    expect(loadReplayProjects(storage).map((stored) => stored.panes)).toEqual([['1h']])

    storage.setItem('btcusd.replay.projects.v2', JSON.stringify([{ ...project, panes: undefined }]))
    expect(loadReplayProjects(storage).map((stored) => stored.panes)).toEqual([['1h']])
  })
})
