import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { mount, type VueWrapper } from '@vue/test-utils'
import { nextTick } from 'vue'
import MarketChart from './MarketChart.vue'
import ChartLoadState from './ChartLoadState.vue'
import { calculateStoch, defaultStochSetting, stochVisibilityKey } from '../stoch'
import { DEFAULT_REPLAY_DRAWING_STYLE, type PositionReplayDrawing, type ReplayDrawing } from '../replay'
import type { Candle, MarketSnapshot } from '../types'

const mocks = vi.hoisted(() => ({
  controllers: [] as any[],
  engines: [] as any[],
  indicators: [] as any[],
  disconnect: vi.fn(),
  observe: vi.fn(),
}))
vi.mock('@getcandlekit/charts', () => {
  class ChartController {
    bars: unknown[] = []
    range: { from: number; to: number } | null = null
    series = { attachPrimitive: vi.fn(), detachPrimitive: vi.fn(), applyOptions: vi.fn(), setData: vi.fn() }
    lines: any[] = []
    scale = {
      getVisibleLogicalRange: () => this.range,
      setVisibleLogicalRange: vi.fn((range) => { this.range = range }),
      subscribeVisibleLogicalRangeChange: vi.fn(), unsubscribeVisibleLogicalRangeChange: vi.fn(),
    }
    priceScaleOptions = { autoScale: true }
    panesList: any[] = [{ setHeight: vi.fn(), moveTo: vi.fn(), paneIndex: () => 0, setStretchFactor: vi.fn() }]
    priceScale = {
      options: () => this.priceScaleOptions,
      applyOptions: vi.fn((options) => { Object.assign(this.priceScaleOptions, options) }),
    }
    chart = {
      options: () => ({ handleScroll: { pressedMouseMove: true }, handleScale: { mouseWheel: true } }),
      priceScale: () => this.priceScale,
      timeScale: () => this.scale, applyOptions: vi.fn(), removeSeries: vi.fn(),
      addSeries: vi.fn(() => {
        const line = { setData: vi.fn(), createPriceLine: vi.fn() }
        this.lines.push(line)
        return line
      }),
      panes: () => this.panesList,
      addPane: vi.fn(() => {
        const pane: any = {
          setHeight: vi.fn(),
          setStretchFactor: vi.fn(),
          paneIndex: () => this.panesList.indexOf(pane),
          moveTo: vi.fn((index: number) => {
            const current = this.panesList.indexOf(pane)
            if (current < 0 || index < 0 || index >= this.panesList.length) return
            this.panesList.splice(current, 1)
            this.panesList.splice(index, 0, pane)
          }),
        }
        this.panesList.push(pane)
        return pane
      }),
      removePane: vi.fn((index: number) => { this.panesList.splice(index, 1) }),
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
    listener: (() => void) | undefined
    selectedId: string | null = null
    locked = false
    unsubscribe = vi.fn()
    setDefaultStyle = vi.fn()
    import = vi.fn((json: string) => { this.drawings = JSON.parse(json) })
    cancelDraft = vi.fn(() => { this.tool = null })
    stopTool = vi.fn(() => { this.tool = null })
    select = vi.fn()
    getDraft = () => null
    getDrawings = () => this.drawings
    onChange = vi.fn((listener: () => void) => { this.listener = listener; return this.unsubscribe })
    getActiveTool = () => this.tool
    startTool = vi.fn((tool) => { this.tool = tool; this.listener?.() })
    isLocked = () => this.locked
    setLocked = (locked: boolean) => { this.locked = locked; if (locked) this.selectedId = null; this.listener?.() }
    getSelectedId = () => this.selectedId
    setStyle = (id: string, style: unknown) => { const drawing = this.drawings.find(item => item.id === id); if (drawing) drawing.style = style; this.listener?.() }
    removeSelected = () => { this.drawings = this.drawings.filter(item => item.id !== this.selectedId); this.selectedId = null; this.listener?.() }
    removeAll = () => { this.drawings = []; this.selectedId = null; this.listener?.() }
    constructor() { mocks.engines.push(this) }
  }
  class IndicatorRegistry {
    definitions = new Map<string, any>()
    registerAll(definitions: any[]) {
      for (const definition of definitions) this.definitions.set(definition.name, definition)
      return this
    }
    get(name: string) { return this.definitions.get(name) }
    byCategory() {
      const groups: Record<string, any[]> = { overlay: [], oscillator: [], pattern: [] }
      for (const definition of this.definitions.values()) (groups[definition.category] ??= []).push(definition)
      return groups
    }
  }
  class IndicatorController {
    registry: InstanceType<typeof IndicatorRegistry>
    active = new Map<string, any>()
    constructor(registry: InstanceType<typeof IndicatorRegistry>) {
      this.registry = registry
      mocks.indicators.push(this)
    }
    add(name: string, params: Record<string, unknown> = {}) {
      const defaults = this.registry.get(name)?.defaultInputs ?? {}
      this.active.set(name, { name, params: { ...defaults, ...params } })
      return this
    }
    remove(name: string) { this.active.delete(name); return this }
    toggle(name: string) {
      if (this.active.has(name)) this.remove(name)
      else this.add(name)
      return this
    }
    clear() { this.active.clear(); return this }
    activeNames() { return [...this.active.keys()] }
    getActive(name: string) { return this.active.get(name) }
  }
  const BUILTIN_INDICATORS = [
    {
      name: 'SMA', title: 'Simple Moving Average', shortTitle: 'SMA', category: 'overlay',
      defaultInputs: { length: 20 }, inputConfig: [{ name: 'length', type: 'int', defval: 20, title: 'Length' }],
      plotConfig: [], hlineConfig: [], calculate: () => ({ plots: {} }),
    },
    {
      name: 'RSI', title: 'Relative Strength Index', shortTitle: 'RSI', category: 'oscillator',
      defaultInputs: { length: 14 }, inputConfig: [{ name: 'length', type: 'int', defval: 14, title: 'Length' }],
      plotConfig: [], hlineConfig: [], calculate: () => ({ plots: {} }),
    },
  ]
  return {
    ChartController,
    DrawingEngine,
    DrawingController: class {},
    MeasurementController: class { clear() {} },
    IndicatorRegistry,
    IndicatorController,
    BUILTIN_INDICATORS,
  }
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
  mocks.controllers.length = mocks.engines.length = mocks.indicators.length = 0
  vi.clearAllMocks()
  vi.stubGlobal('ResizeObserver', class {
    observe = mocks.observe
    disconnect = mocks.disconnect
  })
})
afterEach(() => { wrapper?.unmount(); wrapper = undefined; vi.unstubAllGlobals() })

describe('chart lifecycle and data contracts', () => {
  it('covers the first render until a sized chart has passed its paint frames and keeps it visible during refresh', async () => {
    const frames = new Map<number, FrameRequestCallback>()
    let frameId = 0
    vi.stubGlobal('requestAnimationFrame', (callback: FrameRequestCallback) => { frames.set(++frameId, callback); return frameId })
    vi.stubGlobal('cancelAnimationFrame', (id: number) => frames.delete(id))
    const width = vi.spyOn(HTMLElement.prototype, 'clientWidth', 'get').mockReturnValue(640)
    const height = vi.spyOn(HTMLElement.prototype, 'clientHeight', 'get').mockReturnValue(420)
    const paint = async () => {
      const pending = [...frames.values()]
      frames.clear()
      pending.forEach(callback => callback(0))
      await nextTick()
    }
    try {
      wrapper = mount(MarketChart, { props: { snapshot: null, loading: true } })
      expect(wrapper.get('[aria-label="正在加载行情"]').text()).toContain('正在加载行情')
      await wrapper.setProps({ snapshot: snapshot(), loading: false })
      expect(wrapper.get('.chart-stage').attributes('aria-busy')).toBe('true')
      expect(wrapper.get('.chart-preparing-cover').text()).toContain('正在准备 K 线图表')
      await paint()
      expect(wrapper.find('.chart-preparing-cover').exists()).toBe(true)
      await paint()
      expect(wrapper.find('.chart-preparing-cover').exists()).toBe(false)
      expect(wrapper.get('.chart-stage').attributes('aria-busy')).toBe('false')
      expect(wrapper.classes()).not.toContain('chart-timeframe-enter')
      await wrapper.setProps({ loading: true })
      expect(wrapper.find('.chart-preparing-cover').exists()).toBe(false)
      expect(wrapper.find('.price-chart').exists()).toBe(true)
    } finally {
      width.mockRestore()
      height.mockRestore()
    }
  })

  it('keeps zero-size charts covered and cancels pending reveal work when unmounted', async () => {
    const cancel = vi.fn()
    const frames: FrameRequestCallback[] = []
    vi.stubGlobal('requestAnimationFrame', (callback: FrameRequestCallback) => { frames.push(callback); return frames.length })
    vi.stubGlobal('cancelAnimationFrame', cancel)
    wrapper = mount(MarketChart, { props: { snapshot: snapshot(), loading: false } })
    frames.shift()?.(0)
    frames.shift()?.(0)
    await nextTick()
    expect(wrapper.get('.chart-stage').attributes('aria-busy')).toBe('true')
    expect(wrapper.find('.chart-preparing-cover').exists()).toBe(true)
    await wrapper.setProps({ snapshot: snapshot([...candles]) })
    wrapper.unmount()
    wrapper = undefined
    expect(cancel).toHaveBeenCalled()
    frames.forEach(callback => callback(0))
    expect(mocks.controllers).toHaveLength(1)
  })

  it('shows a useful error panel instead of an empty chart after a failed initial load', async () => {
    wrapper = mount(MarketChart, { props: { snapshot: null, loading: false, error: '连接行情服务失败，请重试。' } })
    expect(wrapper.get('.chart-feedback').attributes('role')).toBe('alert')
    expect(wrapper.get('.chart-feedback').text()).toContain('连接行情服务失败，请重试。')
    expect(wrapper.find('.price-chart').exists()).toBe(false)
    expect(wrapper.find('.chart-skeleton').exists()).toBe(false)
  })

  it('toggles price autoscaling in bare panes without changing the visible time range and restores it on reset', async () => {
    wrapper = mount(MarketChart, { props: { snapshot: snapshot(), loading: false, showHeader: false } })
    const controller = mocks.controllers[0]
    controller.range = { from: -10, to: 20 }
    const toggle = wrapper.get('[data-testid="chart-auto-scale"]')
    expect(toggle.attributes('aria-pressed')).toBe('true')
    await toggle.trigger('click')
    expect(controller.priceScaleOptions.autoScale).toBe(false)
    expect(toggle.attributes('aria-pressed')).toBe('false')
    await wrapper.setProps({ playbackIndex: 1 })
    expect(controller.priceScaleOptions.autoScale).toBe(false)
    const range = { ...controller.range }
    await toggle.trigger('click')
    expect(controller.priceScaleOptions.autoScale).toBe(true)
    expect(controller.range).toEqual(range)
    await toggle.trigger('click')
    await wrapper.setProps({ showHeader: true })
    await wrapper.get('[aria-label="重置图表范围"]').trigger('click')
    expect(controller.priceScaleOptions.autoScale).toBe(true)
    expect(toggle.attributes('aria-pressed')).toBe('true')
  })

  it('reflects native price-axis scaling and double-click reset in the automatic toggle', async () => {
    let frame: FrameRequestCallback | undefined
    vi.stubGlobal('requestAnimationFrame', vi.fn((callback) => { frame = callback; return 1 }))
    vi.stubGlobal('cancelAnimationFrame', vi.fn())
    wrapper = mount(MarketChart, { props: { snapshot: snapshot(), loading: false } })
    const controller = mocks.controllers[0]
    controller.priceScaleOptions.autoScale = false
    await wrapper.get('.price-chart').trigger('pointerup')
    frame?.(0)
    await nextTick()
    expect(wrapper.get('.chart-auto-scale').attributes('aria-pressed')).toBe('false')
    controller.priceScaleOptions.autoScale = true
    await wrapper.get('.price-chart').trigger('dblclick')
    frame?.(0)
    await nextTick()
    expect(wrapper.get('.chart-auto-scale').attributes('aria-pressed')).toBe('true')
  })

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

describe('stochastic indicator visibility', () => {
  it('keeps each project choice separate and starts hidden when the project hides indicators', async () => {
    localStorage.setItem(stochVisibilityKey('hidden'), 'false')
    localStorage.setItem(stochVisibilityKey('shown'), 'true')

    wrapper = mount(MarketChart, { props: { snapshot: snapshot(), loading: false, projectId: 'hidden' } })
    expect(wrapper.get('.stoch-visibility-toggle:not(.chart-auto-scale)').text()).toBe('显示 Stoch')
    expect(mocks.controllers[0].chart.addSeries).not.toHaveBeenCalled()

    await wrapper.get('.stoch-visibility-toggle:not(.chart-auto-scale)').trigger('click')
    expect(localStorage.getItem(stochVisibilityKey('hidden'))).toBe('true')
    expect(localStorage.getItem(stochVisibilityKey('shown'))).toBe('true')

    wrapper.unmount()
    wrapper = mount(MarketChart, { props: { snapshot: snapshot(), loading: false, projectId: 'shown' } })
    expect(wrapper.get('.stoch-visibility-toggle:not(.chart-auto-scale)').text()).toBe('隐藏 Stoch')
    expect(mocks.controllers[1].chart.addSeries).toHaveBeenCalled()
  })
})

describe('classic indicator library', () => {
  it('hydrates the stored selection for the current timeframe and reports picker changes', async () => {
    wrapper = mount(MarketChart, {
      props: {
        snapshot: snapshot(), loading: false,
        indicators: { '1m': [{ name: 'SMA', params: { length: 50 } }] },
      },
    })
    const controller = mocks.indicators[0]
    expect(controller.activeNames()).toEqual(['SMA'])
    expect(controller.getActive('SMA').params).toEqual({ length: 50 })

    await wrapper.get('[data-testid="indicator-picker-trigger"]').trigger('click')
    const row = wrapper.findAll('.indicator-picker-item').find((item) => item.text().includes('RSI'))
    expect(row).toBeDefined()
    await row!.get('.indicator-picker-switch').trigger('click')

    expect(controller.activeNames()).toEqual(['SMA', 'RSI'])
    expect(wrapper.emitted('indicators-changed')?.at(-1)?.[0]).toEqual({
      timeframe: '1m',
      indicators: [
        { name: 'SMA', params: { length: 50 } },
        { name: 'RSI', params: { length: 14 } },
      ],
    })
  })

  it('reconciles external selection changes without emitting them back', async () => {
    wrapper = mount(MarketChart, {
      props: {
        snapshot: snapshot(), loading: false,
        indicators: { '1m': [{ name: 'SMA', params: { length: 20 } }] },
      },
    })
    const controller = mocks.indicators[0]
    await wrapper.setProps({ indicators: { '1m': [{ name: 'RSI', params: { length: 7 } }] } })

    expect(controller.activeNames()).toEqual(['RSI'])
    expect(controller.getActive('RSI').params).toEqual({ length: 7 })
    expect(wrapper.emitted('indicators-changed')).toBeUndefined()
  })
})

it('provides accessible component loading and actionable import failure feedback', async () => {
  wrapper = mount(ChartLoadState)
  expect(wrapper.find('[role="status"]').text()).toContain('正在加载图表组件')
  await wrapper.setProps({ error: new Error('chunk offline') })
  expect(wrapper.find('[role="alert"]').text()).toContain('图表组件加载失败')
  expect(wrapper.find('button').text()).toBe('刷新重试')
})

const planned: PositionReplayDrawing = {
  id: 'position', tool: 'LongPosition', points: [], startTimestamp: candles[0].timestamp,
  endTimestamp: candles[2].timestamp, entryPrice: 10, stopPrice: 9, targetPrice: 12,
  style: { ...DEFAULT_REPLAY_DRAWING_STYLE },
}

describe('drawing controller integration', () => {
  it('batches native pointer updates into one merged save on release', async () => {
    wrapper = mount(MarketChart, { attachTo: document.body, props: { snapshot: snapshot(), loading: false, drawings: [drawing, planned] } })
    const engine = mocks.engines[0]
    engine.startTool('TrendLine')
    wrapper.get('.price-chart').element.dispatchEvent(new MouseEvent('pointerdown', { button: 0, bubbles: true }))
    engine.drawings[0].points[0].price = 13; engine.listener()
    engine.drawings[0].points[0].price = 14; engine.listener()
    expect(wrapper.emitted('drawings-changed')).toBeUndefined()
    window.dispatchEvent(new MouseEvent('mouseup'))
    await nextTick(); await Promise.resolve()
    const saves = wrapper.emitted('drawings-changed')!
    expect(saves).toHaveLength(1)
    const saved = saves[0][0] as ReplayDrawing[]
    expect(saved[0].points[0].price).toBe(14)
    expect(saved[1]).toEqual(planned)
  })
  it('imports only native IDs into CandleKit and retains positions on a native save', async () => {
    wrapper = mount(MarketChart, { props: { snapshot: snapshot(), loading: false, drawings: [drawing, planned] } })
    const engine = mocks.engines[0]
    expect(engine.drawings.map((item: any) => item.tool)).toEqual(['TrendLine'])
    engine.drawings[0].points[0].price = 15
    engine.listener()
    await nextTick()
    const saved = wrapper.emitted('drawings-changed')!.at(-1)![0] as ReplayDrawing[]
    expect(saved).toHaveLength(2)
    expect(saved[0].points[0].price).toBe(15)
    expect(saved[1]).toEqual(planned)
    await wrapper.setProps({ drawings: saved })
    expect(mocks.controllers).toHaveLength(1)
  })
  it('styles and deletes custom selections without changing the native object or earlier snapshots', async () => {
    wrapper = mount(MarketChart, { props: { snapshot: snapshot(), loading: false, drawings: [drawing, planned] } })
    const plugin = mocks.controllers[0].series.attachPrimitive.mock.calls[0][0]
    plugin.selectedId = 'position'; mocks.engines[0].listener(); await nextTick()
    await wrapper.get('[data-testid="drawing-width-trigger"]').trigger('click')
    await wrapper.get('[data-testid="drawing-width"]').setValue('4')
    const saves = wrapper.emitted('drawings-changed')!
    const styled = saves.at(-1)![0] as ReplayDrawing[]
    expect(styled[0].style).toEqual(DEFAULT_REPLAY_DRAWING_STYLE)
    expect(styled[1].style.width).toBe(4)
    expect(planned.style.width).toBe(2)
    await wrapper.get('[data-testid="drawing-delete"]').trigger('click')
    expect(wrapper.emitted('drawings-changed')!.at(-1)![0]).toEqual([drawing])
    expect(styled[1].style.width).toBe(4)
  })
  it('styles a selected native drawing through the floating style bar', async () => {
    wrapper = mount(MarketChart, { props: { snapshot: snapshot(), loading: false, drawings: [drawing, planned] } })
    const engine = mocks.engines[0]
    engine.selectedId = 'drawing'; engine.listener(); await nextTick()
    expect(wrapper.find('[data-testid="drawing-style-bar"]').exists()).toBe(true)
    await wrapper.get('[data-testid="drawing-color-trigger"]').trigger('click')
    await wrapper.get('[data-color="#38bdf8"]').trigger('click')

    expect(engine.drawings[0].style.color).toBe('#38bdf8')
    const saved = wrapper.emitted('drawings-changed')!.at(-1)![0] as ReplayDrawing[]
    expect(saved.find((item) => item.id === 'drawing')!.style.color).toBe('#38bdf8')
    expect(planned.style.color).toBe(DEFAULT_REPLAY_DRAWING_STYLE.color)
  })

  it('edits the default style while nothing is selected', async () => {
    wrapper = mount(MarketChart, { props: { snapshot: snapshot(), loading: false, drawings: [drawing] } })
    const engine = mocks.engines[0]
    await wrapper.get('[data-testid="drawing-style-toggle"]').trigger('click')
    await wrapper.get('[data-testid="drawing-width-trigger"]').trigger('click')
    await wrapper.get('[data-testid="drawing-width"]').setValue('6')

    expect(engine.setDefaultStyle).toHaveBeenLastCalledWith(expect.objectContaining({ width: 6 }))
    expect(JSON.parse(localStorage.getItem('btcusd.drawing.style.v1') ?? '{}').width).toBe(6)
  })

  it('remembers recent colors without duplicates', async () => {
    wrapper = mount(MarketChart, { props: { snapshot: snapshot(), loading: false, drawings: [drawing] } })
    const engine = mocks.engines[0]
    engine.selectedId = 'drawing'; engine.listener(); await nextTick()
    await wrapper.get('[data-testid="drawing-color-trigger"]').trigger('click')
    await wrapper.get('[data-color="#38bdf8"]').trigger('click')
    await wrapper.get('[data-color="#38bdf8"]').trigger('click')
    await wrapper.get('[data-color="#ffffff"]').trigger('click')

    expect(JSON.parse(localStorage.getItem('btcusd.drawing.recentColors.v1') ?? '[]')).toEqual(['#ffffff', '#38bdf8'])
    expect(wrapper.findAll('.recent-grid button')).toHaveLength(2)
  })

  it('disables the floating bar while drawings are locked', async () => {
    wrapper = mount(MarketChart, { props: { snapshot: snapshot(), loading: false, drawings: [drawing] } })
    const engine = mocks.engines[0]
    await wrapper.get('[data-testid="drawing-style-toggle"]').trigger('click')
    engine.setLocked(true); await nextTick()

    expect(wrapper.get('[data-testid="drawing-color-trigger"]').attributes('disabled')).toBeDefined()
    expect(wrapper.get('[data-testid="drawing-width-trigger"]').attributes('disabled')).toBeDefined()
    expect(wrapper.get('[data-testid="drawing-delete-selected"]').attributes('disabled')).toBeDefined()
  })

  it('closes the color panel on Escape without clearing the selection', async () => {
    wrapper = mount(MarketChart, { props: { snapshot: snapshot(), loading: false, drawings: [drawing] } })
    const engine = mocks.engines[0]
    engine.selectedId = 'drawing'; engine.listener(); await nextTick()
    await wrapper.get('[data-testid="drawing-color-trigger"]').trigger('click')

    const hex = wrapper.get('[data-testid="drawing-color"]')
    hex.element.dispatchEvent(new KeyboardEvent('keydown', { key: 'Escape', bubbles: true }))
    await nextTick()

    expect(wrapper.find('[data-testid="drawing-color"]').exists()).toBe(false)
    expect(engine.selectedId).toBe('drawing')
  })

  it('overlays the style bar without reserving chart height', async () => {
    wrapper = mount(MarketChart, { props: { snapshot: snapshot(), loading: false, drawings: [drawing] } })
    const engine = mocks.engines[0]
    engine.selectedId = 'drawing'; engine.listener(); await nextTick()

    expect(wrapper.get('.chart-stage').classes()).not.toContain('chart-stage-properties')
    expect(wrapper.find('.drawing-style-bar').exists()).toBe(true)
  })

  it('clears both controllers in a single confirmed save and preserves both on cancellation', async () => {
    wrapper = mount(MarketChart, { props: { snapshot: snapshot(), loading: false, drawings: [drawing, planned] } })
    const confirm = vi.spyOn(window, 'confirm').mockReturnValue(false)
    await wrapper.get('[data-testid="drawing-more"]').trigger('click')
    await wrapper.get('[data-testid="drawing-clear"]').trigger('click')
    expect(wrapper.emitted('drawings-changed')).toBeUndefined()
    confirm.mockReturnValue(true)
    await wrapper.get('[data-testid="drawing-more"]').trigger('click')
    await wrapper.get('[data-testid="drawing-clear"]').trigger('click')
    expect(wrapper.emitted('drawings-changed')).toEqual([[[]]])
    confirm.mockRestore()
  })
  it('opens grouped menus, restores focus with Escape, and cancels custom creation', async () => {
    wrapper = mount(MarketChart, { attachTo: document.body, props: { snapshot: snapshot(), loading: false } })
    const expand = wrapper.get('[data-testid="drawing-expand-LongPosition"]')
    await expand.trigger('click'); await nextTick()
    expect(wrapper.get('[data-testid="drawing-tool-LongPosition"]').text()).toContain('多头规划')
    await wrapper.get('[role="menu"]').trigger('keydown', { key: 'Escape' })
    expect(wrapper.find('[role="menu"]').exists()).toBe(false)
    expect(document.activeElement).toBe(expand.element)
    await expand.trigger('click')
    await wrapper.get('[data-testid="drawing-tool-LongPosition"]').trigger('click')
    expect(wrapper.get('[data-testid="drawing-tool-cursor"]').classes()).not.toContain('active')
    window.dispatchEvent(new KeyboardEvent('keydown', { key: 'Escape' }))
    await nextTick()
    expect(wrapper.get('[data-testid="drawing-tool-cursor"]').classes()).toContain('active')
    expect(wrapper.emitted('drawings-changed')).toBeUndefined()
  })
})
