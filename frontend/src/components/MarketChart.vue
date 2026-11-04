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
  LineStyle,
  createSeriesMarkers,
  type CandlestickData,
  type CreatePriceLineOptions,
  type IChartApi,
  type ISeriesMarkersPluginApi,
  type ISeriesApi,
  type LineWidth,
  type SeriesMarker,
  type Time,
  type UTCTimestamp,
  type WhitespaceData,
} from 'lightweight-charts'
import {
  Lock,
  MousePointer2,
  RotateCcw,
  Square,
  Spline,
  Trash2,
  Unlock,
  X,
  ZoomIn,
  ZoomOut,
} from '@lucide/vue'
import {
  DEFAULT_REPLAY_DRAWING_STYLE,
  REPLAY_DRAWING_TOOL_IDS,
  manualTradeMarker,
  replayCursorIndexAtOrBefore,
  replayDrawingPointsNeeded,
  replayPaneDisplayCandles,
  replayUnloadedTimestamps,
  type ManualTrade,
  type ReplayDrawing,
  type ReplayDrawingStyle,
  type ReplayDrawingTool,
} from '../replay'
import type { Candle, MarketSnapshot } from '../types'
import { formatUtc } from '../format'
import { t } from '../i18n'
import { scopedStorageKey } from '../userStorage'
import {
  calculateStoch,
  defaultStochSetting,
  readStochSettings,
  STOCH_DEFAULTS,
  STOCH_STORAGE_KEY,
  validStochLengths,
  type StochGroupCount,
  type StochLineKey,
  type StochLengths,
  type StochSetting,
} from '../stoch'

import ChartLoadState from './ChartLoadState.vue'

const chartReady = ref(false)
let revealFrame: number | null = null
function cancelReveal() {
  if (revealFrame !== null) window.cancelAnimationFrame(revealFrame)
  revealFrame = null
}
function revealAfterPaint() {
  if (chartReady.value || revealFrame !== null || !chartController || !visibleCandles.value.length) return
  // Leave the opaque cover up through the renderer's scheduled frame and the next paint.
  revealFrame = window.requestAnimationFrame(() => {
    revealFrame = window.requestAnimationFrame(() => {
      revealFrame = null
      if (!disposed && chartController && priceContainer.value?.clientWidth && priceContainer.value?.clientHeight && visibleCandles.value.length) {
        chartReady.value = true
      }
    })
  })
}

const props = withDefaults(defineProps<{
  candleColors?: { up: string; down: string; hollow: boolean }
  snapshot: MarketSnapshot | null
  loading: boolean
  error?: string
  playbackIndex?: number
  playing?: boolean
  historyAvailable?: boolean
  projectName?: string
  showHeader?: boolean
  showTools?: boolean
  manualTrades?: ManualTrade[]
  drawings?: ReplayDrawing[]
  clockLimited?: boolean
  formingBucket?: number | null
  formingCandle?: Candle | null
}>(), {
  playbackIndex: undefined,
  playing: false,
  projectName: '',
  showHeader: true,
  showTools: true,
  manualTrades: () => [],
  drawings: () => [],
  clockLimited: false,
  formingBucket: null,
  formingCandle: null,
})

const emit = defineEmits<{
  (event: 'drawings-changed', drawings: ReplayDrawing[]): void
  (event: 'load-history'): void
}>()

const autoScale = ref(true)
let scaleSyncFrame: number | null = null

function syncAutoScale() {
  if (scaleSyncFrame !== null) window.cancelAnimationFrame(scaleSyncFrame)
  scaleSyncFrame = window.requestAnimationFrame(() => {
    scaleSyncFrame = null
    if (priceChart) autoScale.value = priceChart.priceScale('right', 0).options().autoScale
  })
}

function setAutoScale(enabled: boolean) {
  autoScale.value = enabled
  priceChart?.priceScale('right', 0).applyOptions({ autoScale: enabled })
}

function toggleAutoScale() {
  setAutoScale(!autoScale.value)
}

const stochVisible = ref(true)
try { stochVisible.value = localStorage.getItem(scopedStorageKey('btcusd.stoch.visible')) !== 'false' } catch { /* Storage may be disabled. */ }

function toggleStoch() {
  stochVisible.value = !stochVisible.value
  syncStochSeries()
  updateStoch()
  try { localStorage.setItem(scopedStorageKey('btcusd.stoch.visible'), String(stochVisible.value)) } catch { /* Storage may be disabled. */ }
}

const stochSettings = ref<Record<string, StochSetting>>({})
try { stochSettings.value = readStochSettings(localStorage.getItem(scopedStorageKey(STOCH_STORAGE_KEY))) } catch { /* Storage may be disabled. */ }
const stochPeriod = computed(() => props.snapshot?.timeframe ?? '1m')
const stochSetting = computed(() => stochSettings.value[stochPeriod.value] ?? defaultStochSetting(stochPeriod.value))
const stochGroupCount = computed(() => stochSetting.value.groups)
const stochLengths = computed(() => stochSetting.value.lengths.slice(0, stochGroupCount.value))
const stochDraft = ref<StochLengths>([...defaultStochSetting('1m').lengths])
const stochGroupsDraft = ref<StochGroupCount>(4)
const stochMessage = ref('')
// K/D styles follow stoch_btc_v12.
const STOCH_LINE_STYLES: Array<{ key: StochLineKey; color: string; lineWidth: LineWidth }> = [
  { key: 'k1', color: '#ffffff', lineWidth: 2 }, { key: 'd1', color: '#ffff00', lineWidth: 2 },
  { key: 'k2', color: '#ff0000', lineWidth: 2 }, { key: 'd2', color: '#00ffff', lineWidth: 2 },
  { key: 'k3', color: '#ffffff', lineWidth: 3 }, { key: 'd3', color: '#ffff00', lineWidth: 3 },
  { key: 'k4', color: '#aa00ff', lineWidth: 3 }, { key: 'd4', color: '#00ff00', lineWidth: 3 },
  { key: 'k5', color: '#ff8800', lineWidth: 3 }, { key: 'd5', color: '#0088ff', lineWidth: 3 },
  { key: 'k6', color: '#ff66cc', lineWidth: 3 }, { key: 'd6', color: '#66ff99', lineWidth: 3 },
]
const stochLines = computed(() => STOCH_LINE_STYLES.slice(0, stochGroupCount.value * 2))
// Pine reference levels: 20, 50, 80.
const STOCH_MIDLINE: CreatePriceLineOptions = {
  price: 50,
  color: '#787b86',
  lineWidth: 1,
  lineStyle: LineStyle.Solid,
  axisLabelVisible: true,
  title: '',
}
let stochSeries: ISeriesApi<'Line'>[] = []

watch(stochSetting, (setting) => {
  stochGroupsDraft.value = setting.groups
  stochDraft.value = [...setting.lengths]
  stochMessage.value = ''
}, { immediate: true })

function applyStoch(reset = false) {
  const groups = stochGroupsDraft.value
  const defaults = STOCH_DEFAULTS[stochPeriod.value] ?? STOCH_DEFAULTS['1h']
  const active = stochDraft.value.slice(0, groups)
  if (!validStochLengths(active)) {
    stochMessage.value = t('chart.stochInvalid')
    return
  }
  const setting: StochSetting = reset
    ? { groups, lengths: [...defaults] as StochLengths }
    : { groups, lengths: [...stochDraft.value] as StochLengths }
  stochSettings.value = { ...stochSettings.value, [stochPeriod.value]: setting }
  stochGroupsDraft.value = setting.groups
  stochDraft.value = [...setting.lengths]
  syncStochSeries()
  updateStoch()
  try {
    localStorage.setItem(scopedStorageKey(STOCH_STORAGE_KEY), JSON.stringify(stochSettings.value))
    void nextTick(() => { stochMessage.value = reset ? t('chart.stochDefaultsRestored') : t('chart.stochApplied') })
  } catch {
    void nextTick(() => { stochMessage.value = t('chart.stochAppliedUnsaved') })
  }
}

function syncStochSeries() {
  if (!priceChart) return
  const lines = stochVisible.value ? stochLines.value : []
  while (stochSeries.length > lines.length) {
    const series = stochSeries.pop()
    if (series) priceChart.removeSeries(series)
  }
  while (stochSeries.length < lines.length) {
    const index = stochSeries.length
    const { key, color, lineWidth } = lines[index]
    const series = priceChart.addSeries(LineSeries, {
      title: key, color, lineWidth, priceLineVisible: false, lastValueVisible: false,
      crosshairMarkerVisible: true,
      autoscaleInfoProvider: () => ({ priceRange: { minValue: 0, maxValue: 100 } }),
    }, 1)
    if (index === 0) {
      for (const price of [20, 50, 80]) series.createPriceLine({ ...STOCH_MIDLINE, price })
    }
    stochSeries.push(series)
  }
  const panes = priceChart.panes()
  panes[0]?.setStretchFactor(3)
  panes[1]?.setStretchFactor(1)
}

function updateStoch() {
  if (!stochSeries.length || !validStochLengths(stochLengths.value)) return
  const points = calculateStoch(visibleCandles.value, stochLengths.value)
  stochSeries.forEach((series, index) => {
    const key = stochLines.value[index].key
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

const drawingToolGroups = computed<DrawingToolGroup[]>(() => [
  {
    label: t('chart.drawing'),
    tools: [
      { id: 'TrendLine', label: t('chart.trendLine'), icon: Spline },
      { id: 'Rectangle', label: t('chart.rectangle'), icon: Square },
    ],
  },
])

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
let mounted = false
let disposed = false

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

const cursorCandleCount = computed(() => {
  const total = totalCandles.value
  if (!total) return 0
  const cursor = props.playbackIndex ?? total - 1
  return Math.min(Math.max(cursor + 1, 1), total)
})

// Panes follow the shared replay clock instead of a cursor index: they show the candles of
// their loaded window that already closed plus the candle still forming in the current bucket,
// so a pane never renders a candle the main timeframe has not played yet.
const clippedCandles = computed<Candle[] | null>(() => {
  if (!props.clockLimited) return null
  const bucket = props.formingBucket
  const forming = props.formingCandle ?? null
  // Without a clock a pane must not fall back to its loaded window: it would show candles the
  // replay has not reached yet.
  if ((typeof bucket !== 'number' || !Number.isFinite(bucket)) && !forming) return []
  return replayPaneDisplayCandles(
    props.snapshot?.candles ?? [],
    typeof bucket === 'number' && Number.isFinite(bucket) ? bucket : null,
    forming,
  )
})

const visibleCandles = computed(() => clippedCandles.value
  ?? props.snapshot?.candles.slice(0, cursorCandleCount.value)
  ?? [])
const visibleCount = computed(() => visibleCandles.value.length)
const currentCandle = computed(() => visibleCandles.value.at(-1) ?? null)
const visibleTradeMarkers = computed<SeriesMarker<Time>[]>(() => {
  const candles = visibleCandles.value
  const lastCandle = candles.at(-1)
  if (!lastCandle) return []
  return props.manualTrades
    .map((trade, index) => ({ trade, ordinal: index + 1 }))
    .filter(({ trade }) => trade.timestamp <= lastCandle.timestamp)
    .map(({ trade, ordinal }) => ({
      id: trade.id,
      time: candles[replayCursorIndexAtOrBefore(candles, trade.timestamp)].timestamp as UTCTimestamp,
      ...manualTradeMarker(trade, ordinal),
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
  return drawingToolGroups.value.flatMap((group) => group.tools).find((item) => item.id === tool)?.label ?? tool
})

const drawingHint = computed(() => {
  const tool = activeTool.value
  return tool
    ? t('chart.toolEnabledHint', { tool: activeToolLabel.value, points: replayDrawingPointsNeeded(tool) })
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
  const direction = result.direction === 'up'
    ? t('chart.directionUp')
    : result.direction === 'down' ? t('chart.directionDown') : t('chart.directionFlat')
  const sign = result.priceDiff > 0 ? '+' : ''
  return t('chart.measurement', {
    direction,
    sign,
    change: result.priceDiff.toFixed(2),
    percent: result.pricePct.toFixed(2),
    bars: result.barCount,
    duration: formatMeasurementDuration(result.timeDiffSeconds),
  })
})

const summary = computed(() => {
  const candles = visibleCandles.value
  if (!candles.length) return t('chart.summaryEmpty')
  const first = candles[0]
  const last = currentCandle.value ?? candles[candles.length - 1]
  const change = ((last.close / first.open) - 1) * 100
  const progress = totalCandles.value
    ? String(candles.length) + '/' + String(totalCandles.value)
    : String(candles.length)
  const drawingSummary = props.drawings.length ? t('chart.summaryDrawings', { count: props.drawings.length }) : ''
  return t('chart.summary', {
    project: props.projectName ? props.projectName + ' · ' : '',
    progress,
    timeframe: props.snapshot?.timeframe ?? '',
    from: formatUtc(first.timestamp),
    to: formatUtc(last.timestamp),
    direction: change >= 0 ? t('chart.directionUp') : t('chart.directionDown'),
    change: Math.abs(change).toFixed(2),
    drawings: drawingSummary,
  })
})

function isReplayDrawingTool(value: unknown): value is ReplayDrawingTool {
  return typeof value === 'string' && (REPLAY_DRAWING_TOOL_IDS as readonly string[]).includes(value)
}

function formatMeasurementDuration(seconds: number): string {
  const total = Math.max(0, Math.floor(seconds))
  const days = Math.floor(total / 86400)
  const hours = Math.floor((total % 86400) / 3600)
  const minutes = Math.floor((total % 3600) / 60)
  if (days) return `${days}${t('chart.unitDay')}` + (hours ? ` ${hours}${t('chart.unitHour')}` : '')
  if (hours) return `${hours}${t('chart.unitHour')}` + (minutes ? ` ${minutes}${t('chart.unitMinute')}` : '')
  return `${minutes}${t('chart.unitMinute')}`
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
      autoScale: autoScale.value,
      borderColor: chartTheme.axis,
      scaleMargins: {
        // Marker auto-scale only reserves room for one marker row, so keep extra
        // headroom for trades stacked on the same bar.
        top: 0.15,
        bottom: 0.12,
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
  cancelReveal()
  chartReady.value = false
  if (scaleSyncFrame !== null) window.cancelAnimationFrame(scaleSyncFrame)
  scaleSyncFrame = null
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

function setPlaybackRange(bars = playbackWindowBars()) {
  const scale = priceChart?.timeScale()
  const count = visibleCandles.value.length
  if (!scale || !count) return

  const rightOffset = Math.max(6, Math.floor(bars * 0.06))
  const right = count - 1 + rightOffset
  scale.setVisibleLogicalRange({
    from: right - bars,
    to: right,
  })
}

function setSeriesData() {
  if (!chartController || !candleSeries) return
  const range = priceChart?.timeScale().getVisibleLogicalRange()
  const addedBars = visibleCandles.value.length - chartController.getBars().length
  chartController.setData(visibleCandles.value.map(toCandleKitBar))
  candleSeries.setData(unloadedChartData())
  tradeMarkers?.setMarkers(visibleTradeMarkers.value)
  updateStoch()
  if (range) {
    // Follow replay progress without changing the user's zoom or right-hand space.
    priceChart?.timeScale().setVisibleLogicalRange({
      from: range.from + addedBars,
      to: range.to + addedBars,
    })
  } else {
    setPlaybackRange()
  }
}

function resizeChart() {
  if (!priceChart) return
  const size = containerSize()
  priceChart.applyOptions(size)
}

function applyCandleColors() {
  const colors = props.candleColors ?? { up: '#ffffff', down: '#ffffff', hollow: true }
  candleSeries?.applyOptions({
    upColor: colors.hollow ? 'transparent' : colors.up,
    downColor: colors.down,
    borderUpColor: colors.up,
    borderDownColor: colors.down,
    wickUpColor: colors.up,
    wickDownColor: colors.down,
    priceLineVisible: false,
  })
}
watch(() => props.candleColors, applyCandleColors, { deep: true })

function buildCharts() {
  if (disposed || chartController || !priceContainer.value || !props.snapshot?.candles.length) return

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
  applyCandleColors()
  tradeMarkers = createSeriesMarkers(candleSeries, [], { autoScale: true, zOrder: 'top' })
  syncStochSeries()

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

  visibleRangeHandler = () => {
    bumpToolbar()
    const range = priceChart?.timeScale().getVisibleLogicalRange()
    if (props.historyAvailable && range && range.from < 30) emit('load-history')
  }
  priceChart.timeScale().subscribeVisibleLogicalRangeChange(visibleRangeHandler)

  if (typeof ResizeObserver !== 'undefined') {
    resizeObserver = new ResizeObserver(() => {
      resizeChart()
      revealAfterPaint()
    })
    resizeObserver.observe(priceContainer.value)
  }

  resizeChart()
  setSeriesData()
  revealAfterPaint()
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
  setAutoScale(true)
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
  setToolFeedback(t('chart.toolEnabled', { tool: activeToolLabel.value }))
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
  setToolFeedback(t('chart.toolClosed'))
}

function toggleLock() {
  if (!drawingEngine) return
  drawingEngine.setLocked(!drawingEngine.isLocked())
  setToolFeedback(drawingEngine.isLocked() ? t('chart.drawingsLocked') : t('chart.drawingsUnlocked'))
}

function deleteSelected() {
  if (!drawingEngine || isLocked.value || !drawingEngine.getSelectedId()) return
  drawingEngine.removeSelected()
  setToolFeedback(t('chart.drawingDeleted'))
}

function clearDrawings() {
  if (!drawingEngine || !props.drawings.length || isLocked.value) return
  if (typeof window !== 'undefined' && !window.confirm(t('chart.clearDrawingsConfirm'))) return
  drawingEngine.removeAll()
  drawingEngine.stopTool()
  setToolFeedback(t('chart.drawingsCleared'))
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
  setToolFeedback(t('chart.measurementCleared'))
}

function handleKeyDown(event: KeyboardEvent) {
  if (event.key !== 'Escape') return
  closeContextMenu()
  measurementController?.clear()
  if (drawingEngine?.getActiveTool() || drawingEngine?.getDraft()) {
    drawingEngine.cancelDraft()
  }
}

function updateCharts() {
  if (!mounted || disposed) return
  if (!props.snapshot?.candles.length) {
    disposeCharts()
  } else if (!chartController) {
    buildCharts()
  } else {
    resizeChart()
    setSeriesData()
    revealAfterPaint()
  }
}

// One post-render update handles snapshot and cursor changes together. App keys own
// project/timeframe resets; appending a window keeps drawing plugins and zoom alive.
watch(
  [
    () => props.snapshot,
    () => props.loading,
    () => props.playbackIndex,
    () => props.manualTrades,
    () => props.clockLimited,
    () => props.formingBucket,
    () => props.formingCandle,
  ],
  updateCharts,
  { flush: 'post' },
)

watch(() => props.drawings, () => {
  syncDrawingsFromProps()
}, { deep: true })

onMounted(() => {
  mounted = true
  window.addEventListener('keydown', handleKeyDown)
  document.addEventListener('pointerdown', handleDocumentPointerDown)
  updateCharts()
})

onBeforeUnmount(() => {
  disposed = true
  mounted = false
  window.removeEventListener('keydown', handleKeyDown)
  document.removeEventListener('pointerdown', handleDocumentPointerDown)
  closeContextMenu()
  clearFeedbackTimer()
  disposeCharts()
})
</script>

<template>
  <section class="chart-card grid min-h-0" :class="{ 'chart-card-bare': !showHeader }" aria-labelledby="market-chart-title">
    <div v-if="showHeader" class="card-heading chart-heading">
      <div>
        <p class="eyebrow text-[color:var(--info)] [font:700_10px/1.4_'Fira_Code',_ui-monospace,_SFMono-Regular,_Consolas,_monospace] tracking-[0]">PLAYBACK VIEW</p>
        <h2 id="market-chart-title">{{ t('chart.title') }}</h2>
        <p class="chart-note mt-1.5 max-w-[68ch] text-[color:var(--text-muted)] text-[length:12px] leading-[1.45]">{{ summary }}</p>
      </div>
      <div class="chart-status flex flex-wrap items-center gap-2">
        <span class="status-chip inline-flex items-center rounded-full whitespace-nowrap" :data-status="playing ? 'running' : 'paused'">{{ playing ? t('app.playing') : t('app.paused') }}</span>
        <span class="status-chip muted inline-flex items-center rounded-full whitespace-nowrap">{{ visibleCount }}/{{ totalCandles }}</span>
      </div>
      <div class="chart-actions flex flex-wrap gap-2" :aria-label="t('chart.zoomLabel')">
        <button class="icon-button w-11 h-11 grid place-items-center rounded-[var(--radius)] [background:var(--surface-2)]" type="button" :aria-label="t('chart.zoomIn')" :title="t('chart.zoomInTitle')" @click="zoom(0.75)">
          <ZoomIn :size="18" aria-hidden="true" />
        </button>
        <button class="icon-button w-11 h-11 grid place-items-center rounded-[var(--radius)] [background:var(--surface-2)]" type="button" :aria-label="t('chart.zoomOut')" :title="t('chart.zoomOutTitle')" @click="zoom(1.3)">
          <ZoomOut :size="18" aria-hidden="true" />
        </button>
        <button class="icon-button w-11 h-11 grid place-items-center rounded-[var(--radius)] [background:var(--surface-2)]" type="button" :aria-label="t('chart.resetView')" :title="t('chart.reset')" @click="resetView">
          <RotateCcw :size="18" aria-hidden="true" />
        </button>
      </div>
    </div>

    <p class="sr-only" role="status">{{ summary }}</p>
    <!-- Background refreshes must keep the container bound to the live chart instance. -->
    <ChartLoadState v-if="loading && !snapshot?.candles.length" :message="t('chart.loading')" :aria-label="t('chart.loadingAria')" />
    <div v-else-if="!snapshot?.candles.length" class="empty-state chart-feedback place-content-center text-center" :role="error ? 'alert' : 'status'">
      <p>{{ error ? t('chart.loadFailed') : t('chart.noData') }}</p>
      <span>{{ error || t('chart.adjustRange') }}</span>
    </div>
    <div v-else class="chart-stage relative w-full overflow-hidden [background:var(--chart-bg)]" :class="{ 'chart-stage-with-controls': Boolean(stochLengths) }" :aria-busy="!chartReady">
      <ChartLoadState v-if="!chartReady" class="chart-preparing-cover absolute inset-0 z-20" :message="t('chart.preparing')" />
      <div class="chart-control-strip absolute z-[7] top-0 left-0 right-0 flex items-center justify-end h-[var(--chart-control-strip-height)] [padding:0_76px_0_12px] [background:var(--chart-bg)]">
        <button
          class="stoch-visibility-toggle chart-auto-scale mr-2 [padding:5px_10px] rounded-[6px] text-[length:12px] whitespace-nowrap"
          type="button"
          data-testid="chart-auto-scale"
          :aria-label="t('chart.autoScaleAria')"
          :aria-pressed="autoScale"
          :title="autoScale ? t('chart.autoScaleOn') : t('chart.autoScaleOff')"
          @click="toggleAutoScale"
        >{{ t('chart.auto') }}</button>
        <button class="stoch-visibility-toggle mr-2 [padding:5px_10px] rounded-[6px] text-[length:12px] whitespace-nowrap" type="button" :aria-pressed="stochVisible" @click="toggleStoch">
          {{ stochVisible ? t('chart.hideIndicator') : t('chart.showIndicator') }}
        </button>
        <details v-if="stochLengths" class="stoch-settings z-[7]">
          <summary :aria-label="`Stoch · ${stochPeriod} · ${stochLengths.join(' / ')}`"><span>Stoch</span><span class="stoch-summary-detail"> · {{ stochPeriod }} · {{ stochLengths.join(' / ') }}</span></summary>
          <form @submit.prevent="applyStoch()">
            <strong>{{ t('chart.stochSettings', { period: stochPeriod }) }}</strong>
            <p>{{ t('chart.stochNote') }}</p>
            <fieldset class="stoch-groups border-0">
              <legend>{{ t('chart.stochGroups') }}</legend>
              <label v-for="count in ([2, 3, 4, 5, 6] as const)" :key="count"><input v-model="stochGroupsDraft" :data-testid="`stoch-groups-${count}`" type="radio" :value="count" />{{ t('chart.stochGroupOption', { n: count }) }}</label>
            </fieldset>
            <label v-for="index in stochGroupsDraft" :key="index">K{{ index }} <input v-model.number="stochDraft[index - 1]" :aria-label="`Stoch K${index}`" type="number" min="1" step="1" required /></label>
            <div class="stoch-legend"><span v-for="line in stochLines" :key="line.key" :style="{ color: line.color }">{{ line.key }}</span></div>
            <p>{{ t('chart.stochWarmup') }}</p>
            <div class="stoch-actions"><button type="submit">{{ t('chart.apply') }}</button><button type="button" @click="applyStoch(true)">{{ t('chart.restoreDefaults') }}</button></div>
            <p v-if="stochMessage" role="status">{{ stochMessage }}</p>
          </form>
        </details>
      </div>

      <div ref="priceContainer" class="price-chart absolute w-full min-h-0 [background:var(--chart-bg)]" aria-hidden="true" @pointerup="syncAutoScale" @pointercancel="syncAutoScale" @dblclick="syncAutoScale" @contextmenu="openContextMenu" />

      <div v-if="showTools" class="chart-toolbox-edge" aria-hidden="true" />
      <div v-if="showTools" class="chart-toolbox absolute z-[4] flex flex-col items-stretch gap-0.5 w-10 p-1 overflow-y-auto [border:1px_solid_rgba(148,_163,_184,_0.42)] rounded-[7px] [background:rgba(15,_23,_42,_0.88)] [box-shadow:0_18px_36px_rgba(0,_0,_0,_0.32)] [backdrop-filter:blur(10px)] [scrollbar-width:thin]" role="toolbar" :aria-label="t('chart.drawingToolbar')">
        <div class="chart-tool-group chart-tool-group-primary grid gap-0.5">
          <button
            class="chart-tool-button relative w-7.5 min-h-7 inline-flex items-center justify-center p-0 rounded-[4px] text-[length:11px] font-bold whitespace-nowrap"
            :class="{ active: !activeTool }"
            type="button"
            data-testid="drawing-tool-cursor"
            :aria-label="t('chart.selectTool')"
            :title="t('chart.selectTool')"
            @click="stopDrawingTool"
          >
            <MousePointer2 :size="16" aria-hidden="true" />
          </button>
        </div>

        <div v-for="group in drawingToolGroups" :key="group.label" class="chart-tool-group grid gap-0.5" :aria-label="group.label">
          <span class="chart-tool-group-label hidden overflow-hidden text-[color:rgba(203,_213,_225,_0.68)] text-[length:8px] font-extrabold leading-[1] text-center text-ellipsis whitespace-nowrap">{{ group.label }}</span>
          <button
            v-for="tool in group.tools"
            :key="tool.id"
            class="chart-tool-button relative w-7.5 min-h-7 inline-flex items-center justify-center p-0 rounded-[4px] text-[length:11px] font-bold whitespace-nowrap"
            :class="{ active: activeTool === tool.id }"
            type="button"
            :data-testid="'drawing-tool-' + tool.id"
            :aria-label="tool.label"
            :aria-pressed="activeTool === tool.id"
            :title="tool.label"
            @click="selectTool(tool.id)"
          >
            <component :is="tool.icon" :size="16" aria-hidden="true" />
            <span class="chart-tool-tooltip absolute left-[calc(100%_+_8px)] top-[50%] z-[6] min-w-[max-content] [padding:5px_7px] [border:1px_solid_rgba(148,_163,_184,_0.34)] rounded-[4px] [background:#0f172a] text-[color:#f8fafc] text-[length:11px] font-bold leading-[1] pointer-events-none">{{ tool.label }}</span>
          </button>
        </div>

        <div class="chart-tool-group chart-tool-group-actions grid gap-0.5" :aria-label="t('chart.drawingActions')">
          <button
            class="chart-tool-button relative w-7.5 min-h-7 inline-flex items-center justify-center p-0 rounded-[4px] text-[length:11px] font-bold whitespace-nowrap"
            type="button"
            data-testid="drawing-lock"
            :aria-pressed="isLocked"
            :aria-label="isLocked ? t('chart.unlockDrawing') : t('chart.lockDrawing')"
            :title="isLocked ? t('chart.unlockDrawing') : t('chart.lockDrawing')"
            @click="toggleLock"
          >
            <Unlock v-if="!isLocked" :size="16" aria-hidden="true" />
            <Lock v-else :size="16" aria-hidden="true" />
          </button>
          <button
            class="chart-tool-button relative w-7.5 min-h-7 inline-flex items-center justify-center p-0 rounded-[4px] text-[length:11px] font-bold whitespace-nowrap"
            type="button"
            data-testid="drawing-delete"
            :aria-label="t('chart.deleteSelected')"
            :title="t('chart.deleteSelectedTitle')"
            :disabled="!hasSelection || isLocked"
            @click="deleteSelected"
          >
            <Trash2 :size="16" aria-hidden="true" />
          </button>
          <button
            class="chart-tool-button chart-tool-clear relative w-7.5 min-h-7 inline-flex items-center justify-center p-0 rounded-[4px] text-[length:11px] font-bold whitespace-nowrap"
            type="button"
            data-testid="drawing-clear"
            :aria-label="t('chart.clearDrawings')"
            :title="t('chart.clearDrawings')"
            :disabled="!drawings.length || isLocked"
            @click="clearDrawings"
          >
            <X :size="16" aria-hidden="true" />
          </button>
        </div>
      </div>

      <div
        v-if="showTools && contextMenuPosition"
        ref="contextMenuElement"
        class="chart-context-menu absolute z-[8] min-w-42 [box-shadow:0_18px_36px_rgba(0,_0,_0,_0.36)] [backdrop-filter:blur(10px)]"
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
          :aria-label="t('chart.deleteAllDrawings')"
          :disabled="!drawings.length || isLocked"
          @click="clearDrawingsFromContextMenu"
        >
          <Trash2 :size="15" aria-hidden="true" />
          <span>{{ t('chart.deleteAllDrawings') }}</span>
        </button>
      </div>

      <p v-if="activeTool || toolFeedback" class="drawing-hint" role="status" aria-live="polite">
        {{ toolFeedback || drawingHint }}
      </p>
      <p v-if="measurementSummary" class="measurement-readout inline-flex items-center gap-2" role="status" aria-live="polite">
        {{ measurementSummary }}
        <button type="button" class="measurement-clear inline-flex items-center justify-center w-5.5 h-5.5 p-0 rounded-[4px] bg-transparent cursor-pointer" :aria-label="t('chart.clearMeasurement')" @click="clearMeasurement">
          <X :size="14" aria-hidden="true" />
        </button>
      </p>
    </div>
  </section>
</template>
