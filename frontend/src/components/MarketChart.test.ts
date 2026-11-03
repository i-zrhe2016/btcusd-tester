import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { mount, type VueWrapper } from '@vue/test-utils'
import { nextTick } from 'vue'
import MarketChart from './MarketChart.vue'
import ChartLoadState from './ChartLoadState.vue'
import { calculateStoch, defaultStochSetting } from '../stoch'
import { DEFAULT_REPLAY_DRAWING_STYLE, type ReplayDrawing } from '../replay'
import type { Candle, MarketSnapshot } from '../types'

const mocks = vi.hoisted(() => ({ controllers: [] as any[], engines: [] as any[], disconnect: vi.fn(), observe: vi.fn() }))
vi.mock('@getcandlekit/charts', () => {
  class ChartController {
    bars: unknown[] = []
    range: { from: number; to: number } | null = null
    series = { applyOptions: vi.fn(), setData: vi.fn() }
    lines: any[] = []
    scale = {
      getVisibleLogicalRange: () => this.range,
      setVisibleLogicalRange: vi.fn((range) => { this.range = range }),
      subscribeVisibleLogicalRangeChange: vi.fn(), unsubscribeVisibleLogicalRangeChange: vi.fn(),
    }
    chart = {
      timeScale: () => this.scale, applyOptions: vi.fn(), removeSeries: vi.fn(),
      addSeries: vi.fn(() => {
        const line = { setData: vi.fn(), createPriceLine: vi.fn() }
        this.lines.push(line)
        return line
      }),
      panes: () => [{ setStretchFactor: vi.fn() }, { setStretchFactor: vi.fn() }],
    }
    setData = vi.fn((bars) => { this.bars = bars })
    getBars = () => this.bars
    getChart = () => this.chart
    getSeries = () => this.series
    use = vi.fn()
    destroy = vi.fn()
    constructor() { mocks.controllers.push(this) }
  }
  class DrawingEngine {
    drawings: any[] = []
    tool: string | null = null
    unsubscribe = vi.fn()
    setDefaultStyle = vi.fn()
    import = vi.fn((json: string) => { this.drawings = JSON.parse(json) })
    getDrawings = () => this.drawings
    onChange = vi.fn(() => this.unsubscribe)
    getActiveTool = () => this.tool
    startTool = vi.fn((tool) => { this.tool = tool })
    isLocked = () => false
    getSelectedId = () => null
    constructor() { mocks.engines.push(this) }
  }
  return { ChartController, DrawingEngine, DrawingController: class {}, MeasurementController: class {} }
})
const markers = vi.hoisted(() => ({ setMarkers: vi.fn() }))
vi.mock('lightweight-charts', () => ({
  ColorType: { Solid: 'solid' }, LineStyle: { Solid: 0 }, LineSeries: {},
  createSeriesMarkers: vi.fn(() => markers),
}))
function candle(timestamp: number, close = 11): Candle {
  return { timestamp, open: 10, high: 12, low: 9, close, volume: 1 }
}
const candles = [candle(1_700_000_040), candle(1_700_000_100), candle(1_700_000_160)]
function snapshot(rows = candles): MarketSnapshot {
  return { symbol: 'BTCUSD', timeframe: '1m', source: 'test', candles: rows }
}
const drawing: ReplayDrawing = {
  id: 'drawing', tool: 'TrendLine', points: [{ timestamp: candles[0].timestamp, price: 10 }, { timestamp: candles[1].timestamp, price: 11 }],
  style: { ...DEFAULT_REPLAY_DRAWING_STYLE },
}
let wrapper: VueWrapper | undefined
beforeEach(() => {
  localStorage.clear()
  mocks.controllers.length = mocks.engines.length = 0
  vi.clearAllMocks()
  vi.stubGlobal('ResizeObserver', class {
    observe = mocks.observe
    disconnect = mocks.disconnect
  })
})
afterEach(() => { wrapper?.unmount(); wrapper = undefined; vi.unstubAllGlobals() })

describe('chart lifecycle and data contracts', () => {
  it('keeps the live chart container attached across repeated background loading and failed refreshes', async () => {
    wrapper = mount(MarketChart, { props: { snapshot: snapshot(), loading: false } })
    await nextTick()
    const container = wrapper.get('.price-chart').element
    const controller = mocks.controllers[0]
    controller.range = { from: -20, to: 40 }
    for (let cycle = 0; cycle < 3; cycle += 1) {
      await wrapper.setProps({ loading: true })
      expect(wrapper.get('.price-chart').element).toBe(container)
      expect(wrapper.element.contains(container)).toBe(true)
      // A failed refresh leaves the old snapshot; a successful one replaces it.
      await wrapper.setProps({ loading: false, ...(cycle === 1 ? {} : { snapshot: snapshot([...candles]) }) })
      expect(wrapper.get('.price-chart').element).toBe(container)
      expect(controller.range).toEqual({ from: -20, to: 40 })
    }
    expect(mocks.controllers).toHaveLength(1)
    expect(controller.destroy).not.toHaveBeenCalled()
  })

  it('waits for initial loading to finish before attaching a chart', async () => {
    wrapper = mount(MarketChart, { props: { snapshot: null, loading: true } })
    expect(wrapper.find('.price-chart').exists()).toBe(false)
    expect(wrapper.find('[aria-label="正在加载行情"]').exists()).toBe(true)
    await wrapper.setProps({ snapshot: snapshot(), loading: false })
    expect(wrapper.find('.price-chart').exists()).toBe(true)
    expect(mocks.controllers).toHaveLength(1)
  })
  it('creates once, reuses plugins on snapshot append, preserves zoom, drawings and future whitespace', async () => {
    wrapper = mount(MarketChart, { props: { snapshot: snapshot(), loading: false, playbackIndex: 0, drawings: [drawing] } })
    await nextTick()
    expect(mocks.controllers).toHaveLength(1)
    const controller = mocks.controllers[0]
    const engine = mocks.engines[0]
    expect(controller.setData.mock.lastCall[0]).toEqual([{ ts: candles[0].timestamp * 1000, open: 10, high: 12, low: 9, close: 11, volume: 1 }])
    const firstData = controller.series.setData.mock.lastCall[0]
    expect(firstData[0]).toEqual({ time: candles[0].timestamp, open: 10, high: 12, low: 9, close: 11 })
    expect(firstData.slice(1).every((row: object) => Object.keys(row).join() === 'time')).toBe(true)
    expect(firstData[1].time).toBe(candles[0].timestamp + 60)
    controller.range = { from: -20, to: 40 }
    // Appending unplayed candles must retain the visible range and existing drawing engine.
    await wrapper.setProps({ snapshot: snapshot([...candles, candle(1_700_000_220)]) })
    expect(mocks.controllers).toHaveLength(1)
    expect(controller.destroy).not.toHaveBeenCalled()
    expect(controller.range).toEqual({ from: -20, to: 40 })
    expect(engine.import).toHaveBeenCalledTimes(1)
    expect(engine.drawings[0].id).toBe('drawing')
    // Moving the cursor follows by one bar without changing zoom width.
    await wrapper.setProps({ playbackIndex: 1 })
    expect(controller.range).toEqual({ from: -19, to: 41 })
    expect(controller.getBars()).toHaveLength(2)
    expect(controller.series.setData.mock.lastCall[0][2]).toEqual({ time: candles[2].timestamp })
    const changed = { ...drawing, points: [{ timestamp: candles[0].timestamp, price: 20 }, drawing.points[1]] }
    await wrapper.setProps({ drawings: [changed] })
    expect(engine.drawings[0].points[0].price).toBe(20)
    wrapper.unmount()
    wrapper = undefined
    expect(controller.destroy).toHaveBeenCalledTimes(1)
    expect(engine.unsubscribe).toHaveBeenCalledTimes(1)
    expect(mocks.disconnect).toHaveBeenCalledTimes(1)
    expect(controller.scale.unsubscribeVisibleLogicalRangeChange).toHaveBeenCalledTimes(1)
  })

  it('updates markers and stochastic from played candles only when snapshot and cursor change together', async () => {
    wrapper = mount(MarketChart, { props: { snapshot: snapshot(), loading: false, playbackIndex: 0 } })
    const controller = mocks.controllers[0]
    const before = controller.setData.mock.calls.length
    const trade = { id: 'trade', candleIndex: 1, timestamp: candles[1].timestamp, side: 'buy' as const, action: 'open-long' as const, price: 11, quantity: 1, realizedPnl: null, createdAt: '' }
    await wrapper.setProps({ snapshot: snapshot([...candles, candle(1_700_000_220)]), playbackIndex: 1, manualTrades: [trade, { ...trade, id: 'future', timestamp: candles[2].timestamp }] })
    expect(controller.setData).toHaveBeenCalledTimes(before + 1)
    expect(markers.setMarkers.mock.lastCall![0]).toMatchObject([{ id: 'trade', time: candles[1].timestamp }])
    expect(markers.setMarkers.mock.lastCall![0]).toHaveLength(1)
    // The numerical algorithm stays unchanged; the component supplies only the played prefix.
    const setting = defaultStochSetting('1m')
    const expected = calculateStoch(candles.slice(0, 2), setting.lengths.slice(0, setting.groups))
    const lineData = controller.lines[0].setData.mock.lastCall[0]
    expect(lineData).toEqual(expected.map((point) => point.k1 === null
      ? { time: point.timestamp }
      : { time: point.timestamp, value: point.k1 }))
    expect(lineData.at(-1).time).toBe(candles[1].timestamp)
  })

  it('handles empty/loading to data without creating after unmount', async () => {
    wrapper = mount(MarketChart, { props: { snapshot: null, loading: true } })
    expect(wrapper.find('[aria-label="正在加载行情"]').exists()).toBe(true)
    expect(mocks.controllers).toHaveLength(0)
    await wrapper.setProps({ snapshot: snapshot(), loading: false })
    expect(mocks.controllers).toHaveLength(1)
    await wrapper.setProps({ snapshot: snapshot([]) })
    expect(wrapper.text()).toContain('当前时间范围没有行情数据')
    expect(mocks.controllers[0].destroy).toHaveBeenCalledTimes(1)
    const update = wrapper.setProps({ snapshot: snapshot() })
    wrapper.unmount()
    wrapper = undefined
    await update
    await nextTick()
    expect(mocks.controllers).toHaveLength(1)
  })

  it('keeps partial secondary candles and clips all future prices', async () => {
    const partial = candle(candles[1].timestamp, 10.5)
    wrapper = mount(MarketChart, { props: { snapshot: snapshot(), loading: false, clockLimited: true, formingBucket: candles[1].timestamp, formingCandle: partial } })
    const controller = mocks.controllers[0]
    expect(controller.getBars().map((bar: any) => bar.ts)).toEqual(candles.slice(0, 2).map((row) => row.timestamp * 1000))
    expect(controller.getBars().at(-1).close).toBe(10.5)
    expect(controller.series.setData.mock.lastCall[0][2]).toEqual({ time: candles[2].timestamp })
  })
})

it('provides accessible component loading and actionable import failure feedback', async () => {
  wrapper = mount(ChartLoadState)
  expect(wrapper.find('[role="status"]').text()).toContain('正在加载图表组件')
  await wrapper.setProps({ error: new Error('chunk offline') })
  expect(wrapper.find('[role="alert"]').text()).toContain('图表组件加载失败')
  expect(wrapper.find('button').text()).toBe('刷新重试')
})
