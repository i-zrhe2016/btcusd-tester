import { mount, flushPromises } from '@vue/test-utils'
import { beforeEach, describe, expect, it, vi } from 'vitest'
import type { MarketSnapshot } from '../types'
import MarketChart from './MarketChart.vue'

const charts = vi.hoisted(() => ({ instances: [] as any[] }))
vi.mock('@getcandlekit/charts', () => ({
  ChartController: class {
    bars: unknown[] = []
    rangeHandler: (() => void) | null = null
    range: { from: number; to: number } | null = null
    series = { attachPrimitive() {}, detachPrimitive() {}, applyOptions() {}, setData() {}, createPriceLine() {} }
    scale = {
      getVisibleLogicalRange: () => this.range,
      setVisibleLogicalRange: (range: { from: number; to: number }) => { this.range = range },
      subscribeVisibleLogicalRangeChange: (handler: () => void) => { this.rangeHandler = handler },
      unsubscribeVisibleLogicalRangeChange() {},
    }
    chart = {
      timeScale: () => this.scale,
      applyOptions() {},
      addSeries: () => this.series,
      removeSeries() {},
      panes: () => [],
    }
    constructor() { charts.instances.push(this) }
    getChart() { return this.chart }
    getSeries() { return this.series }
    getBars() { return this.bars }
    setData(bars: unknown[]) { this.bars = bars }
    use() {}
    destroy() {}
  },
  DrawingEngine: class {
    cancelDraft() {}
    getDrawings() { return [] }
    setDefaultStyle() {}
    import() {}
    onChange() { return () => {} }
    getActiveTool() { return null }
    isLocked() { return false }
    getSelectedId() { return null }
  },
  DrawingController: class {},
  MeasurementController: class {},
}))
vi.mock('lightweight-charts', async (importOriginal) => ({
  ...await importOriginal<typeof import('lightweight-charts')>(),
  createSeriesMarkers: () => ({ setMarkers() {} }),
}))

function snapshot(count: number): MarketSnapshot {
  return {
    symbol: 'BTCUSD', timeframe: '1m', source: 'test',
    candles: Array.from({ length: count }, (_, index) => ({
      timestamp: 1700000000 + index * 60,
      open: 100, high: 102, low: 99, close: 101, volume: 1,
    })),
  }
}
const current = () => charts.instances.at(-1)!

beforeEach(() => { charts.instances.length = 0 })

describe('replay viewport', () => {
  it('requests history only near the left edge and preserves the visible timestamps after prepending', async () => {
    const full = snapshot(700)
    const wrapper = mount(MarketChart, { props: {
      snapshot: { ...full, candles: full.candles.slice(500) }, loading: false,
      playbackIndex: 199, historyAvailable: true,
    } })
    await flushPromises()
    current().range = { from: 80, to: 180 }
    current().rangeHandler()
    expect(wrapper.emitted('load-history')).toBeUndefined()
    current().range = { from: 10, to: 110 }
    current().rangeHandler()
    expect(wrapper.emitted('load-history')).toHaveLength(1)
    await wrapper.setProps({ snapshot: full, playbackIndex: 699, historyAvailable: false })
    await flushPromises()
    expect(current().range).toEqual({ from: 510, to: 610 })
    expect(full.candles[510].timestamp).toBe(full.candles.slice(500)[10].timestamp)
    current().rangeHandler()
    expect(wrapper.emitted('load-history')).toHaveLength(1)
    wrapper.unmount()
  })

  it.each([{ from: 12.5, to: 72.5 }, { from: 80, to: 210 }])(
    'keeps panned and zoomed position across resume, prefetch and subsequent playback: %o',
    async (range) => {
      const wrapper = mount(MarketChart, { props: {
        snapshot: snapshot(200), loading: false, playbackIndex: 99,
      } })
      await flushPromises()
      current().range = { ...range }
      await wrapper.setProps({ playing: true })
      await flushPromises()
      expect(current().range).toEqual(range)
      await wrapper.setProps({ playbackIndex: 100 })
      await flushPromises()
      expect(current().range).toEqual({ from: range.from + 1, to: range.to + 1 })
      await wrapper.setProps({ snapshot: snapshot(300) })
      await flushPromises()
      expect(current().range).toEqual({ from: range.from + 1, to: range.to + 1 })
      await wrapper.setProps({ playbackIndex: 101 })
      await flushPromises()
      expect(current().range).toEqual({ from: range.from + 2, to: range.to + 2 })
      wrapper.unmount()
    },
  )

  it('preserves position when a secondary pane replaces its loaded window', async () => {
    const wrapper = mount(MarketChart, { props: {
      snapshot: snapshot(200), loading: false, clockLimited: true,
      formingBucket: 1700000000 + 100 * 60,
    } })
    await flushPromises()
    current().range = { from: 30, to: 150 }
    await wrapper.setProps({ snapshot: snapshot(300), formingBucket: 1700000000 + 103 * 60 })
    await flushPromises()
    expect(current().range).toEqual({ from: 33, to: 153 })
    wrapper.unmount()
  })
})
