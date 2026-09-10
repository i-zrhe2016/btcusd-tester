<script setup lang="ts">
import { computed, nextTick, onBeforeUnmount, onMounted, ref, watch, type Component } from 'vue'
import {
  ChartController,
  DrawingController,
  DrawingEngine,
  MeasurementController,
  type Bar,
  type ChartTheme,
  type Drawing as CandleKitDrawing,
  type DrawingPoint,
  type DrawingToolId,
  type MeasurementResult,
} from '@getcandlekit/charts'
import {
  ColorType,
  LineSeries,
  createSeriesMarkers,
  type CandlestickData,
  type IChartApi,
  type ISeriesMarkersPluginApi,
  type ISeriesApi,
  type SeriesMarker,
  type Time,
  type UTCTimestamp,
  type WhitespaceData,
} from 'lightweight-charts'
import {
  ArrowUpRight,
  Circle,
  GitBranch,
  Lock,
  Minus,
  MoveUpRight,
  MousePointer2,
  Ruler,
  RotateCcw,
  Square,
  Spline,
  Trash2,
  Triangle,
  Unlock,
  X,
  ZoomIn,
  ZoomOut,
} from '@lucide/vue'
import {
  DEFAULT_REPLAY_DRAWING_STYLE,
  REPLAY_DRAWING_TOOL_IDS,
  replayCursorIndexAtOrBefore,
  replayDrawingPointsNeeded,
  replayUnloadedTimestamps,
  type ManualTrade,
  type ReplayDrawing,
  type ReplayDrawingStyle,
  type ReplayDrawingTool,
} from '../replay'
import type { MarketSnapshot } from '../types'
import { formatUtc } from '../format'
import { calculateStoch, readStochSettings, STOCH_DEFAULTS, STOCH_STORAGE_KEY, validStochLength, type StochLengths } from '../stoch'

const props = withDefaults(defineProps<{
  snapshot: MarketSnapshot | null
  loading: boolean
  playbackIndex?: number
  playing?: boolean
  projectName?: string
  showHeader?: boolean
  manualTrades?: ManualTrade[]
  drawings?: ReplayDrawing[]
}>(), {
  playbackIndex: undefined,
  playing: false,
  projectName: '',
  showHeader: true,
  manualTrades: () => [],
  drawings: () => [],
})

const emit = defineEmits<{
  (event: 'drawings-changed', drawings: ReplayDrawing[]): void
}>()

const stochSettings = ref<Record<string, StochLengths>>({})
try { stochSettings.value = readStochSettings(localStorage.getItem(STOCH_STORAGE_KEY)) } catch { /* Storage may be disabled. */ }
const stochPeriod = computed(() => props.snapshot?.timeframe ?? '1m')
const stochLengths = computed(() => stochSettings.value[stochPeriod.value] ?? STOCH_DEFAULTS[stochPeriod.value])
const stochDraft = ref<StochLengths>([10, 20])
const stochMessage = ref('')
const stochLines: Array<{ key: 'k1' | 'd1' | 'k2' | 'd2'; color: string }> = [
  { key: 'k1', color: '#ffffff' }, { key: 'd1', color: '#ffff00' },
  { key: 'k2', color: '#ff0000' }, { key: 'd2', color: '#00ffff' },
]
let stochSeries: ISeriesApi<'Line'>[] = []

watch(stochLengths, (lengths) => {
  stochDraft.value = lengths ? [...lengths] : [10, 20]
  stochMessage.value = ''
}, { immediate: true })

function applyStoch(reset = false) {
  const lengths = reset ? STOCH_DEFAULTS[stochPeriod.value] : stochDraft.value
  if (!lengths || !lengths.every(validStochLength)) {
    stochMessage.value = 'K1 和 K2 必须是大于或等于 1 的整数。'
    return
  }
  stochSettings.value = { ...stochSettings.value, [stochPeriod.value]: [...lengths] }
  stochDraft.value = [...lengths]
  updateStoch()
  try {
    localStorage.setItem(STOCH_STORAGE_KEY, JSON.stringify(stochSettings.value))
    void nextTick(() => { stochMessage.value = reset ? '已恢复当前周期默认参数。' : '参数已应用并保存。' })
  } catch {
    void nextTick(() => { stochMessage.value = '参数已应用；浏览器无法保存，刷新后将恢复默认。' })
  }
}

function updateStoch() {
  if (!stochLengths.value) return
  const points = calculateStoch(visibleCandles.value, stochLengths.value)
  stochSeries.forEach((series, index) => {
    const key = stochLines[index].key
    series.setData(points.map((point) => point[key] === null
      ? { time: point.timestamp as UTCTimestamp }
      : { time: point.timestamp as UTCTimestamp, value: point[key] as number }))
  })
}

interface DrawingToolOption {
  id: ReplayDrawingTool
  label: string
  icon: Component
}

interface DrawingToolGroup {
  label: string
  tools: DrawingToolOption[]
}

const drawingToolGroups: DrawingToolGroup[] = [
  {
    label: '线条',
    tools: [
      { id: 'TrendLine', label: '趋势线', icon: Spline },
      { id: 'Ray', label: '射线', icon: MoveUpRight },
      { id: 'ExtendedLine', label: '延长线', icon: Minus },
      { id: 'HorizontalLine', label: '水平线', icon: Minus },
      { id: 'HorizontalRay', label: '水平射线', icon: ArrowUpRight },
      { id: 'VerticalLine', label: '垂直线', icon: Minus },
      { id: 'CrossLine', label: '十字线', icon: MousePointer2 },
      { id: 'Arrow', label: '箭头', icon: ArrowUpRight },
    ],
  },
  {
    label: '形状',
    tools: [
      { id: 'Rectangle', label: '矩形', icon: Square },
      { id: 'Circle', label: '椭圆', icon: Circle },
      { id: 'Triangle', label: '三角形', icon: Triangle },
      { id: 'ParallelChannel', label: '平行通道', icon: GitBranch },
    ],
  },
  {
    label: '测绘',
    tools: [
      { id: 'PriceRange', label: '价格区间', icon: Ruler },
      { id: 'DateRange', label: '日期区间', icon: Ruler },
      { id: 'FibRetracement', label: 'Fib 回撤', icon: MoveUpRight },
      { id: 'FibExtension', label: 'Fib 扩展', icon: MoveUpRight },
    ],
  },
]

const priceContainer = ref<HTMLElement | null>(null)
const contextMenuElement = ref<HTMLElement | null>(null)
let chartController: ChartController | null = null
let priceChart: IChartApi | null = null
let candleSeries: ISeriesApi<'Candlestick'> | null = null
let tradeMarkers: ISeriesMarkersPluginApi<Time> | null = null
let drawingEngine: DrawingEngine | null = null
let drawingController: DrawingController | null = null
let measurementController: MeasurementController | null = null
let drawingChangeUnsubscribe: (() => void) | null = null
let resizeObserver: ResizeObserver | null = null
let visibleRangeHandler: (() => void) | null = null
let feedbackTimer: number | null = null
let lastDrawingSnapshot = ''

const measurementResult = ref<MeasurementResult | null>(null)
const toolbarRevision = ref(0)
const toolFeedback = ref('')
const contextMenuPosition = ref<{ left: number; top: number } | null>(null)

const chartTheme: ChartTheme = {
  mode: 'dark',
  background: '#000000',
  text: '#dbe4ee',
  grid: 'rgba(0, 0, 0, 0)',
  axis: '#334155',
  crosshair: '#cbd5e1',
  crosshairLabelBg: '#111827',
  up: '#ffffff',
  down: '#ffffff',
  line: '#facc15',
  volumeUp: '#ffffff',
  volumeDown: '#dbe4ee',
  fontFamily: '"Fira Code", "IBM Plex Mono", "SFMono-Regular", Consolas, monospace',
  fontSize: 12,
}

const totalCandles = computed(() => props.snapshot?.candles.length ?? 0)

const visibleCount = computed(() => {
  const total = totalCandles.value
  if (!total) return 0
  const cursor = props.playbackIndex ?? total - 1
  return Math.min(Math.max(cursor + 1, 1), total)
})

const visibleCandles = computed(() => props.snapshot?.candles.slice(0, visibleCount.value) ?? [])
const currentCandle = computed(() => visibleCandles.value.at(-1) ?? null)
const visibleTradeMarkers = computed<SeriesMarker<Time>[]>(() => {
  const candles = visibleCandles.value
  const lastCandle = candles.at(-1)
  if (!lastCandle) return []
  return props.manualTrades
    .filter((trade) => trade.timestamp <= lastCandle.timestamp)
    .map((trade) => ({
      id: trade.id,
      time: candles[replayCursorIndexAtOrBefore(candles, trade.timestamp)].timestamp as UTCTimestamp,
      position: trade.side === 'buy' ? 'belowBar' : 'aboveBar',
      shape: trade.side === 'buy' ? 'arrowUp' : 'arrowDown',
      color: trade.side === 'buy' ? '#ffffff' : '#dbe4ee',
      text: trade.side === 'buy' ? 'BUY' : 'SELL',
      size: 1.25,
    }))
})

const activeTool = computed<ReplayDrawingTool | null>(() => {
  toolbarRevision.value
  const tool = drawingEngine?.getActiveTool()
  return isReplayDrawingTool(tool) ? tool : null
})

const activeToolLabel = computed(() => {
  const tool = activeTool.value
  if (!tool) return ''
  return drawingToolGroups.flatMap((group) => group.tools).find((item) => item.id === tool)?.label ?? tool
})

const drawingHint = computed(() => {
  const tool = activeTool.value
  return tool
    ? activeToolLabel.value + '已启用；点击图表（含右侧未加载区域）放置 ' + replayDrawingPointsNeeded(tool) + ' 个锚点。按 Esc 取消。'
    : ''
})

const isLocked = computed(() => {
  toolbarRevision.value
  return drawingEngine?.isLocked() ?? false
})

const hasSelection = computed(() => {
  toolbarRevision.value
  return Boolean(drawingEngine?.getSelectedId())
})

const measurementSummary = computed(() => {
  const result = measurementResult.value
  if (!result) return ''
  const direction = result.direction === 'up' ? '上涨' : result.direction === 'down' ? '下跌' : '持平'
  const sign = result.priceDiff > 0 ? '+' : ''
  return '测量：' + direction + ' ' + sign + result.priceDiff.toFixed(2) +
    ' (' + sign + result.pricePct.toFixed(2) + '%) · ' + result.barCount +
    ' 根 K 线 · ' + formatMeasurementDuration(result.timeDiffSeconds)
})

const summary = computed(() => {
  const candles = visibleCandles.value
  if (!candles.length) return '当前范围没有 K 线数据。'
  const first = candles[0]
  const last = currentCandle.value ?? candles[candles.length - 1]
  const change = ((last.close / first.open) - 1) * 100
  const progress = totalCandles.value
    ? String(candles.length) + '/' + String(totalCandles.value)
    : String(candles.length)
  const drawingSummary = props.drawings.length ? '，已绘制 ' + props.drawings.length + ' 个图形' : ''
  return (props.projectName ? props.projectName + ' · ' : '') + progress + ' 根 ' + props.snapshot?.timeframe +
    ' K 线，从 ' + formatUtc(first.timestamp) + ' 至 ' + formatUtc(last.timestamp) +
    ' UTC，区间涨跌 ' + (change >= 0 ? '上涨' : '下跌') + ' ' + Math.abs(change).toFixed(2) +
    '%' + drawingSummary + '。'
})

function isReplayDrawingTool(value: unknown): value is ReplayDrawingTool {
  return typeof value === 'string' && (REPLAY_DRAWING_TOOL_IDS as readonly string[]).includes(value)
}

function formatMeasurementDuration(seconds: number): string {
  const total = Math.max(0, Math.floor(seconds))
  const days = Math.floor(total / 86400)
  const hours = Math.floor((total % 86400) / 3600)
  const minutes = Math.floor((total % 3600) / 60)
  if (days) return days + '天' + (hours ? ' ' + hours + '小时' : '')
  if (hours) return hours + '小时' + (minutes ? ' ' + minutes + '分' : '')
  return minutes + '分'
}

function containerSize() {
  const container = priceContainer.value
  return {
    width: Math.max(container?.clientWidth ?? 0, 320),
    height: Math.max(container?.clientHeight ?? 360, 1),
  }
}

function chartOptions() {
  const size = containerSize()
  return {
    autoSize: false,
    width: size.width,
    height: size.height,
    layout: {
      background: { type: ColorType.Solid, color: chartTheme.background },
      textColor: chartTheme.text,
      fontFamily: chartTheme.fontFamily,
      fontSize: chartTheme.fontSize,
      attributionLogo: false,
    },
    grid: {
      vertLines: { color: 'rgba(0, 0, 0, 0)', visible: false },
      horzLines: { color: 'rgba(0, 0, 0, 0)', visible: false },
    },
    rightPriceScale: {
      borderColor: chartTheme.axis,
      scaleMargins: {
        top: 0.08,
        bottom: 0.1,
      },
    },
    timeScale: {
      borderColor: chartTheme.axis,
      timeVisible: true,
      secondsVisible: false,
      rightOffset: 8,
      barSpacing: 12,
    },
    crosshair: {
      vertLine: { color: chartTheme.crosshair },
      horzLine: { color: chartTheme.crosshair },
    },
  }
}

function toCandleKitBar(candle: { timestamp: number; open: number; high: number; low: number; close: number; volume: number }): Bar {
  return {
    ts: candle.timestamp * 1000,
    open: candle.open,
    high: candle.high,
    low: candle.low,
    close: candle.close,
    volume: candle.volume,
  }
}

function toLightweightCandle(candle: { timestamp: number; open: number; high: number; low: number; close: number }): CandlestickData<UTCTimestamp> {
  return {
    time: candle.timestamp as UTCTimestamp,
    open: candle.open,
    high: candle.high,
    low: candle.low,
    close: candle.close,
  }
}

function unloadedChartData(): Array<CandlestickData<UTCTimestamp> | WhitespaceData<UTCTimestamp>> {
  const candles = visibleCandles.value
  const lastTimestamp = candles.at(-1)?.timestamp
  const timeframe = props.snapshot?.timeframe ?? '1m'
  return [
    ...candles.map(toLightweightCandle),
    ...replayUnloadedTimestamps(lastTimestamp, timeframe).map((timestamp) => ({
      time: timestamp as UTCTimestamp,
    })),
  ]
}

function toCandleKitDrawing(drawing: ReplayDrawing): CandleKitDrawing {
  return {
    id: drawing.id,
    tool: drawing.tool as DrawingToolId,
    points: drawing.points.map((point): DrawingPoint => ({
      time: point.timestamp,
      price: point.price,
    })),
    style: { ...drawing.style },
  }
}

function fromCandleKitDrawing(drawing: CandleKitDrawing): ReplayDrawing | null {
  const tool = drawing.tool
  if (!isReplayDrawingTool(tool)) return null
  const pointsNeeded = replayDrawingPointsNeeded(tool)
  if (!Array.isArray(drawing.points) || drawing.points.length < pointsNeeded) return null
  const points = drawing.points.slice(0, pointsNeeded).map((point) => ({
    timestamp: Math.floor(point.time),
    price: point.price,
  }))
  if (points.some((point) => !Number.isFinite(point.timestamp) || !Number.isFinite(point.price) || point.price <= 0)) {
    return null
  }
  const sourceStyle = drawing.style as Partial<ReplayDrawingStyle>
  const width = typeof sourceStyle.width === 'number' && Number.isFinite(sourceStyle.width)
    ? Math.min(Math.max(sourceStyle.width, 1), 8)
    : DEFAULT_REPLAY_DRAWING_STYLE.width
  return {
    id: drawing.id,
    tool,
    points,
    style: {
      color: typeof sourceStyle.color === 'string' && sourceStyle.color.trim()
        ? sourceStyle.color
        : DEFAULT_REPLAY_DRAWING_STYLE.color,
      width,
      dashed: typeof sourceStyle.dashed === 'boolean' ? sourceStyle.dashed : DEFAULT_REPLAY_DRAWING_STYLE.dashed,
      fill: sourceStyle.fill === null || typeof sourceStyle.fill === 'string'
        ? sourceStyle.fill
        : DEFAULT_REPLAY_DRAWING_STYLE.fill,
    },
  }
}

function serializeReplayDrawings(drawings: readonly ReplayDrawing[]): string {
  return JSON.stringify(drawings.map((drawing) => ({
    id: drawing.id,
    tool: drawing.tool,
    points: drawing.points.map((point) => ({
      timestamp: point.timestamp,
      price: point.price,
    })),
    style: { ...drawing.style },
  })))
}

function engineDrawings(): ReplayDrawing[] {
  return drawingEngine
    ? drawingEngine.getDrawings().map(fromCandleKitDrawing).filter((drawing): drawing is ReplayDrawing => Boolean(drawing))
    : []
}

function bumpToolbar() {
  toolbarRevision.value += 1
}

function syncDrawingChange() {
  bumpToolbar()
  const drawings = engineDrawings()
  const snapshot = serializeReplayDrawings(drawings)
  if (snapshot === lastDrawingSnapshot) return
  lastDrawingSnapshot = snapshot
  emit('drawings-changed', drawings)
}

function syncDrawingsFromProps() {
  if (!drawingEngine) return
  const snapshot = serializeReplayDrawings(props.drawings)
  if (snapshot === lastDrawingSnapshot) return
  lastDrawingSnapshot = snapshot
  drawingEngine.import(JSON.stringify(props.drawings.map(toCandleKitDrawing)))
  lastDrawingSnapshot = serializeReplayDrawings(engineDrawings())
  bumpToolbar()
}

function disposeCharts() {
  stochSeries = []
  resizeObserver?.disconnect()
  resizeObserver = null
  if (priceChart && visibleRangeHandler) {
    priceChart.timeScale().unsubscribeVisibleLogicalRangeChange(visibleRangeHandler)
  }
  visibleRangeHandler = null
  drawingChangeUnsubscribe?.()
  drawingChangeUnsubscribe = null
  measurementController = null
  drawingController = null
  drawingEngine = null
  chartController?.destroy()
  chartController = null
  priceChart = null
  candleSeries = null
  tradeMarkers = null
  measurementResult.value = null
  lastDrawingSnapshot = ''
}

function playbackBarSpacing(count: number): number {
  if (count < 30) return 14
  if (count > 100) return 10
  return 12
}

function playbackWindowBars(count = visibleCandles.value.length) {
  const { width } = containerSize()
  return Math.min(Math.max(Math.floor(width / playbackBarSpacing(count)), 60), 180)
}

function setPlaybackRange() {
  const scale = priceChart?.timeScale()
  const count = visibleCandles.value.length
  if (!scale || !count) return

  const barSpacing = playbackBarSpacing(count)
  if (scale.options().barSpacing !== barSpacing) {
    scale.applyOptions({ barSpacing })
  }
  const bars = playbackWindowBars(count)
  const rightOffset = Math.max(6, Math.floor(bars * 0.06))
  const right = count - 1 + rightOffset
  scale.setVisibleLogicalRange({
    from: right - bars,
    to: right,
  })
}

function setSeriesData() {
  if (!chartController || !candleSeries) return
  chartController.setData(visibleCandles.value.map(toCandleKitBar))
  candleSeries.setData(unloadedChartData())
  tradeMarkers?.setMarkers(visibleTradeMarkers.value)
  updateStoch()
  setPlaybackRange()
}

function resizeChart() {
  if (!priceChart) return
  const size = containerSize()
  priceChart.applyOptions(size)
  setPlaybackRange()
}

function buildCharts() {
  if (!priceContainer.value || !props.snapshot?.candles.length) return
  disposeCharts()

  const controller = new ChartController(priceContainer.value, {
    theme: chartTheme,
    seriesType: 'candlestick',
    showVolume: false,
    autoFit: false,
    chartOptions: chartOptions(),
  })
  chartController = controller
  priceChart = controller.getChart()
  candleSeries = controller.getSeries() as ISeriesApi<'Candlestick'>
  candleSeries.applyOptions({
    upColor: 'transparent',
    downColor: '#ffffff',
    borderUpColor: '#ffffff',
    borderDownColor: '#ffffff',
    wickUpColor: '#ffffff',
    wickDownColor: '#ffffff',
    priceLineVisible: false,
  })
  tradeMarkers = createSeriesMarkers(candleSeries, [], { autoScale: true, zOrder: 'top' })
  if (stochLengths.value) {
    stochSeries = stochLines.map(({ key, color }) => priceChart!.addSeries(LineSeries, {
      title: key, color, lineWidth: 2, priceLineVisible: false,
      crosshairMarkerVisible: true,
      autoscaleInfoProvider: () => ({ priceRange: { minValue: 0, maxValue: 100 } }),
    }, 1))
    priceChart.panes()[0].setStretchFactor(3)
    priceChart.panes()[1].setStretchFactor(1)
  }

  const engine = new DrawingEngine()
  engine.setDefaultStyle({ ...DEFAULT_REPLAY_DRAWING_STYLE })
  engine.import(JSON.stringify(props.drawings.map(toCandleKitDrawing)))
  drawingEngine = engine
  drawingController = new DrawingController({
    engine,
    storageKey: null,
    hitTolerance: 6,
  })
  measurementController = new MeasurementController({
    modifier: 'shift',
    colors: {
      up: '#facc15',
      down: '#fb7185',
      flat: '#94a3b8',
      fillUp: 'rgba(250, 204, 21, 0.08)',
      fillDown: 'rgba(251, 113, 133, 0.08)',
      fillFlat: 'rgba(148, 163, 184, 0.06)',
    },
    onMeasure: (result) => {
      measurementResult.value = result
      bumpToolbar()
    },
  })
  controller.use(drawingController)
  controller.use(measurementController)
  lastDrawingSnapshot = serializeReplayDrawings(props.drawings)
  drawingChangeUnsubscribe = engine.onChange(syncDrawingChange)

  visibleRangeHandler = () => bumpToolbar()
  priceChart.timeScale().subscribeVisibleLogicalRangeChange(visibleRangeHandler)

  if (typeof ResizeObserver !== 'undefined') {
    resizeObserver = new ResizeObserver(() => {
      resizeChart()
    })
    resizeObserver.observe(priceContainer.value)
  }

  resizeChart()
  setSeriesData()
}

function zoom(factor: number) {
  const scale = priceChart?.timeScale()
  const range = scale?.getVisibleLogicalRange()
  if (!scale || !range) return
  const center = (range.from + range.to) / 2
  const half = ((range.to - range.from) / 2) * factor
  scale.setVisibleLogicalRange({ from: center - half, to: center + half })
  bumpToolbar()
}

function resetView() {
  resizeChart()
  setPlaybackRange()
  bumpToolbar()
}

function clearFeedbackTimer() {
  if (feedbackTimer !== null) {
    window.clearTimeout(feedbackTimer)
    feedbackTimer = null
  }
}

function setToolFeedback(message: string) {
  clearFeedbackTimer()
  toolFeedback.value = message
  if (!message) return
  feedbackTimer = window.setTimeout(() => {
    toolFeedback.value = ''
    feedbackTimer = null
  }, 2400)
}

function selectTool(tool: ReplayDrawingTool) {
  if (!drawingEngine || isLocked.value) return
  if (activeTool.value === tool) {
    stopDrawingTool()
    return
  }
  drawingEngine.startTool(tool)
  setToolFeedback(activeToolLabel.value + '已启用，点击图表放置锚点。')
}

function activateTrendLine() {
  if (activeTool.value === 'TrendLine') return
  selectTool('TrendLine')
}

defineExpose({ activateTrendLine })

function stopDrawingTool() {
  drawingEngine?.cancelDraft()
  drawingEngine?.stopTool()
  drawingEngine?.select(null)
  setToolFeedback('已返回选择工具。')
}

function toggleLock() {
  if (!drawingEngine) return
  drawingEngine.setLocked(!drawingEngine.isLocked())
  setToolFeedback(drawingEngine.isLocked() ? '绘图已锁定。' : '绘图已解锁。')
}

function deleteSelected() {
  if (!drawingEngine || isLocked.value || !drawingEngine.getSelectedId()) return
  drawingEngine.removeSelected()
  setToolFeedback('已删除选中的图形。')
}

function clearDrawings() {
  if (!drawingEngine || !props.drawings.length || isLocked.value) return
  if (typeof window !== 'undefined' && !window.confirm('确定清除当前项目的全部绘图吗？')) return
  drawingEngine.removeAll()
  drawingEngine.stopTool()
  setToolFeedback('当前项目的绘图已清除。')
}

function closeContextMenu() {
  contextMenuPosition.value = null
}

function openContextMenu(event: MouseEvent) {
  event.preventDefault()
  const chart = priceContainer.value
  if (!chart) return

  const bounds = chart.getBoundingClientRect()
  contextMenuPosition.value = {
    left: Math.max(8, Math.min(event.clientX - bounds.left, chart.clientWidth - 8)),
    top: Math.max(8, Math.min(event.clientY - bounds.top, chart.clientHeight - 8)),
  }

  void nextTick(() => {
    const menu = contextMenuElement.value
    const currentPosition = contextMenuPosition.value
    if (!menu || !currentPosition || !priceContainer.value) return
    const maxLeft = Math.max(8, priceContainer.value.clientWidth - menu.offsetWidth - 8)
    const maxTop = Math.max(8, priceContainer.value.clientHeight - menu.offsetHeight - 8)
    contextMenuPosition.value = {
      left: Math.min(currentPosition.left, maxLeft),
      top: Math.min(currentPosition.top, maxTop),
    }
  })
}

function clearDrawingsFromContextMenu() {
  closeContextMenu()
  clearDrawings()
}

function handleDocumentPointerDown(event: PointerEvent) {
  if (!contextMenuPosition.value) return
  if (contextMenuElement.value?.contains(event.target as Node)) return
  closeContextMenu()
}

function clearMeasurement() {
  measurementController?.clear()
  setToolFeedback('测量已清除。')
}

function handleKeyDown(event: KeyboardEvent) {
  if (event.key !== 'Escape') return
  closeContextMenu()
  measurementController?.clear()
  if (drawingEngine?.getActiveTool() || drawingEngine?.getDraft()) {
    drawingEngine.cancelDraft()
  }
}

watch(() => props.snapshot, async () => {
  await nextTick()
  if (props.snapshot?.candles.length) {
    buildCharts()
  } else {
    disposeCharts()
  }
}, { immediate: true })

watch([() => props.playbackIndex, () => props.playing, () => props.manualTrades], async () => {
  await nextTick()
  resizeChart()
  setSeriesData()
})

watch(() => props.drawings, () => {
  syncDrawingsFromProps()
}, { deep: true })

onMounted(async () => {
  window.addEventListener('keydown', handleKeyDown)
  document.addEventListener('pointerdown', handleDocumentPointerDown)
  await nextTick()
  if (props.snapshot?.candles.length && !chartController) {
    buildCharts()
  }
})

onBeforeUnmount(() => {
  window.removeEventListener('keydown', handleKeyDown)
  document.removeEventListener('pointerdown', handleDocumentPointerDown)
  closeContextMenu()
  clearFeedbackTimer()
  disposeCharts()
})
</script>

<template>
  <section class="chart-card" :class="{ 'chart-card-bare': !showHeader }" aria-labelledby="market-chart-title">
    <div v-if="showHeader" class="card-heading chart-heading">
      <div>
        <p class="eyebrow">PLAYBACK VIEW</p>
        <h2 id="market-chart-title">BTCUSD 复盘图</h2>
        <p class="chart-note">{{ summary }}</p>
      </div>
      <div class="chart-status">
        <span class="status-chip" :data-status="playing ? 'running' : 'paused'">{{ playing ? '播放中' : '已暂停' }}</span>
        <span class="status-chip muted">{{ visibleCount }}/{{ totalCandles }}</span>
      </div>
      <div class="chart-actions" aria-label="图表缩放控制">
        <button class="icon-button" type="button" aria-label="放大图表" title="放大" @click="zoom(0.75)">
          <ZoomIn :size="18" aria-hidden="true" />
        </button>
        <button class="icon-button" type="button" aria-label="缩小图表" title="缩小" @click="zoom(1.3)">
          <ZoomOut :size="18" aria-hidden="true" />
        </button>
        <button class="icon-button" type="button" aria-label="重置图表范围" title="重置" @click="resetView">
          <RotateCcw :size="18" aria-hidden="true" />
        </button>
      </div>
    </div>

    <p class="sr-only" role="status">{{ summary }}</p>
    <div v-if="loading" class="chart-skeleton" aria-label="正在加载行情" />
    <div v-else-if="!snapshot?.candles.length" class="empty-state">
      <p>当前时间范围没有行情数据。</p>
      <span>请调整 UTC 时间范围后重新加载。</span>
    </div>
    <div v-else class="chart-stage">
      <div ref="priceContainer" class="price-chart" aria-hidden="true" @contextmenu="openContextMenu" />

      <details v-if="stochLengths" class="stoch-settings">
        <summary>Stoch · {{ stochPeriod }} · {{ stochLengths[0] }} / {{ stochLengths[1] }}</summary>
        <form @submit.prevent="applyStoch()">
          <strong>Stoch 参数 · {{ stochPeriod }}</strong>
          <p>按当前周期保存；平滑长度为参数 × 0.3 四舍五入，最小为 1。</p>
          <label>K1 <input v-model.number="stochDraft[0]" aria-label="Stoch K1" type="number" min="1" step="1" required /></label>
          <label>K2 <input v-model.number="stochDraft[1]" aria-label="Stoch K2" type="number" min="1" step="1" required /></label>
          <div class="stoch-legend"><span v-for="line in stochLines" :key="line.key" :style="{ color: line.color }">{{ line.key }}</span></div>
          <p>仅使用已播放行情；历史较短时曲线仍在预热。</p>
          <div class="stoch-actions"><button type="submit">应用参数</button><button type="button" @click="applyStoch(true)">恢复默认</button></div>
          <p v-if="stochMessage" role="status">{{ stochMessage }}</p>
        </form>
      </details>

      <div class="chart-toolbox-edge" aria-hidden="true" />
      <div class="chart-toolbox" role="toolbar" aria-label="绘图工具栏">
        <div class="chart-tool-group chart-tool-group-primary">
          <button
            class="chart-tool-button"
            :class="{ active: !activeTool }"
            type="button"
            data-testid="drawing-tool-cursor"
            aria-label="选择工具"
            title="选择工具"
            @click="stopDrawingTool"
          >
            <MousePointer2 :size="16" aria-hidden="true" />
          </button>
        </div>

        <div v-for="group in drawingToolGroups" :key="group.label" class="chart-tool-group" :aria-label="group.label">
          <span class="chart-tool-group-label">{{ group.label }}</span>
          <button
            v-for="tool in group.tools"
            :key="tool.id"
            class="chart-tool-button"
            :class="{ active: activeTool === tool.id }"
            type="button"
            :data-testid="'drawing-tool-' + tool.id"
            :aria-label="tool.label"
            :aria-pressed="activeTool === tool.id"
            :title="tool.label"
            @click="selectTool(tool.id)"
          >
            <component :is="tool.icon" :size="16" aria-hidden="true" />
            <span class="chart-tool-tooltip">{{ tool.label }}</span>
          </button>
        </div>

        <div class="chart-tool-group chart-tool-group-actions" aria-label="绘图操作">
          <button
            class="chart-tool-button"
            type="button"
            data-testid="drawing-measurement"
            aria-label="测量（Shift 加拖动）"
            title="测量：按住 Shift 拖动"
            @click="setToolFeedback('按住 Shift 并在图表上拖动即可测量。')"
          >
            <Ruler :size="16" aria-hidden="true" />
          </button>
          <button
            class="chart-tool-button"
            type="button"
            data-testid="drawing-lock"
            :aria-pressed="isLocked"
            :aria-label="isLocked ? '解锁绘图' : '锁定绘图'"
            :title="isLocked ? '解锁绘图' : '锁定绘图'"
            @click="toggleLock"
          >
            <Unlock v-if="!isLocked" :size="16" aria-hidden="true" />
            <Lock v-else :size="16" aria-hidden="true" />
          </button>
          <button
            class="chart-tool-button"
            type="button"
            data-testid="drawing-delete"
            aria-label="删除选中图形"
            title="删除选中图形（Delete）"
            :disabled="!hasSelection || isLocked"
            @click="deleteSelected"
          >
            <Trash2 :size="16" aria-hidden="true" />
          </button>
          <button
            class="chart-tool-button chart-tool-clear"
            type="button"
            data-testid="drawing-clear"
            aria-label="清除全部绘图"
            title="清除全部绘图"
            :disabled="!drawings.length || isLocked"
            @click="clearDrawings"
          >
            <X :size="16" aria-hidden="true" />
          </button>
        </div>
      </div>

      <div
        v-if="contextMenuPosition"
        ref="contextMenuElement"
        class="chart-context-menu"
        role="menu"
        data-testid="drawing-context-menu"
        :style="{ left: contextMenuPosition.left + 'px', top: contextMenuPosition.top + 'px' }"
        @pointerdown.stop
        @contextmenu.prevent
      >
        <button
          type="button"
          role="menuitem"
          data-testid="drawing-context-clear"
          aria-label="删除全部绘图"
          :disabled="!drawings.length || isLocked"
          @click="clearDrawingsFromContextMenu"
        >
          <Trash2 :size="15" aria-hidden="true" />
          <span>删除全部绘图</span>
        </button>
      </div>

      <p v-if="activeTool || toolFeedback" class="drawing-hint" role="status" aria-live="polite">
        {{ toolFeedback || drawingHint }}
      </p>
      <p v-if="measurementSummary" class="measurement-readout" role="status" aria-live="polite">
        {{ measurementSummary }}
        <button type="button" class="measurement-clear" aria-label="清除测量" @click="clearMeasurement">
          <X :size="14" aria-hidden="true" />
        </button>
      </p>
    </div>
  </section>
</template>
