<script setup lang="ts">
import { computed, defineAsyncComponent, onBeforeUnmount, onMounted, reactive, ref, shallowRef, watch } from 'vue'
import {
  FolderOpen,
  FolderPlus,
  Maximize2,
  Minimize2,
  Pause,
  Play,
  RefreshCw,
  ServerCog,
  SlidersHorizontal,
  TrendingDown,
  TrendingUp,
  X,
} from '@lucide/vue'
import BrandMark from './components/BrandMark.vue'
import ChartLoadState from './components/ChartLoadState.vue'
import TimeframeSwitcher from './components/TimeframeSwitcher.vue'
import WorkspaceSettings from './components/WorkspaceSettings.vue'
import { t, timeframeLabel, TIMEFRAMES } from './i18n'
import { loadShortcuts, shortcutActions, shortcutStorageKey, type ShortcutBindings } from './shortcuts'
import { hasStorageUser, scopedStorageKey, setStorageUser } from './userStorage'
import { stochVisibilityKey } from './stoch'

const props = defineProps<{ userId?: string; initialView?: AppView }>()
setStorageUser(props.userId)

const workspaceSettings = ref<InstanceType<typeof WorkspaceSettings> | null>(null)
const settingsOpen = ref(false)
const mobileConsoleOpen = ref(false)
const shortcutBindings = ref(loadShortcuts())
const candleColors = ref(loadCandleColors())
const CANDLE_COLORS_KEY = 'btcusd.candle-colors.v1'
function loadCandleColors() {
  try {
    const value = JSON.parse(localStorage.getItem(scopedStorageKey(CANDLE_COLORS_KEY)) ?? 'null')
    if (value && /^#[0-9a-f]{6}$/i.test(value.up) && /^#[0-9a-f]{6}$/i.test(value.down) && typeof value.hollow === 'boolean') return { up: value.up as string, down: value.down as string, hollow: value.hollow as boolean }
  } catch { /* Use default colors when browser storage is unavailable. */ }
  return { up: '#ffffff', down: '#ffffff', hollow: true }
}
function updateShortcuts(value: ShortcutBindings) {
  try { localStorage.setItem(scopedStorageKey(shortcutStorageKey), JSON.stringify(value)) }
  catch { setNotice(t('app.storageUnavailable')) }
  shortcutBindings.value = value
}
function updateCandleColors(value: { up: string; down: string; hollow: boolean }) {
  try { localStorage.setItem(scopedStorageKey(CANDLE_COLORS_KEY), JSON.stringify(value)) }
  catch { setNotice(t('app.storageUnavailable')) }
  candleColors.value = value
}

const MarketChart = defineAsyncComponent({
  loader: () => import('./components/MarketChart.vue'),
  loadingComponent: ChartLoadState,
  errorComponent: ChartLoadState,
  delay: 0,
  timeout: 30_000,
})
import { getMarketMetadata, getMarketSnapshot, listProjects, saveProject } from './api'
import { fromUtcInput, formatNumber, formatUtc } from './format'
import {
  applyManualTrade,
  clampReplayCursor,
  closeManualPosition,
  createReplayDraft,
  createReplayProjectFromDraft,
  createSeedReplayProject,
  clearLegacyReplayProjects,
  draftFromProject,
  loadActiveReplayProjectId,
  loadLegacyReplayProjects,
  normalizeReplayProjectList,
  assignReplayPaneTimeframe,
  loadReplayProjects,
  nextReplayPaneTimeframe,
  nextReplayWindowStart,
  normalizeReplayPanes,
  normalizeSpeed,
  MAX_REPLAY_PANES,
  projectRangeLabel,
  reanchorManualTrades,
  reconcileReplayProject,
  replayBucketStart,
  replayPaneClock,
  replayCursorIndexAtOrBefore,
  replayCursorIndexAtOrAfter,
  replayPaneNeedsReload,
  replayPaneWindow,
  replayWindowEnd,
  replayWindowRange,
  REPLAY_PAGE_SIZE,
  REPLAY_TIMEFRAMES,
  replayDelayMs,
  replayProgressLabel,
  saveActiveReplayProjectId,
  saveReplayProjects,
  shouldPrefetchReplay,
  summarizeManualTrades,
  timeframeStepSeconds,
  type ManualTradeAction,
  type ManualTradeSide,
  type ReplayProject,
  type ReplayProjectDraft,
  type ReplayDrawing,
  type ReplayWindowRange,
} from './replay'
import type { Candle, MarketMetadata, MarketSnapshot } from './types'

type AppView = 'projects' | 'replay'

interface ReplayPaneState {
  projectId: string
  timeframe: string
  snapshot: MarketSnapshot | null
  range: ReplayWindowRange | null
  loading: boolean
  error: string
  requestId: number
  formingBucket: number | null
  forming: Candle | null
  formingRequestId: number
  formingClock: number | null
}

const VIEW_KEY = 'btcusd.workspace.view.v2'
const replayLengths: [number, number, number] = [30, 120, 840]

const timeframeLabels = computed<Record<string, string>>(() =>
  Object.fromEntries(TIMEFRAMES.map((value) => [value, timeframeLabel(value)])),
)

const metadata = ref<MarketMetadata | null>(null)
const projects = ref<ReplayProject[]>([])
const activeProjectId = ref('')
const replaySnapshot = shallowRef<MarketSnapshot | null>(null)
const replayLoading = ref(true)
const replayError = ref('')
const replayWindowLoading = ref(false)
const replayWindowError = ref('')
const replayNextFrom = ref<number | null>(null)
const secondaryPanes = ref<ReplayPaneState[]>([])
let replayPaneRequestId = 0
const notice = ref('')
const pageError = ref('')
const projectError = ref('')
const syncError = ref('')
const legacyImportCandidates = ref<ReplayProject[] | null>(null)
const importBusy = ref(false)
const activeView = ref<AppView>('projects')
const playbackPlaying = ref(false)
const isReplayFullscreen = ref(false)

const projectDraft = reactive<ReplayProjectDraft>(createReplayDraft(null))
const marketChartRef = ref<{ activateTrendLine: () => void } | null>(null)

let snapshotRequestId = 0
let snapshotProjectKey = ''
let metadataPending = true
let initializationId = 0
let localStateRestored = false
let disposed = false
let playbackTimer: number | null = null

const activeProject = computed(() => projects.value.find((project) => project.id === activeProjectId.value) ?? null)
const totalReplayCandles = computed(() => replaySnapshot.value?.candles.length ?? 0)
const replayHasMore = computed(() => {
  const project = activeProject.value
  return Boolean(project && replayNextFrom.value !== null && replayNextFrom.value < project.to)
})
const activePlaybackIndex = computed(() => clampReplayCursor(activeProject.value?.cursorIndex ?? 0, totalReplayCandles.value))
const chartPlaybackIndex = computed(() => {
  if (activeView.value === 'replay') {
    return activePlaybackIndex.value
  }
  return totalReplayCandles.value > 0 ? totalReplayCandles.value - 1 : 0
})
const currentCandle = computed(() => replaySnapshot.value?.candles[activePlaybackIndex.value] ?? null)
const currentTimeLabel = computed(() => currentCandle.value ? `${formatUtc(currentCandle.value.timestamp)} UTC` : '—')
// Phones show the compact date-time without the year and UTC suffix.
const currentTimeShortLabel = computed(() => currentCandle.value ? formatUtc(currentCandle.value.timestamp).slice(5) : '—')
const currentProjectLabel = computed(() => activeProject.value?.name ?? t('app.untitledProject'))
const currentRangeLabel = computed(() => activeProject.value ? projectRangeLabel(activeProject.value) : '—')
const currentProgressLabel = computed(() => activeProject.value
  ? replayProgressLabel(activeProject.value, replaySnapshot.value?.candles ?? [])
  : '0 / 0')
const replayStatusLabel = computed(() => {
  if (!activeProject.value) return t('app.notSelected')
  if (replayLoading.value) return t('app.loading')
  if (replayWindowLoading.value) return t('app.marketLoading')
  if (replayWindowError.value) return t('app.marketFailed')
  return playbackPlaying.value ? t('app.playing') : t('app.paused')
})
const appStatusLabel = computed(() => {
  if (activeView.value === 'replay') return replayStatusLabel.value
  return t('app.library')
})
const activeError = computed(() => {
  if (activeView.value === 'replay') {
    return replayError.value || pageError.value
  }
  return pageError.value
})
const manualTradeStats = computed(() => summarizeManualTrades(
  activeProject.value?.trades ?? [],
  currentCandle.value?.close ?? null,
  activePlaybackIndex.value,
))
const positionLabel = computed(() => {
  const stats = manualTradeStats.value
  if (stats.side === 'flat') return t('app.flat')
  return `${stats.side === 'long' ? t('app.long') : t('app.short')} ${stats.quantity}`
})
const canPlaceManualTrade = computed(() => Boolean(
  activeProject.value && currentCandle.value && !replayLoading.value && !replayError.value,
))
const canCloseManualTrade = computed(() => Boolean(
  canPlaceManualTrade.value && manualTradeStats.value.side !== 'flat',
))
const currentTimeframeValue = computed(() => activeProject.value?.timeframe ?? projectDraft.timeframe)
const replayPaneCount = computed(() => Math.min(activeProject.value?.panes.length ?? 1, MAX_REPLAY_PANES))
const timeframeOptions = computed(() => {
  const supported = metadata.value?.supported_timeframes ?? TIMEFRAMES
  return supported.filter((value) => TIMEFRAMES.includes(value))
})
const projectFormError = computed(() => {
  if (!projectDraft.name.trim()) return t('app.formName')
  if (!projectDraft.symbol.trim()) return t('app.formSymbol')
  if (!projectDraft.timeframe.trim()) return t('app.formTimeframe')
  const from = fromUtcInput(projectDraft.fromInput)
  const to = fromUtcInput(projectDraft.toInput)
  if (!Number.isFinite(from) || !Number.isFinite(to)) return t('app.formTime')
  if (from >= to) return t('app.formRange')
  return ''
})
const projectActionLabel = computed(() => activeProject.value ? t('app.saveAndOpen') : t('app.createAndOpen'))

function loadAppView(): AppView {
  if (typeof window === 'undefined') return 'projects'
  const value = window.localStorage.getItem(scopedStorageKey(VIEW_KEY))
  return value === 'replay' || value === 'projects' ? value : 'projects'
}

function saveAppView(value: AppView) {
  if (typeof window === 'undefined') return
  window.localStorage.setItem(scopedStorageKey(VIEW_KEY), value)
}

function setNotice(message: string) {
  notice.value = message
}

function updateProjectDrawings(drawings: ReplayDrawing[]) {
  const project = activeProject.value
  if (!project) return
  updateProject({
    ...project,
    drawings,
    updatedAt: new Date().toISOString(),
  })
  setNotice(t('app.drawingsSaved'))
}

function syncDraftFromProject(project: ReplayProject) {
  Object.assign(projectDraft, draftFromProject(project))
}

function persistProjectsState() {
  saveReplayProjects(projects.value)
  saveActiveReplayProjectId(activeProjectId.value)
}

// Local storage is a per-user cache; the server copy is what follows the user
// across devices. Playback moves the cursor every tick, so sync is coalesced.
const PROJECT_SYNC_DELAY = 1200
const PROJECT_SYNC_MAX_WAIT = 10_000
const pendingProjectSaves = new Map<string, ReplayProject>()
const projectSyncTimers = new Map<string, number>()
const projectSyncQueuedAt = new Map<string, number>()

// Keep a stale cached cursor inside the project range so the server accepts it.
function serverProject(project: ReplayProject): ReplayProject {
  if (project.cursorTimestamp === undefined) return project
  const cursorTimestamp = Math.min(Math.max(project.cursorTimestamp, project.from), project.to)
  return cursorTimestamp === project.cursorTimestamp ? project : { ...project, cursorTimestamp }
}

function queueProjectSync(project: ReplayProject, immediate = false) {
  if (!hasStorageUser()) return
  pendingProjectSaves.set(project.id, serverProject(project))
  if (!projectSyncQueuedAt.has(project.id)) projectSyncQueuedAt.set(project.id, Date.now())
  const pendingTimer = projectSyncTimers.get(project.id)
  if (pendingTimer !== undefined) window.clearTimeout(pendingTimer)
  const overdue = Date.now() - (projectSyncQueuedAt.get(project.id) ?? Date.now()) >= PROJECT_SYNC_MAX_WAIT
  projectSyncTimers.set(project.id, window.setTimeout(
    () => { void flushProjectSync(project.id) },
    immediate || overdue ? 0 : PROJECT_SYNC_DELAY,
  ))
}

async function flushProjectSync(id: string, keepalive = false) {
  const timer = projectSyncTimers.get(id)
  if (timer !== undefined) window.clearTimeout(timer)
  projectSyncTimers.delete(id)
  projectSyncQueuedAt.delete(id)
  const project = pendingProjectSaves.get(id)
  pendingProjectSaves.delete(id)
  if (!project) return
  try {
    await saveProject(project, { keepalive })
    syncError.value = ''
  } catch {
    syncError.value = t('app.syncPending')
  }
}

function flushPendingProjectSync(keepalive = false) {
  for (const id of [...pendingProjectSaves.keys()]) void flushProjectSync(id, keepalive)
}

function updateProject(project: ReplayProject) {
  projects.value = projects.value.map((current) => (current.id === project.id ? project : current))
  persistProjectsState()
  queueProjectSync(project)
}

function reconcileProjectWithMarket(project: ReplayProject): { project: ReplayProject; changed: boolean } {
  if (!metadata.value) return { project, changed: false }
  const aligned = reconcileReplayProject(project, metadata.value)
  return { project: aligned, changed: aligned !== project }
}

function marketAlignmentNotice(project: ReplayProject): string {
  return t('app.marketAligned', { range: projectRangeLabel(project) })
}

function alignProjectToMarket(project: ReplayProject): { project: ReplayProject; changed: boolean } {
  const { project: aligned, changed } = reconcileProjectWithMarket(project)
  if (!changed) return { project, changed: false }
  projects.value = projects.value.map((current) => (current.id === project.id ? aligned : current))
  saveReplayProjects(projects.value)
  queueProjectSync(aligned)
  return { project: aligned, changed: true }
}

function updateProjectCursor(projectId: string, cursorIndex: number, cursorTimestamp?: number) {
  const current = projects.value.find((project) => project.id === projectId)
  if (!current) return
  updateProject({
    ...current,
    cursorIndex,
    cursorTimestamp: typeof cursorTimestamp === 'number' && Number.isFinite(cursorTimestamp)
      ? Math.floor(cursorTimestamp)
      : current.cursorTimestamp,
    updatedAt: new Date().toISOString(),
  })
}

function reanchorProjectTrades(projectId: string, candles: MarketSnapshot['candles']) {
  const current = projects.value.find((project) => project.id === projectId)
  if (!current?.trades.length) return
  const trades = reanchorManualTrades(current.trades, candles)
  if (trades === current.trades) return
  updateProject({ ...current, trades, updatedAt: new Date().toISOString() })
}

function updateActiveProjectSpeed(speed: number) {
  if (!activeProject.value) return
  const normalized = normalizeSpeed(speed)
  projectDraft.speed = normalized
  updateProject({
    ...activeProject.value,
    speed: normalized,
    updatedAt: new Date().toISOString(),
  })
}

function changePlaybackSpeed(event: Event) {
  const input = event.target as HTMLInputElement
  updateActiveProjectSpeed(input.valueAsNumber)
}

function clearPlaybackTimer() {
  if (playbackTimer !== null) {
    window.clearInterval(playbackTimer)
    playbackTimer = null
  }
}

function pausePlayback() {
  if (playbackPlaying.value) flushPendingProjectSync()
  playbackPlaying.value = false
}

function syncReplayFullscreen() {
  if (typeof document === 'undefined') return
  isReplayFullscreen.value = Boolean(document.fullscreenElement)
}

async function exitReplayFullscreen() {
  if (typeof document !== 'undefined' && document.fullscreenElement) {
    try {
      await document.exitFullscreen()
    } catch {
      // Keep the CSS fallback state in sync when the browser rejects the exit.
    }
  }
  isReplayFullscreen.value = false
}

async function toggleReplayFullscreen() {
  if (activeView.value !== 'replay' || typeof document === 'undefined') return
  if (isReplayFullscreen.value || document.fullscreenElement) {
    await exitReplayFullscreen()
    return
  }

  isReplayFullscreen.value = true
  try {
    await document.documentElement.requestFullscreen?.()
  } catch {
    // The app-level immersive layout remains available as a CSS fallback.
  }
}

function setPlaybackCursor(index: number, shouldPause = true) {
  const project = activeProject.value
  const total = totalReplayCandles.value
  if (!project || total <= 0) return
  const cursorIndex = clampReplayCursor(index, total)
  updateProjectCursor(project.id, cursorIndex, replaySnapshot.value?.candles[cursorIndex]?.timestamp)
  if (shouldPause) {
    pausePlayback()
  }
}

function changeReplayTimeframeTo(timeframe: string, panes?: string[]) {
  const project = activeProject.value
  if (!project || !timeframe || project.timeframe === timeframe) return

  pausePlayback()
  projectDraft.timeframe = timeframe
  const cursorTimestamp = currentCandle.value?.timestamp ?? project.cursorTimestamp

  const defaultProjectName = `${project.symbol} ${project.timeframe} Replay`
  const nextDraft: ReplayProjectDraft = {
    ...draftFromProject(project),
    name: project.name === defaultProjectName ? `${project.symbol} ${timeframe} Replay` : project.name,
    timeframe,
  }
  const nextProject = {
    ...createReplayProjectFromDraft(nextDraft, project),
    panes: normalizeReplayPanes(panes ?? [timeframe, ...project.panes.slice(1)], timeframe),
    cursorIndex: 0,
    cursorTimestamp,
  }

  updateProject(nextProject)
  syncDraftFromProject(nextProject)
  const nextTimeframeLabel = timeframeLabels.value[timeframe] ?? timeframe
  if (metadataPending) return
  void loadReplaySnapshot(nextProject, {
    cursorTimestamp,
    notice: cursorTimestamp
      ? t('app.timeframeSwitchedKept', { label: nextTimeframeLabel, time: formatUtc(cursorTimestamp) })
      : t('app.timeframeSwitched', { label: nextTimeframeLabel }),
  })
}

function changeReplayPaneTimeframe(index: number, event: Event) {
  const project = activeProject.value
  if (!project) return
  const timeframe = (event.target as HTMLSelectElement).value
  const panes = assignReplayPaneTimeframe(project.panes, index, timeframe)
  if (panes.join(',') === project.panes.join(',')) return
  if (panes[0] !== project.panes[0]) {
    changeReplayTimeframeTo(panes[0], panes)
    return
  }
  updateReplayPanes(panes)
}

function paneCursorTimestamp(): number | null {
  const candle = currentCandle.value
  if (candle) return candle.timestamp
  const project = activeProject.value
  return typeof project?.cursorTimestamp === 'number' ? project.cursorTimestamp : null
}

// The replay clock is the close of the candle under the replay cursor. Panes may only render
// candles that already closed by then, otherwise they would reveal not-yet-played prices.
function paneClockTimestamp(): number | null {
  const project = activeProject.value
  const candles = replaySnapshot.value?.candles ?? []
  if (!project || !candles.length) return null
  return replayPaneClock(
    candles,
    activePlaybackIndex.value,
    timeframeStepSeconds(project.timeframe),
    project.to,
  )
}

async function loadReplayPane(pane: ReplayPaneState, project: ReplayProject, anchorTimestamp: number): Promise<void> {
  const requestId = ++replayPaneRequestId
  pane.requestId = requestId
  pane.loading = true
  pane.error = ''
  pane.formingRequestId += 1
  pane.formingBucket = null
  pane.forming = null
  pane.formingClock = null
  const range = replayPaneWindow(anchorTimestamp, project, pane.timeframe)
  let loaded = false
  try {
    const snapshot = await getMarketSnapshot({
      timeframe: pane.timeframe,
      from: range.from,
      to: range.to,
      limit: range.limit,
      lengths: replayLengths,
    })
    if (pane.requestId !== requestId) return
    loaded = true
    const anchor = paneCursorTimestamp()
    if (anchor === null || replayPaneNeedsReload(range, anchor)) return
    pane.snapshot = snapshot
    pane.range = range
    const clock = paneClockTimestamp()
    if (clock !== null) void refreshReplayPaneForming(pane, clock)
  } catch (caught) {
    if (pane.requestId !== requestId) return
    pane.error = caught instanceof Error ? caught.message : t('app.paneLoadFailed')
  } finally {
    if (pane.requestId === requestId) {
      pane.loading = false
      const anchor = paneCursorTimestamp()
      if (loaded && anchor !== null && replayPaneNeedsReload(range, anchor)) syncReplayPanes()
    }
  }
}

async function refreshReplayPaneForming(
  pane: ReplayPaneState,
  clockTimestamp: number,
): Promise<void> {
  const candles = pane.snapshot?.candles ?? []
  if (!candles.length) return

  // The candle still forming at the replay clock starts in the bucket that contains the last
  // played instant; the backend aggregates it from the data that closed by then.
  const bucket = replayBucketStart(clockTimestamp - 1, pane.timeframe)
  if (pane.formingClock !== null && clockTimestamp < pane.formingClock) pane.forming = null
  pane.formingClock = clockTimestamp
  if (clockTimestamp === replayBucketStart(clockTimestamp, pane.timeframe)) {
    // Invalidate a forming request that is still in flight for an earlier clock, otherwise its
    // partial aggregation would overwrite the completed candle of this bucket.
    pane.formingRequestId += 1
    pane.formingBucket = bucket
    pane.forming = candles.find((candle) => candle.timestamp === bucket) ?? null
    return
  }

  if (pane.formingBucket !== bucket) {
    // The bucket moved on: drop the previous forming candle before the new one arrives.
    pane.formingBucket = bucket
    pane.forming = null
  }
  const requestId = ++pane.formingRequestId
  try {
    const snapshot = await getMarketSnapshot({
      timeframe: pane.timeframe,
      from: bucket,
      to: clockTimestamp,
      limit: 1,
      lengths: replayLengths,
    })
    if (pane.formingRequestId !== requestId || paneClockTimestamp() !== clockTimestamp) return
    pane.forming = snapshot.candles.at(-1) ?? null
    pane.error = ''
  } catch (caught) {
    if (pane.formingRequestId !== requestId || paneClockTimestamp() !== clockTimestamp) return
    pane.error = caught instanceof Error ? caught.message : t('app.paneSyncFailed')
  }
}

function syncReplayPanes(): void {
  const project = activeProject.value
  if (activeView.value !== 'replay' || !project) {
    if (secondaryPanes.value.length) secondaryPanes.value = []
    return
  }
  const current = secondaryPanes.value
  secondaryPanes.value = project.panes.slice(1, MAX_REPLAY_PANES).map((timeframe, index) => {
    const candidate = current[index]
    const existing = candidate?.timeframe === timeframe && candidate.projectId === project.id ? candidate : undefined
    return existing ?? {
      projectId: project.id,
      timeframe,
      snapshot: null,
      range: null,
      loading: false,
      error: '',
      requestId: 0,
      formingBucket: null,
      forming: null,
      formingRequestId: 0,
      formingClock: null,
    }
  })
  const anchor = paneCursorTimestamp()
  if (anchor === null || replayLoading.value || !replaySnapshot.value) return
  const clock = paneClockTimestamp()
  for (const pane of secondaryPanes.value) {
    if (pane.loading) continue
    if (replayPaneNeedsReload(pane.range, anchor)) {
      void loadReplayPane(pane, project, anchor)
      continue
    }
    if (clock !== null) {
      void refreshReplayPaneForming(pane, clock)
    }
  }
}

function retryReplayPane(pane: ReplayPaneState): void {
  const project = activeProject.value
  const anchor = paneCursorTimestamp()
  if (!project || anchor === null) return
  void loadReplayPane(pane, project, anchor)
}

function updateReplayPanes(panes: string[]): void {
  const project = activeProject.value
  if (!project) return
  const next = normalizeReplayPanes(panes, project.timeframe)
  if (next.join(',') === project.panes.join(',')) return
  updateProject({ ...project, panes: next })
}

function changeReplayPaneCount(event: Event): void {
  const project = activeProject.value
  if (!project) return
  const requested = Number((event.target as HTMLSelectElement).value)
  if (!Number.isFinite(requested)) return
  const count = Math.min(Math.max(Math.floor(requested), 1), MAX_REPLAY_PANES)
  const panes = project.panes.slice(0, count)
  while (panes.length < count) panes.push(nextReplayPaneTimeframe(panes))
  updateReplayPanes(panes)
}

function removeReplayPane(index: number): void {
  const project = activeProject.value
  if (!project) return
  updateReplayPanes(project.panes.filter((_, position) => position !== index + 1))
}

function openProjects() {
  pausePlayback()
  void exitReplayFullscreen()
  activeView.value = 'projects'
}

function openReplay() {
  if (!activeProject.value) {
    activeView.value = 'projects'
    return
  }
  activeView.value = 'replay'
  ensureReplaySnapshot()
}

function replayProjectKey(project: ReplayProject): string {
  return JSON.stringify([project.id, project.timeframe, project.from, project.to])
}

function ensureReplaySnapshot(force = false) {
  const project = activeProject.value
  if (disposed || metadataPending || activeView.value !== 'replay' || !project) return
  if (!force && snapshotProjectKey === replayProjectKey(project)) return
  void loadReplaySnapshot(project)
}

function togglePlayback() {
  if (!activeProject.value || !replaySnapshot.value?.candles.length) return
  const playing = !playbackPlaying.value
  // There is no load-more button any more: pressing play again is how a failed
  // next-window load gets retried.
  if (playing && replayWindowError.value) replayWindowError.value = ''
  playbackPlaying.value = playing
}

function placeManualTrade(side: ManualTradeSide) {
  const project = activeProject.value
  const candle = currentCandle.value
  if (!project || !candle || !canPlaceManualTrade.value) return

  const next = applyManualTrade(project, {
    side,
    candleIndex: activePlaybackIndex.value,
    timestamp: candle.timestamp,
    price: candle.close,
  })
  updateProject(next)
  const action = next.trades.at(-1)?.action
  setNotice(t('app.tradeFilled', {
    side: side === 'buy' ? 'Buy' : 'Sell',
    price: formatNumber(candle.close),
    action: tradeActionLabel(action),
  }))
}

function closeManualTrade() {
  const project = activeProject.value
  const candle = currentCandle.value
  const side = manualTradeStats.value.side
  if (!project || !candle || side === 'flat' || !canCloseManualTrade.value) return

  const next = closeManualPosition(project, {
    candleIndex: activePlaybackIndex.value,
    timestamp: candle.timestamp,
    price: candle.close,
  })
  updateProject(next)
  const action = next.trades.at(-1)?.action
  setNotice(t('app.closeFilled', { price: formatNumber(candle.close), action: tradeActionLabel(action) }))
}

function isEditableShortcutTarget(target: EventTarget | null): boolean {
  if (typeof HTMLElement === 'undefined' || !(target instanceof HTMLElement)) return false
  return Boolean(
    target.isContentEditable ||
    target.closest('input, textarea, select, [contenteditable="true"]'),
  )
}

function handleReplayShortcut(event: KeyboardEvent) {
  if (
    settingsOpen.value ||
    activeView.value !== 'replay' ||
    event.defaultPrevented ||
    event.repeat ||
    event.isComposing ||
    event.ctrlKey ||
    event.metaKey ||
    event.altKey ||
    isEditableShortcutTarget(event.target)
  ) return

  const action = shortcutActions.find(item => shortcutBindings.value[item.id] === event.key.toLowerCase())?.id
  switch (action) {
    case 'forward':
      event.preventDefault()
      setPlaybackCursor(activePlaybackIndex.value + 1)
      break
    case 'backward':
      event.preventDefault()
      setPlaybackCursor(activePlaybackIndex.value - 1)
      break
    case 'play':
      event.preventDefault()
      togglePlayback()
      break
    case 'buy':
      event.preventDefault()
      placeManualTrade('buy')
      break
    case 'sell':
      event.preventDefault()
      placeManualTrade('sell')
      break
    case 'trend':
      event.preventDefault()
      marketChartRef.value?.activateTrendLine()
      break
    default:
      break
  }
}

function hideProjectIndicators(projectId: string) {
  try { localStorage.setItem(scopedStorageKey(stochVisibilityKey(projectId)), 'false') } catch { /* Storage may be disabled. */ }
}

function createProject() {
  projectError.value = ''
  try {
    const draftProject = createReplayProjectFromDraft(projectDraft)
    const { project, changed } = reconcileProjectWithMarket(draftProject)
    hideProjectIndicators(project.id)
    projects.value = [project, ...projects.value.filter((item) => item.id !== project.id)]
    activeProjectId.value = project.id
    saveActiveReplayProjectId(project.id)
    saveReplayProjects(projects.value)
    queueProjectSync(project, true)
    syncDraftFromProject(project)
    playbackPlaying.value = false
    openReplay()
    setNotice(changed ? marketAlignmentNotice(project) : t('app.projectCreated', { name: project.name }))
  } catch (caught) {
    projectError.value = caught instanceof Error ? caught.message : t('app.projectCreateFailed')
  }
}

function saveActiveProject() {
  const project = activeProject.value
  if (!project) {
    createProject()
    return
  }
  projectError.value = ''
  try {
    const draftProject = createReplayProjectFromDraft(projectDraft, project)
    const { project: next, changed } = reconcileProjectWithMarket(draftProject)
    projects.value = projects.value.map((item) => (item.id === next.id ? next : item))
    activeProjectId.value = next.id
    saveActiveReplayProjectId(next.id)
    saveReplayProjects(projects.value)
    queueProjectSync(next, true)
    syncDraftFromProject(next)
    playbackPlaying.value = false
    openReplay()
    setNotice(changed ? marketAlignmentNotice(next) : t('app.projectSaved', { name: next.name }))
  } catch (caught) {
    projectError.value = caught instanceof Error ? caught.message : t('app.projectSaveFailed')
  }
}

function selectProject(projectId: string) {
  const storedProject = projects.value.find((item) => item.id === projectId)
  if (!storedProject) return
  flushPendingProjectSync()
  const { project, changed } = alignProjectToMarket(storedProject)
  projectError.value = ''
  activeProjectId.value = project.id
  saveActiveReplayProjectId(project.id)
  syncDraftFromProject(project)
  playbackPlaying.value = false
  openReplay()
  if (changed) setNotice(`${marketAlignmentNotice(project)}${t('app.staleTradesCleared')}`)
}

function mergeMarketSnapshots(current: MarketSnapshot, incoming: MarketSnapshot): MarketSnapshot {
  const candles = new Map(current.candles.map((candle) => [candle.timestamp, candle]))
  for (const candle of incoming.candles) {
    candles.set(candle.timestamp, candle)
  }
  return {
    ...current,
    candles: [...candles.values()].sort((left, right) => left.timestamp - right.timestamp),
  }
}

function nextReplayRequestFrom(snapshot: MarketSnapshot, project: ReplayProject, requestedTo: number): number | null {
  const nextFrom = nextReplayWindowStart(
    snapshot.candles.at(-1)?.timestamp,
    project.timeframe,
    requestedTo,
  )
  return nextFrom < project.to ? nextFrom : null
}

const replayHistoryBefore = ref<number | null>(null)
const replayHistoryLoading = ref(false)
const replayHistoryError = ref('')

async function loadReplayHistory() {
  const project = activeProject.value
  const before = replayHistoryBefore.value
  if (!project || before === null || replayHistoryLoading.value || replayLoading.value) return
  const requestId = snapshotRequestId
  const from = Math.max(project.from, before - timeframeStepSeconds(project.timeframe) * 500)
  replayHistoryLoading.value = true
  replayHistoryError.value = ''
  try {
    const page = await getMarketSnapshot({
      timeframe: project.timeframe, from, to: before, limit: 501, lengths: replayLengths,
    })
    if (requestId !== snapshotRequestId || !replaySnapshot.value) return
    const timestamp = currentCandle.value?.timestamp
    const merged = mergeMarketSnapshots(replaySnapshot.value, page)
    replaySnapshot.value = merged
    replayHistoryBefore.value = from > project.from ? from : null
    reanchorProjectTrades(project.id, merged.candles)
    if (timestamp !== undefined) {
      updateProjectCursor(project.id, replayCursorIndexAtOrBefore(merged.candles, timestamp), timestamp)
    }
  } catch (caught) {
    if (requestId === snapshotRequestId) {
      replayHistoryError.value = caught instanceof Error ? caught.message : t('app.historyFailed')
    }
  } finally {
    if (requestId === snapshotRequestId) replayHistoryLoading.value = false
  }
}

const jumpTimeInput = ref('')
const jumpError = ref('')

function jumpToCandle() {
  const project = activeProject.value
  if (!project || replayLoading.value) return
  const timestamp = fromUtcInput(jumpTimeInput.value)
  if (!Number.isFinite(timestamp)) {
    jumpError.value = t('app.formTime')
    return
  }
  jumpError.value = ''
  pausePlayback()
  const next = {
    ...project,
    from: Math.min(project.from, timestamp),
    to: Math.max(project.to, timestamp + timeframeStepSeconds(project.timeframe)),
  }
  if (next.from !== project.from || next.to !== project.to) {
    updateProject(next)
    syncDraftFromProject(next)
  }
  void loadReplaySnapshot(next, { cursorTimestamp: timestamp })
}

async function loadReplaySnapshot(
  project: ReplayProject,
  options: { cursorTimestamp?: number; notice?: string } = {},
) {
  snapshotProjectKey = replayProjectKey(project)
  const requestId = ++snapshotRequestId
  for (const pane of secondaryPanes.value) {
    pane.requestId = ++replayPaneRequestId
    pane.formingRequestId += 1
    pane.loading = false
    pane.snapshot = null
    pane.range = null
    pane.formingBucket = null
    pane.forming = null
    pane.formingClock = null
    pane.error = ''
  }
  replayLoading.value = true
  replayError.value = ''
  replayWindowLoading.value = false
  replayWindowError.value = ''
  replayNextFrom.value = null
  replaySnapshot.value = null
  replayHistoryBefore.value = null
  replayHistoryLoading.value = false
  replayHistoryError.value = ''

  try {
    const step = timeframeStepSeconds(project.timeframe)
    const requestedCursorTimestamp = options.cursorTimestamp ?? project.cursorTimestamp
    const hasCursorTimestamp = typeof requestedCursorTimestamp === 'number' && Number.isFinite(requestedCursorTimestamp)
    const boundedCursorTimestamp = hasCursorTimestamp
      ? Math.min(Math.max(requestedCursorTimestamp as number, project.from), Math.max(project.from, project.to - step))
      : null
    const windowRange = replayWindowRange(boundedCursorTimestamp ?? project.from, project)
    const snapshot = await getMarketSnapshot({
      timeframe: project.timeframe,
      from: windowRange.from,
      to: windowRange.to,
      limit: windowRange.limit,
      lengths: replayLengths,
    })
    if (requestId !== snapshotRequestId) return
    replayHistoryBefore.value = windowRange.from > project.from ? windowRange.from : null
    replaySnapshot.value = snapshot
    replayNextFrom.value = nextReplayRequestFrom(snapshot, project, windowRange.to)
    if (snapshot.candles.length) {
      const clamped = boundedCursorTimestamp === null
        ? replayCursorIndexAtOrAfter(snapshot.candles, project.from)
        : replayCursorIndexAtOrBefore(snapshot.candles, boundedCursorTimestamp)
      const mappedTimestamp = snapshot.candles[clamped]?.timestamp
      reanchorProjectTrades(project.id, snapshot.candles)
      if (clamped !== project.cursorIndex || mappedTimestamp !== project.cursorTimestamp) {
        updateProjectCursor(project.id, clamped, mappedTimestamp)
      }
    }
    setNotice(options.notice ?? t('app.snapshotLoaded', {
      name: project.name,
      count: snapshot.candles.length,
      timeframe: project.timeframe,
    }))
  } catch (caught) {
    if (requestId !== snapshotRequestId) return
    replayError.value = caught instanceof Error ? caught.message : t('app.replayFailed')
  } finally {
    if (requestId === snapshotRequestId) {
      replayLoading.value = false
    }
  }
}

async function loadMoreReplay() {
  const project = activeProject.value
  const from = replayNextFrom.value
  if (
    !project ||
    from === null ||
    from >= project.to ||
    replayWindowLoading.value ||
    replayWindowError.value
  ) return

  const requestId = snapshotRequestId
  const projectId = project.id
  const requestedTo = replayWindowEnd(from, project.to, project.timeframe)
  replayWindowLoading.value = true

  try {
    const snapshot = await getMarketSnapshot({
      timeframe: project.timeframe,
      from,
      to: requestedTo,
      limit: REPLAY_PAGE_SIZE,
      lengths: replayLengths,
    })
    if (requestId !== snapshotRequestId || activeProject.value?.id !== projectId) return
    const currentSnapshot = replaySnapshot.value
    const previousLastTimestamp = currentSnapshot?.candles.at(-1)?.timestamp
    const incomingLastTimestamp = snapshot.candles.at(-1)?.timestamp
    const mergedSnapshot = currentSnapshot
      ? mergeMarketSnapshots(currentSnapshot, snapshot)
      : snapshot
    const hasNewCandles = Boolean(
      snapshot.candles.length &&
      incomingLastTimestamp !== undefined &&
      (previousLastTimestamp === undefined || incomingLastTimestamp > previousLastTimestamp) &&
      mergedSnapshot.candles.length > (currentSnapshot?.candles.length ?? 0),
    )
    const nextFrom = nextReplayRequestFrom(mergedSnapshot, project, requestedTo)
    if (!hasNewCandles || (nextFrom !== null && nextFrom <= from)) {
      replayWindowError.value = t('app.noNewCandles')
      if (playbackPlaying.value) pausePlayback()
      return
    }
    replaySnapshot.value = mergedSnapshot
    replayNextFrom.value = nextFrom
    replayWindowError.value = ''
    setNotice(t('app.moreLoaded', { count: snapshot.candles.length, timeframe: project.timeframe }))
  } catch (caught) {
    if (requestId === snapshotRequestId && activeProject.value?.id === projectId) {
      replayWindowError.value = caught instanceof Error ? caught.message : t('app.moreFailed')
      if (playbackPlaying.value) pausePlayback()
    }
  } finally {
    if (requestId === snapshotRequestId && activeProject.value?.id === projectId) {
      replayWindowLoading.value = false
    }
  }
}

async function uploadLocalProjects(list: ReplayProject[]) {
  try {
    for (const project of list) await saveProject(serverProject(project))
    syncError.value = ''
  } catch {
    syncError.value = t('app.syncPending')
  }
}

async function restoreServerProjects(requestId: number) {
  if (!hasStorageUser()) return
  let remote: ReplayProject[]
  try {
    remote = normalizeReplayProjectList(await listProjects())
  } catch {
    // Offline or the service is unavailable: keep the per-user local cache.
    return
  }
  if (disposed || requestId !== initializationId) return

  const legacy = loadLegacyReplayProjects()
  if (legacy.length) legacyImportCandidates.value = legacy

  if (remote.length) {
    projects.value = remote
    const storedActive = loadActiveReplayProjectId()
    const active = remote.find((project) => project.id === storedActive) ?? remote[0]
    activeProjectId.value = active?.id ?? ''
    saveActiveReplayProjectId(activeProjectId.value)
    saveReplayProjects(remote)
    if (active) syncDraftFromProject(active)
  } else if (projects.value.length) {
    // The server has no copy yet; this scoped cache belongs to this user.
    await uploadLocalProjects(projects.value)
  }
}

function seedProjectIfEmpty() {
  if (projects.value.length || legacyImportCandidates.value || !metadata.value) return
  const seed = createSeedReplayProject(metadata.value)
  hideProjectIndicators(seed.id)
  projects.value = [seed]
  activeProjectId.value = seed.id
  persistProjectsState()
  queueProjectSync(seed, true)
  syncDraftFromProject(seed)
}

async function importLegacyProjects() {
  const candidates = legacyImportCandidates.value
  if (!candidates?.length || importBusy.value) return
  importBusy.value = true
  try {
    const imported: ReplayProject[] = []
    for (const project of candidates) imported.push(await saveProject(serverProject(project)))
    const importedIds = new Set(imported.map((project) => project.id))
    const merged = normalizeReplayProjectList([
      ...imported,
      ...projects.value.filter((project) => !importedIds.has(project.id)),
    ])
    projects.value = merged
    const active = merged.find((project) => project.id === activeProjectId.value) ?? merged[0]
    activeProjectId.value = active?.id ?? ''
    saveActiveReplayProjectId(activeProjectId.value)
    saveReplayProjects(merged)
    if (active) syncDraftFromProject(active)
    clearLegacyReplayProjects()
    legacyImportCandidates.value = null
    syncError.value = ''
    setNotice(t('app.legacyImported', { count: imported.length }))
    seedProjectIfEmpty()
  } catch {
    syncError.value = t('app.legacyImportFailed')
  } finally {
    importBusy.value = false
  }
}

function discardLegacyProjects() {
  clearLegacyReplayProjects()
  legacyImportCandidates.value = null
  seedProjectIfEmpty()
}

async function initialize() {
  const requestId = ++initializationId
  pageError.value = ''
  metadataPending = true
  if (!localStateRestored) {
    localStateRestored = true
    projects.value = loadReplayProjects()
    const storedActive = loadActiveReplayProjectId()
    const active = projects.value.find((project) => project.id === storedActive) ?? projects.value[0]
    activeProjectId.value = active?.id ?? ''
    if (active) saveActiveReplayProjectId(active.id)
    activeView.value = props.initialView
      ?? (new URLSearchParams(window.location.search).get('auth') === '1' ? 'projects' : loadAppView())
    if (active) syncDraftFromProject(active)
  }
  await restoreServerProjects(requestId)
  if (disposed || requestId !== initializationId) return
  try {
    const market = await getMarketMetadata()
    if (disposed || requestId !== initializationId) return
    metadata.value = market
    if (!projects.value.length) {
      seedProjectIfEmpty()
    } else if (activeProject.value) {
      const { project, changed } = alignProjectToMarket(activeProject.value)
      if (changed) {
        syncDraftFromProject(project)
        setNotice(`${marketAlignmentNotice(project)}${t('app.staleTradesCleared')}`)
      }
    }
  } catch (caught) {
    if (disposed || requestId !== initializationId) return
    pageError.value = caught instanceof Error ? caught.message : t('app.initFailed')
  } finally {
    if (!disposed && requestId === initializationId) {
      metadataPending = false
      if (!snapshotProjectKey) replayLoading.value = false
      ensureReplaySnapshot(Boolean(replayError.value))
    }
  }
}

function speedToText(speed: number): string {
  const value = Number.isFinite(speed) ? speed : 1
  return `x${value % 1 === 0 ? value.toFixed(0) : value.toFixed(2)}`
}

function tradeActionLabel(action: ManualTradeAction | undefined): string {
  if (action === 'open-long') return t('trade.openLong')
  if (action === 'close-long') return t('trade.closeLong')
  if (action === 'open-short') return t('trade.openShort')
  if (action === 'close-short') return t('trade.closeShort')
  return t('trade.recorded')
}

watch(activeView, (value) => {
  saveAppView(value)
  mobileConsoleOpen.value = false
  if (value !== 'replay') {
    playbackPlaying.value = false
  }
})

watch([playbackPlaying, () => activeProject.value?.speed, () => activeProjectId.value, () => totalReplayCandles.value], () => {
  clearPlaybackTimer()
  const project = activeProject.value
  if (activeView.value !== 'replay' || !playbackPlaying.value || !project || !replaySnapshot.value?.candles.length) return
  playbackTimer = window.setInterval(() => {
    const current = activeProject.value
    const total = totalReplayCandles.value
    if (!current || total <= 0) {
      pausePlayback()
      return
    }
    if (
      shouldPrefetchReplay(current.cursorIndex, total, replayHasMore.value) &&
      !replayWindowLoading.value &&
      !replayWindowError.value
    ) {
      void loadMoreReplay()
    }
    const nextIndex = current.cursorIndex + 1
    if (nextIndex >= total) {
      if (replayHasMore.value) {
        if (replayWindowLoading.value) return
        if (replayWindowError.value) {
          pausePlayback()
          return
        }
        void loadMoreReplay()
        return
      }
      pausePlayback()
      return
    }
    setPlaybackCursor(nextIndex, false)
  }, replayDelayMs(project.speed))
}, { immediate: true })

watch(
  [
    () => activeView.value,
    () => activeProject.value?.id ?? '',
    () => activeProject.value?.panes.join(',') ?? '',
    () => activeProject.value ? replayProjectKey(activeProject.value) : '',
    () => replayLoading.value,
    () => paneCursorTimestamp() ?? 0,
    () => paneClockTimestamp() ?? 0,
  ],
  () => { syncReplayPanes() },
  { immediate: true },
)

function flushOnPageHide() {
  flushPendingProjectSync(true)
}

function handleVisibilityChange() {
  if (document.visibilityState === 'hidden') flushPendingProjectSync(true)
}

onMounted(() => {
  document.addEventListener('fullscreenchange', syncReplayFullscreen)
  document.addEventListener('visibilitychange', handleVisibilityChange)
  window.addEventListener('keydown', handleReplayShortcut)
  window.addEventListener('pagehide', flushOnPageHide)
  void initialize()
})

onBeforeUnmount(() => {
  disposed = true
  initializationId += 1
  snapshotRequestId += 1
  clearPlaybackTimer()
  flushPendingProjectSync(true)
  document.removeEventListener('fullscreenchange', syncReplayFullscreen)
  document.removeEventListener('visibilitychange', handleVisibilityChange)
  window.removeEventListener('keydown', handleReplayShortcut)
  window.removeEventListener('pagehide', flushOnPageHide)
})
</script>

<template>
  <div
    class="app-shell"
    :class="{ 'replay-active': activeView === 'replay', 'replay-immersive': isReplayFullscreen }"
  >
    <WorkspaceSettings ref="workspaceSettings" :bindings="shortcutBindings" :colors="candleColors" @bindings="updateShortcuts" @colors="updateCandleColors" @opened="settingsOpen = $event" />
    <div
      v-if="legacyImportCandidates"
      class="fixed inset-0 z-[300] grid place-items-center p-4 [background:rgba(17,_24,_39,_0.42)] [backdrop-filter:blur(6px)]"
      role="dialog"
      aria-modal="true"
      aria-labelledby="legacy-import-title"
    >
      <section class="w-full max-w-[460px] [border:1px_solid_var(--border)] rounded-[12px] [background:var(--surface)] [padding:24px] [box-shadow:0_18px_48px_rgba(17,_24,_39,_0.18)]">
        <h2 id="legacy-import-title" class="[margin:0_0_8px] text-[16px] font-extrabold">{{ t('app.legacyTitle') }}</h2>
        <p class="[margin:0_0_18px] text-[color:var(--text-muted)] text-[13px] leading-[1.7]">{{ t('app.legacyBody', { count: legacyImportCandidates.length }) }}</p>
        <div class="flex justify-end gap-2">
          <button type="button" class="secondary-button inline-flex items-center justify-center gap-2 rounded-[var(--radius)] [padding:0_14px] [background:var(--surface-2)]" :disabled="importBusy" @click="discardLegacyProjects">
            {{ t('app.legacyDiscard') }}
          </button>
          <button type="button" class="primary-button inline-flex items-center justify-center gap-2 rounded-[var(--radius)] font-extrabold" :disabled="importBusy" @click="importLegacyProjects">
            {{ importBusy ? t('app.legacyImporting') : t('app.legacyImport') }}
          </button>
        </div>
      </section>
    </div>
    <header class="topbar top-0 z-[30] items-center justify-between [border-bottom:1px_solid_var(--border)] [background:rgba(255,_255,_255,_0.92)] [backdrop-filter:blur(12px)]">
      <a class="brand items-center no-underline" href="/" :aria-label="t('product.homeLabel')">
        <BrandMark />
        <span>
          <strong>grailab</strong>
          <small v-if="activeView === 'replay'">{{ currentTimeframeValue }} REPLAY</small>
        </span>
      </a>

      <div v-if="activeView === 'projects'" class="mode-switch inline-flex items-center gap-1.5 p-1 [border:1px_solid_var(--border)] rounded-full [background:var(--surface)]" role="tablist" :aria-label="t('app.workspaceMode')">
        <button
          type="button"
          class="mode-chip min-h-8.5 [padding:0_14px] rounded-full"
          :class="{ active: activeView === 'projects' }"
          :aria-pressed="activeView === 'projects'"
          @click="openProjects"
        >
          {{ t('app.tabProjects') }}
        </button>
        <button
          type="button"
          class="mode-chip min-h-8.5 [padding:0_14px] rounded-full"
          :aria-pressed="false"
          :disabled="!activeProject"
          @click="openReplay"
        >
          {{ t('app.tabReplay') }}
        </button>
      </div>

      <div v-if="activeView === 'replay'" class="replay-topbar-meta [flex:1_1_auto] gap-[1px] min-w-0" :aria-label="t('app.currentReplayProject')">
        <strong>{{ currentProjectLabel }}</strong>
        <span>{{ currentRangeLabel }}</span>
      </div>

      <div v-if="activeView === 'replay'" class="replay-topbar-status flex flex-none items-center" :aria-label="t('app.currentReplayStatus')">
        <span class="status-chip inline-flex items-center rounded-full whitespace-nowrap" :data-status="playbackPlaying ? 'running' : 'paused'">{{ replayStatusLabel }}</span>
        <span class="status-chip muted inline-flex items-center rounded-full whitespace-nowrap">{{ currentProgressLabel }}</span>
        <span class="status-chip muted inline-flex items-center rounded-full whitespace-nowrap">{{ positionLabel }}</span>
      </div>

      <div class="topbar-actions flex items-center">
        <button class="topbar-action min-h-8 inline-flex items-center gap-1.5 rounded-[var(--radius-sm)] text-[length:12px] font-extrabold whitespace-nowrap" type="button" :aria-label="t('app.settings')" @click="workspaceSettings?.open('settings')"><SlidersHorizontal :size="15" aria-hidden="true" /><span class="topbar-action-label">{{ t('app.settings') }}</span></button>
        <div v-if="activeView === 'projects'" class="service-state flex items-center gap-2 text-[color:var(--text-muted)] text-[length:13px] whitespace-nowrap">
          <span class="status-dot w-2 h-2 rounded-full [background:var(--profit)] [box-shadow:0_0_0_4px_rgba(22,_101,_52,_0.14)]" aria-hidden="true" />
          <span>{{ appStatusLabel }}</span>
        </div>

        <template v-else>
          <button class="topbar-action min-h-8 inline-flex items-center gap-1.5 rounded-[var(--radius-sm)] text-[length:12px] font-extrabold whitespace-nowrap" type="button" :aria-label="t('app.library')" @click="openProjects">
            <FolderOpen :size="15" aria-hidden="true" />
            <span class="topbar-action-label">{{ t('app.library') }}</span>
          </button>
          <button
            class="topbar-icon-button w-8 h-8 inline-grid place-items-center p-0 rounded-[var(--radius-sm)]"
            type="button"
            data-testid="replay-fullscreen"
            :aria-label="isReplayFullscreen ? t('app.exitFullscreen') : t('app.fullscreen')"
            :title="isReplayFullscreen ? t('app.exitFullscreen') : t('app.fullscreen')"
            @click="toggleReplayFullscreen"
          >
            <Minimize2 v-if="isReplayFullscreen" :size="16" aria-hidden="true" />
            <Maximize2 v-else :size="16" aria-hidden="true" />
          </button>
        </template>

      </div>
    </header>

    <main id="main-content" class="workspace [margin:0_auto] gap-4" :class="`workspace-${activeView}`" tabindex="-1">
      <p class="sr-only" aria-live="polite">{{ notice }}</p>

      <template v-if="activeView === 'projects'">
        <section class="workspace-head flex justify-between gap-5" aria-labelledby="page-title">
          <div class="workspace-copy">
            <p class="eyebrow text-[color:var(--info)] [font:700_10px/1.4_'Fira_Code',_ui-monospace,_SFMono-Regular,_Consolas,_monospace] tracking-[0]">PROJECT LIBRARY / UTC</p>
            <h1 id="page-title">{{ t('app.projectLibraryTitle') }}</h1>
            <p>{{ t('app.projectLibraryLead') }}</p>
          </div>
          <dl class="workspace-stats grid gap-[1px] [border:1px_solid_var(--border)] rounded-[var(--radius)] overflow-hidden">
            <div>
              <dt>{{ t('app.statProject') }}</dt>
              <dd>{{ currentProjectLabel }}</dd>
            </div>
            <div>
              <dt>{{ t('app.statRange') }}</dt>
              <dd>{{ currentRangeLabel }}</dd>
            </div>
            <div>
              <dt>{{ t('app.statProgress') }}</dt>
              <dd>{{ currentProgressLabel }}</dd>
            </div>
            <div>
              <dt>{{ t('app.statTrades') }}</dt>
              <dd>{{ activeProject?.trades.length ?? 0 }}</dd>
            </div>
          </dl>
        </section>

        <div v-if="activeError" class="alert error-alert flex items-center gap-2.5 [padding:12px_14px] [border:1px_solid_rgba(153,_27,_27,_0.32)] rounded-[var(--radius)] [background:#fff1f2] text-[color:var(--danger)]" role="alert">
          <ServerCog :size="20" aria-hidden="true" />
          <span>{{ activeError }}</span>
          <button type="button" class="text-button font-bold" @click="initialize">{{ t('common.retry') }}</button>
        </div>

        <p v-if="syncError" class="alert flex items-center gap-2.5 [padding:12px_14px] [border:1px_solid_var(--border)] rounded-[var(--radius)] [background:var(--surface-2)] text-[color:var(--text-muted)]" role="status">
          <ServerCog :size="18" aria-hidden="true" />
          <span>{{ syncError }}</span>
        </p>

        <div class="project-layout grid gap-4 items-start">
          <section class="panel project-form-panel" aria-labelledby="project-form-title">
            <div class="panel-head [padding:16px_16px_0]">
              <div>
                <p class="eyebrow text-[color:var(--info)] [font:700_10px/1.4_'Fira_Code',_ui-monospace,_SFMono-Regular,_Consolas,_monospace] tracking-[0]">SETUP</p>
                <h2 id="project-form-title">{{ t('app.newProject') }}</h2>
              </div>
              <FolderPlus :size="22" class="heading-icon text-[color:var(--text-dim)]" aria-hidden="true" />
            </div>

            <form class="project-form grid gap-3 [border-top:1px_solid_var(--border)] [border-bottom:1px_solid_var(--border)]" @submit.prevent="saveActiveProject">
              <label>
                {{ t('app.projectName') }}
                <input v-model="projectDraft.name" type="text" maxlength="120" autocomplete="off" />
              </label>
              <div class="field-grid two grid gap-2.5">
                <label>
                  {{ t('app.symbol') }}
                  <input v-model="projectDraft.symbol" type="text" autocomplete="off" />
                </label>
                <label>
                  {{ t('app.timeframe') }}
                  <select v-model="projectDraft.timeframe">
                    <option v-for="timeframe in timeframeOptions" :key="timeframe" :value="timeframe">
                      {{ timeframeLabels[timeframe] ?? timeframe }}
                    </option>
                  </select>
                </label>
              </div>
              <div class="field-grid two grid gap-2.5">
                <label>
                  {{ t('app.startTime') }}
                  <input v-model="projectDraft.fromInput" type="datetime-local" />
                </label>
                <label>
                  {{ t('app.endTime') }}
                  <input v-model="projectDraft.toInput" type="datetime-local" />
                </label>
              </div>
              <div class="field-grid two speed-field grid gap-2.5 items-end">
                <label>
                  {{ t('app.playbackSpeed') }}
                  <input v-model.number="projectDraft.speed" type="number" min="0.25" max="8" step="0.25" />
                </label>
                <div class="speed-hint min-h-10.5 inline-flex items-center gap-2.5 [padding:0_12px] [border:1px_solid_var(--border)] rounded-[var(--radius)] [background:var(--surface-2)] text-[color:var(--text-muted)] text-[length:12px]">
                  <span class="speed-icon w-7 h-7 grid place-items-center rounded-[var(--radius-sm)] [background:#ecfeff] text-[color:var(--info)] flex-none"><SlidersHorizontal :size="18" aria-hidden="true" /></span>
                  <span>{{ speedToText(projectDraft.speed) }}</span>
                </div>
              </div>
              <p class="form-error min-h-4.5 m-0 text-[color:#fecdd3] text-[length:12px] leading-[1.4]" :class="{ invisible: !projectFormError }" role="alert">{{ projectFormError || ' ' }}</p>
              <p v-if="projectError" class="form-error min-h-4.5 m-0 text-[color:#fecdd3] text-[length:12px] leading-[1.4]" role="alert">{{ projectError }}</p>
              <div class="form-actions flex flex-wrap gap-2">
                <button class="primary-button inline-flex items-center justify-center gap-2 [border:1px_solid_transparent] rounded-[var(--radius)] text-[color:var(--accent-ink)] font-extrabold" type="submit" :disabled="Boolean(projectFormError)">
                  <RefreshCw v-if="activeProject" :size="18" aria-hidden="true" />
                  <FolderPlus v-else :size="18" aria-hidden="true" />
                  {{ projectActionLabel }}
                </button>
                <button class="secondary-button inline-flex items-center justify-center gap-2 [padding:0_14px] rounded-[var(--radius)] [background:var(--surface-2)]" type="button" :disabled="Boolean(projectFormError)" @click="createProject">
                  {{ t('app.newAndOpen') }}
                </button>
              </div>
            </form>
          </section>

          <section class="panel project-list-panel" aria-labelledby="project-list-title">
            <div class="panel-head [padding:16px_16px_0]">
              <div>
                <p class="eyebrow text-[color:var(--info)] [font:700_10px/1.4_'Fira_Code',_ui-monospace,_SFMono-Regular,_Consolas,_monospace] tracking-[0]">PROJECTS</p>
                <h2 id="project-list-title">{{ t('app.savedProjects') }}</h2>
              </div>
              <FolderOpen :size="22" class="heading-icon text-[color:var(--text-dim)]" aria-hidden="true" />
            </div>

            <div v-if="projects.length" class="project-list grid">
              <button
                v-for="project in projects"
                :key="project.id"
                type="button"
                class="project-item grid gap-1 w-full rounded-[var(--radius)] cursor-pointer"
                :class="{ active: project.id === activeProjectId }"
                @click="selectProject(project.id)"
              >
                <div class="project-item-head flex items-center justify-between gap-2.5">
                  <strong>{{ project.name }}</strong>
                  <span class="status-pill inline-flex items-center justify-center min-h-6 [padding:0_8px] rounded-full text-[length:11px] whitespace-nowrap" :data-status="project.id === activeProjectId ? 'running' : 'idle'">
                    {{ project.id === activeProjectId ? t('app.current') : t('app.saved') }}
                  </span>
                </div>
                <span>{{ timeframeLabels[project.timeframe] ?? project.timeframe }} · {{ projectRangeLabel(project) }}</span>
                <span>{{ t('app.projectMeta', { cursor: project.cursorIndex + 1, trades: project.trades.length, drawings: project.drawings.length, speed: speedToText(project.speed) }) }}</span>
              </button>
            </div>
            <p v-else class="history-empty">{{ t('app.noProjects') }}</p>
          </section>
        </div>
      </template>

      <section v-else-if="activeView === 'replay'" class="replay-screen relative grid grid-rows-[minmax(0,_1fr)_auto] h-full min-h-0 overflow-hidden [background:var(--chart-bg)]" aria-labelledby="replay-title">
        <h1 id="replay-title" class="sr-only">{{ t('app.replayTitle', { name: currentProjectLabel }) }}</h1>
        <div class="replay-panes grid gap-0.5 min-w-0 min-h-0 overflow-hidden [background:var(--chart-bg)]" :data-panes="replayPaneCount">
          <div class="replay-pane relative grid grid-rows-[auto_minmax(0,_1fr)] min-w-0 min-h-0 overflow-hidden">
            <div class="replay-pane-header flex items-center gap-1.5 [border-bottom:1px_solid_rgba(185,_180,_168,_0.25)] [background:var(--chart-bg)]">
              <span class="replay-pane-label flex-none text-[color:rgba(255,_255,_255,_0.72)] [font:700_11px/16px_'Fira_Code',_ui-monospace,_SFMono-Regular,_Consolas,_monospace]">{{ t('app.mainPane') }}</span>
              <TimeframeSwitcher
                id="replay-pane-timeframe-0"
                :label="t('app.mainPaneTimeframe')"
                :model-value="currentTimeframeValue"
                :options="timeframeOptions"
                :labels="timeframeLabels"
                @change="changeReplayPaneTimeframe(0, $event)"
              />
            </div>
            <MarketChart
              :candle-colors="candleColors"
              :key="`${activeProjectId}-${currentTimeframeValue}`"
              ref="marketChartRef"
              class="fullscreen-chart"
              :history-available="replayHistoryBefore !== null && !replayHistoryError"
              @load-history="loadReplayHistory"
              :snapshot="replaySnapshot"
              :loading="replayLoading"
              :error="activeError"
              :playback-index="chartPlaybackIndex"
              :playing="playbackPlaying"
              :project-name="currentProjectLabel"
              :project-id="activeProjectId"
              :show-header="false"
              :manual-trades="activeProject?.trades ?? []"
              :drawings="activeProject?.drawings ?? []"
              @drawings-changed="updateProjectDrawings"
            />
          </div>
          <div v-for="(pane, index) in secondaryPanes" :key="`${pane.projectId}-${index}-${pane.timeframe}`" class="replay-pane relative grid grid-rows-[auto_minmax(0,_1fr)] min-w-0 min-h-0 overflow-hidden">
            <div class="replay-pane-header flex items-center gap-1.5 [border-bottom:1px_solid_rgba(185,_180,_168,_0.25)] [background:var(--chart-bg)]">
              <span class="replay-pane-label flex-none text-[color:rgba(255,_255,_255,_0.72)] [font:700_11px/16px_'Fira_Code',_ui-monospace,_SFMono-Regular,_Consolas,_monospace]">{{ t('app.paneN', { n: index + 2 }) }}</span>
              <TimeframeSwitcher
                :id="`replay-pane-timeframe-${index + 1}`"
                :label="t('app.paneTimeframe', { n: index + 2 })"
                :model-value="pane.timeframe"
                :options="timeframeOptions"
                :labels="timeframeLabels"
                @change="changeReplayPaneTimeframe(index + 1, $event)"
              />
              <button
                class="replay-pane-remove ml-auto shrink-0 h-6.5 rounded-[var(--radius-sm)] [background:rgba(0,_0,_0,_0.75)] text-[color:#ffffff] [font:700_12px/1_'Fira_Code',_ui-monospace,_SFMono-Regular,_Consolas,_monospace] flex items-center justify-center w-6.5 cursor-pointer"
                type="button"
                :aria-label="t('app.removePane', { n: index + 2 })"
                :title="t('app.removePane', { n: index + 2 })"
                @click="removeReplayPane(index)"
              >
                ×
              </button>
            </div>
            <p v-if="pane.error" class="replay-pane-error absolute z-[5] top-10.5 left-2 right-2 flex items-center gap-2 m-0 [padding:6px_10px] [border:1px_solid_rgba(255,_255,_255,_0.4)] rounded-[var(--radius-sm)] [background:rgba(0,_0,_0,_0.8)] text-[color:#ffffff] text-[length:12px]" role="alert">
              <span>{{ pane.error }}</span>
              <button class="text-button font-bold" type="button" @click="retryReplayPane(pane)">{{ t('common.retry') }}</button>
            </p>
            <MarketChart
              :candle-colors="candleColors"
              class="fullscreen-chart"
              :snapshot="pane.snapshot"
              :loading="pane.loading || (!pane.snapshot && !pane.error && !activeError)"
              :error="pane.error || activeError"
              :clock-limited="true"
              :forming-bucket="pane.formingBucket"
              :forming-candle="pane.forming"
              :playing="playbackPlaying"
              :project-name="currentProjectLabel"
              :project-id="pane.projectId"
              :show-header="false"
              :show-tools="false"
            />
          </div>
        </div>

        <div v-if="activeError" class="alert replay-alert flex items-center gap-2.5 [padding:12px_14px] [border:1px_solid_rgba(153,_27,_27,_0.32)] rounded-[var(--radius)] [background:#fff1f2] text-[color:var(--danger)] absolute z-[6] top-3 left-3 right-3" role="alert">
          <ServerCog :size="20" aria-hidden="true" />
          <span>{{ activeError }}</span>
          <button type="button" class="text-button font-bold" @click="initialize">{{ t('common.retry') }}</button>
        </div>

        <div v-if="mobileConsoleOpen" class="console-sheet-backdrop" aria-hidden="true" @click="mobileConsoleOpen = false" />
        <div class="replay-console [background:rgba(255,_255,_255,_0.9)] [backdrop-filter:blur(10px)] relative z-[5] flex items-center overflow-hidden" :class="{ 'console-more-open': mobileConsoleOpen }" :aria-label="t('app.replayStatusBar')">
          <div class="console-strip flex w-full min-w-0 items-center">
            <div id="replay-console-sheet" class="console-sheet">
              <label class="timeframe-control pane-count-control flex-none flex items-center gap-1.5 min-h-9">
                <span>{{ t('app.panes') }}</span>
                <select
                  data-testid="replay-pane-count"
                  :value="String(replayPaneCount)"
                  :disabled="!activeProject || replayLoading"
                  @change="changeReplayPaneCount"
                >
                  <option v-for="count in MAX_REPLAY_PANES" :key="count" :value="String(count)">
                    {{ count === 1 ? t('app.singlePane') : t('app.paneCount', { n: count }) }}
                  </option>
                </select>
              </label>

              <button v-if="replayHistoryBefore !== null" class="text-button console-history-button font-bold" type="button" :disabled="replayHistoryLoading || replayLoading" data-testid="load-replay-history" @click="loadReplayHistory">
                {{ replayHistoryLoading ? t('app.loadingHistory') : replayHistoryError ? t('app.retryHistory') : t('app.loadEarlier') }}
              </button>
              <span v-if="replayHistoryError" class="console-history-error" role="alert">{{ replayHistoryError }}</span>
              <form class="timeframe-control console-jump-form flex-none flex items-center gap-1.5 min-h-9" @submit.prevent="jumpToCandle">
                <label for="replay-jump-time">{{ t('app.jumpTime') }}</label>
                <input id="replay-jump-time" v-model="jumpTimeInput" type="datetime-local" :disabled="replayLoading" required />
                <button class="text-button font-bold" type="submit" :disabled="!activeProject || replayLoading">{{ t('app.jump') }}</button>
                <span v-if="jumpError" role="alert">{{ jumpError }}</span>
              </form>

              <button class="topbar-action console-help-button shrink-0 whitespace-nowrap" type="button" @click="workspaceSettings?.open('help')">{{ t('app.help') }}</button>

              <div class="console-quick-stats gap-2 min-w-0" :aria-label="t('app.replayAux')">
                <span class="console-stat">{{ currentTimeLabel }}</span>
                <button
                  class="topbar-icon-button console-fullscreen-button w-8 h-8 inline-grid place-items-center p-0 rounded-[var(--radius-sm)] flex-none"
                  type="button"
                  data-testid="replay-fullscreen-console"
                  :aria-label="isReplayFullscreen ? t('app.exitFullscreen') : t('app.fullscreen')"
                  :title="isReplayFullscreen ? t('app.exitFullscreen') : t('app.fullscreen')"
                  @click="toggleReplayFullscreen"
                >
                  <Minimize2 v-if="isReplayFullscreen" :size="16" aria-hidden="true" />
                  <Maximize2 v-else :size="16" aria-hidden="true" />
                </button>
              </div>

              <a class="console-home-link" href="#">{{ t('app.backHome') }}</a>
            </div>

            <label class="replay-speed-control grid grid-cols-[auto_minmax(76px,_1fr)_auto] gap-1.5 items-center min-w-0">
              <span>{{ t('app.speed') }}</span>
              <input
                v-if="activeProject"
                type="range"
                :aria-label="t('app.playbackSpeed')"
                data-testid="replay-speed"
                min="0.25"
                max="8"
                step="0.25"
                :value="activeProject.speed"
                :disabled="replayLoading"
                @input="changePlaybackSpeed"
              />
              <output>{{ speedToText(activeProject?.speed ?? 1) }}</output>
            </label>

            <div class="console-primary">
              <button class="primary-button console-play inline-flex items-center justify-center gap-2 [border:1px_solid_transparent] rounded-[var(--radius)] text-[color:var(--accent-ink)] font-extrabold flex-none whitespace-nowrap" type="button" :disabled="!totalReplayCandles" @click="togglePlayback">
                <Pause v-if="playbackPlaying" :size="18" aria-hidden="true" />
                <Play v-else :size="18" aria-hidden="true" />
                <span>{{ playbackPlaying ? t('app.pause') : t('app.play') }}</span>
              </button>

              <div class="console-trade-actions flex-none grid-cols-[repeat(3,_minmax(68px,_1fr))]" :aria-label="t('app.manualTrades')">
                <button class="trade-button buy min-h-11 items-center justify-center font-black" type="button" :disabled="!canPlaceManualTrade" @click="placeManualTrade('buy')">
                  <TrendingUp :size="16" aria-hidden="true" />
                  Buy
                </button>
                <button class="trade-button sell min-h-11 items-center justify-center font-black" type="button" :disabled="!canPlaceManualTrade" @click="placeManualTrade('sell')">
                  <TrendingDown :size="16" aria-hidden="true" />
                  Sell
                </button>
                <button
                  class="trade-button close min-h-11 items-center justify-center font-black"
                  type="button"
                  data-testid="replay-close-position"
                  :disabled="!canCloseManualTrade"
                  @click="closeManualTrade"
                >
                  <X :size="16" aria-hidden="true" />
                  {{ t('app.closePosition') }}
                </button>
              </div>
            </div>

            <span class="console-clock-mobile" aria-hidden="true">{{ currentTimeShortLabel }}</span>
            <button
              class="console-more-toggle"
              type="button"
              :aria-expanded="mobileConsoleOpen"
              aria-controls="replay-console-sheet"
              @click="mobileConsoleOpen = !mobileConsoleOpen"
            >
              <SlidersHorizontal :size="17" aria-hidden="true" />
              <span>{{ mobileConsoleOpen ? t('app.collapse') : t('app.more') }}</span>
            </button>
          </div>
        </div>
      </section>
    </main>
  </div>
</template>
