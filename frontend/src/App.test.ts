import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { flushPromises, mount, type VueWrapper } from '@vue/test-utils'
import { defineComponent, h, nextTick, onMounted, onUnmounted } from 'vue'
import App from './App.vue'
import { getMarketMetadata, getMarketSnapshot, listProjects, saveProject } from './api'
import { createSeedReplayProject, loadReplayProjects, replayWindowRange, saveActiveReplayProjectId, saveReplayProjects, timeframeStepSeconds, type ManualTrade } from './replay'
import type { MarketMetadata, MarketSnapshot } from './types'

const chartLife = vi.hoisted(() => ({ mounts: 0, unmounts: 0 }))
vi.mock('./api', () => ({
  getMarketMetadata: vi.fn(),
  getMarketSnapshot: vi.fn(),
  listProjects: vi.fn(),
  saveProject: vi.fn(),
  deleteProject: vi.fn(),
}))
vi.mock('./components/MarketChart.vue', () => ({
  __esModule: true,
  default: defineComponent({
    name: 'MarketChartMock',
    props: ['snapshot', 'loading', 'formingBucket', 'formingCandle', 'clockLimited'],
    setup(props) {
      onMounted(() => chartLife.mounts++)
      onUnmounted(() => chartLife.unmounts++)
      return () => h('div', { 'data-testid': 'chart-mock' }, JSON.stringify(props.snapshot))
    },
  }),
}))

const market: MarketMetadata = {
  symbol: 'BTCUSD', base_timeframe: '1m', source: 'test', candle_count: 10,
  first_timestamp: 1_700_000_040, last_timestamp: 1_700_000_580,
  supported_timeframes: ['1m', '5m', '1h'],
}
function snapshot(timeframe = '1m', timestamp = market.first_timestamp): MarketSnapshot {
  return { symbol: 'BTCUSD', source: 'test', timeframe, candles: [
    { timestamp, open: 10, high: 12, low: 9, close: 11, volume: 1 },
  ] }
}
function deferred<T>() {
  let resolve!: (value: T) => void
  let reject!: (error: Error) => void
  const promise = new Promise<T>((res, rej) => { resolve = res; reject = rej })
  return { promise, resolve, reject }
}
let wrapper: VueWrapper | undefined
function stored(view = 'projects', panes = ['1m']) {
  const project = { ...createSeedReplayProject(market), id: 'local', name: '本地项目', panes }
  saveReplayProjects([project])
  saveActiveReplayProjectId(project.id)
  localStorage.setItem('btcusd.workspace.view.v2', view)
  return project
}
async function click(text: string) {
  const button = wrapper!.findAll('button').find((item) => item.text() === text)
  expect(button, text).toBeDefined()
  await button!.trigger('click')
  await flushPromises()
}
beforeEach(() => {
  localStorage.clear()
  vi.clearAllMocks()
  chartLife.mounts = chartLife.unmounts = 0
  vi.mocked(getMarketMetadata).mockResolvedValue(market)
  vi.mocked(getMarketSnapshot).mockImplementation(async (query) => snapshot(query.timeframe))
  vi.mocked(listProjects).mockResolvedValue([])
  vi.mocked(saveProject).mockImplementation(async (project) => project)
})
afterEach(() => { wrapper?.unmount(); wrapper = undefined })

describe('multi-timeframe replay synchronization', () => {
  const start = Math.floor(market.first_timestamp / 300) * 300
  const extended = { ...market, first_timestamp: start, last_timestamp: start + 20_000 * 60 }
  type Query = Parameters<typeof getMarketSnapshot>[0]
  function response(query: Query): MarketSnapshot {
    const step = timeframeStepSeconds(query.timeframe)
    const first = Math.max(start, Math.floor(query.from / step) * step)
    return { ...snapshot(query.timeframe), candles: Array.from(
      { length: Math.max(0, Math.ceil((query.to - first) / step)) },
      (_, index) => ({ ...snapshot().candles[0], timestamp: first + index * step }),
    ).slice(-(query.limit ?? 500)) }
  }
  function setup(timestamp = start) {
    vi.mocked(getMarketMetadata).mockResolvedValue(extended)
    const project = { ...createSeedReplayProject(extended), id: 'panes', panes: ['1m', '5m'], cursorTimestamp: timestamp }
    saveReplayProjects([project])
    saveActiveReplayProjectId(project.id)
    localStorage.setItem('btcusd.workspace.view.v2', 'replay')
  }
  async function jump(timestamp: number) {
    await wrapper!.find('#replay-jump-time').setValue(new Date(timestamp * 1000).toISOString().slice(0, 16))
    await wrapper!.find('#replay-jump-time').element.closest('form')!.dispatchEvent(new Event('submit', { bubbles: true, cancelable: true }))
    await flushPromises()
  }
  const pane = () => wrapper!.findAllComponents({ name: 'MarketChartMock' })[1]

  it('reloads a pane for the latest jump even when its previous window is still loading', async () => {
    setup()
    const old = deferred<MarketSnapshot>()
    let oldQuery!: Query
    vi.mocked(getMarketSnapshot).mockImplementation((query) => {
      if (query.timeframe === '5m' && !oldQuery) { oldQuery = query; return old.promise }
      return Promise.resolve(response(query))
    })
    wrapper = mount(App)
    await flushPromises()
    const target = start + 6_000 * 60
    await jump(target)
    old.resolve(response(oldQuery))
    await flushPromises()
    const candles = (pane().props('snapshot') as MarketSnapshot).candles
    expect(candles.some((bar) => bar.timestamp === target)).toBe(true)
    expect(pane().props('formingBucket')).toBe(target)
    expect(pane().props('formingCandle')?.timestamp).toBe(target)
    expect(pane().props('loading')).toBe(false)
  })

  it('catches up after playback leaves an in-flight pane window', async () => {
    setup()
    const project = loadReplayProjects()[0]
    const anchor = start + 100 * 3600
    saveReplayProjects([{ ...project, timeframe: '1h', panes: ['1h', '1m'], cursorTimestamp: anchor }])
    const old = deferred<MarketSnapshot>()
    let oldQuery!: Query
    vi.mocked(getMarketSnapshot).mockImplementation((query) => {
      if (query.timeframe === '1m' && !oldQuery) { oldQuery = query; return old.promise }
      return Promise.resolve(response(query))
    })
    wrapper = mount(App)
    await flushPromises()
    ;(wrapper.vm as unknown as { setPlaybackCursor: (index: number, pause: boolean) => void }).setPlaybackCursor(120, false)
    await flushPromises()
    const latest = loadReplayProjects()[0].cursorTimestamp!
    expect(latest).toBeGreaterThan(anchor + 500 * 60)
    old.resolve(response(oldQuery))
    await flushPromises()
    const candles = (pane().props('snapshot') as MarketSnapshot).candles
    expect(candles.some((bar) => bar.timestamp === latest)).toBe(true)
    expect(pane().props('formingBucket')).toBe(latest + 3540)
    expect(pane().props('loading')).toBe(false)
  })

  it('reports a pane window failure and synchronizes after explicit retry', async () => {
    setup()
    vi.mocked(getMarketSnapshot).mockImplementation(async (query) => response(query))
    vi.mocked(getMarketSnapshot).mockImplementationOnce(async (query) => response(query))
      .mockRejectedValueOnce(new Error('副屏服务暂不可用'))
    wrapper = mount(App)
    await flushPromises()
    expect(wrapper.find('.replay-pane-error').text()).toContain('副屏服务暂不可用')
    expect(pane().props('loading')).toBe(false)
    expect(pane().props('snapshot')).toBeNull()
    await wrapper.find('.replay-pane-error button').trigger('click')
    await flushPromises()
    expect(wrapper.find('.replay-pane-error').exists()).toBe(false)
    expect(pane().props('formingCandle')?.timestamp).toBe(start)
  })

  it('clears later partial prices on a backward jump and discards the old response', async () => {
    const forward = start + 6_003 * 60
    const backward = start + 6_001 * 60
    setup(forward)
    const old = deferred<MarketSnapshot>()
    const latest = deferred<MarketSnapshot>()
    const queries: Query[] = []
    vi.mocked(getMarketSnapshot).mockImplementation((query) => {
      if (query.timeframe === '5m' && query.limit === 1) {
        queries.push(query)
        return queries.length === 1 ? old.promise : latest.promise
      }
      return Promise.resolve(response(query))
    })
    wrapper = mount(App)
    await flushPromises()
    await jump(backward)
    expect(pane().props('formingCandle')).toBeNull()
    old.resolve({ ...response(queries[0]), candles: [{ ...snapshot().candles[0], timestamp: start + 6_000 * 60, close: 999 }] })
    await flushPromises()
    expect(pane().props('formingCandle')).toBeNull()
    latest.resolve(response(queries[1]))
    await flushPromises()
    expect(pane().props('formingCandle')?.timestamp).toBe(start + 6_000 * 60)
    expect(pane().props('formingCandle')?.close).toBe(11)
    expect(loadReplayProjects()[0].cursorTimestamp).toBe(backward)
  })

  it('synchronizes a same-time jump and ignores partial candles returned for the previous clock', async () => {
    const target = start + 6_001 * 60
    setup(target)
    const old = deferred<MarketSnapshot>()
    let oldQuery!: Query
    vi.mocked(getMarketSnapshot).mockImplementation((query) => {
      if (query.timeframe === '5m' && query.limit === 1 && !oldQuery) { oldQuery = query; return old.promise }
      return Promise.resolve(response(query))
    })
    wrapper = mount(App)
    await flushPromises()
    await jump(target)
    expect(pane().props('formingCandle')?.timestamp).toBe(Math.floor(target / 300) * 300)
    old.resolve({ ...response(oldQuery), candles: [{ ...snapshot().candles[0], timestamp: start, close: 999 }] })
    await flushPromises()
    expect(pane().props('formingCandle')?.timestamp).toBe(Math.floor(target / 300) * 300)
    expect(pane().props('formingCandle')?.close).not.toBe(999)
  })
})

describe('workspace loading', () => {
  it('jumps with bounded work, loads history on demand without moving the cursor, and rejects invalid times', async () => {
    const start = market.first_timestamp
    const extended = { ...market, last_timestamp: start + 7_000 * 60 }
    vi.mocked(getMarketMetadata).mockResolvedValue(extended)
    const project = { ...createSeedReplayProject(extended), id: 'jump' }
    saveReplayProjects([project])
    saveActiveReplayProjectId(project.id)
    localStorage.setItem('btcusd.workspace.view.v2', 'replay')
    vi.mocked(getMarketSnapshot).mockImplementation(async (query) => ({
      ...snapshot(),
      candles: Array.from({ length: 7_001 }, (_, index) => ({
        ...snapshot().candles[0], timestamp: start + index * 60,
      })).filter((bar) => bar.timestamp >= query.from && bar.timestamp < query.to).slice(-(query.limit ?? 500)),
    }))
    wrapper = mount(App)
    await flushPromises()
    const target = start + 6_000 * 60
    await wrapper.find('#replay-jump-time').setValue(new Date(target * 1000).toISOString().slice(0, 16))
    await wrapper.find('#replay-jump-time').element.closest('form')!.dispatchEvent(new Event('submit', { bubbles: true, cancelable: true }))
    await flushPromises()
    let rendered = JSON.parse(wrapper.find('[data-testid="chart-mock"]').text()) as MarketSnapshot
    expect(rendered.candles.length).toBeLessThanOrEqual(531)
    expect(rendered.candles.some((bar) => bar.timestamp === target)).toBe(true)
    expect(getMarketSnapshot).toHaveBeenCalledTimes(2)
    expect(loadReplayProjects()[0].cursorTimestamp).toBe(target)
    while (wrapper.find('[data-testid="load-replay-history"]').exists()) {
      await wrapper.find('[data-testid="load-replay-history"]').trigger('click')
      await flushPromises()
      expect(loadReplayProjects()[0].cursorTimestamp).toBe(target)
    }
    rendered = JSON.parse(wrapper.find('[data-testid="chart-mock"]').text()) as MarketSnapshot
    const history = rendered.candles.filter((bar) => bar.timestamp <= target)
    expect(history.map((bar) => bar.timestamp)).toEqual(Array.from({ length: 6_001 }, (_, index) => start + index * 60))
    const calls = vi.mocked(getMarketSnapshot).mock.calls.length
    await wrapper.find('#replay-jump-time').setValue('2000-01-01T00:00')
    await wrapper.find('#replay-jump-time').trigger('submit')
    await flushPromises()
    expect(wrapper.text()).not.toContain('请选择项目开始时间至结束时间之间的 UTC 时间。')
    expect(vi.mocked(getMarketSnapshot).mock.calls).toHaveLength(calls + 1)
    expect(loadReplayProjects()[0].from).toBe(Date.parse('2000-01-01T00:00:00Z') / 1000)
    expect(vi.mocked(getMarketSnapshot).mock.calls.at(-1)?.[0].from).toBeLessThanOrEqual(loadReplayProjects()[0].from)

    const afterEnd = extended.last_timestamp + 3_600
    await wrapper.find('#replay-jump-time').setValue(new Date(afterEnd * 1000).toISOString().slice(0, 16))
    await wrapper.find('#replay-jump-time').trigger('submit')
    await flushPromises()
    expect(loadReplayProjects()[0].to).toBe(afterEnd + timeframeStepSeconds(project.timeframe))
    const query = vi.mocked(getMarketSnapshot).mock.calls.at(-1)![0]
    expect(query.from).toBeLessThanOrEqual(afterEnd)
    expect(query.to).toBeGreaterThan(afterEnd)
  })
  it('restores a multi-year cursor with one bounded request and keeps the chart usable after a history failure', async () => {
    const start = market.first_timestamp
    const target = start + 2_000_000 * 60
    const extended = { ...market, last_timestamp: target + 600 }
    vi.mocked(getMarketMetadata).mockResolvedValue(extended)
    const project = { ...createSeedReplayProject(extended), id: 'large', cursorTimestamp: target }
    saveReplayProjects([project])
    saveActiveReplayProjectId(project.id)
    localStorage.setItem('btcusd.workspace.view.v2', 'replay')
    vi.mocked(getMarketSnapshot).mockImplementation(async (query) => ({
      ...snapshot(),
      candles: Array.from({ length: Math.ceil((query.to - query.from) / 60) }, (_, index) => ({
        ...snapshot().candles[0], timestamp: query.from + index * 60,
      })),
    }))
    wrapper = mount(App)
    await flushPromises()
    expect(getMarketSnapshot).toHaveBeenCalledTimes(1)
    const initial = wrapper.find('[data-testid="chart-mock"]').text()
    expect((JSON.parse(initial) as MarketSnapshot).candles.length).toBeLessThanOrEqual(531)
    expect(loadReplayProjects()[0].cursorTimestamp).toBe(target)
    vi.mocked(getMarketSnapshot).mockRejectedValueOnce(new Error('历史服务暂不可用'))
    await wrapper.find('[data-testid="load-replay-history"]').trigger('click')
    await flushPromises()
    expect(wrapper.text()).toContain('历史服务暂不可用')
    expect(wrapper.find('[data-testid="load-replay-history"]').text()).toBe('重试加载历史')
    expect(wrapper.find('[data-testid="chart-mock"]').text()).toBe(initial)
    expect(loadReplayProjects()[0].cursorTimestamp).toBe(target)
    await wrapper.find('[data-testid="load-replay-history"]').trigger('click')
    await flushPromises()
    expect(wrapper.text()).not.toContain('历史服务暂不可用')
    expect((JSON.parse(wrapper.find('[data-testid="chart-mock"]').text()) as MarketSnapshot).candles.length).toBeGreaterThan(531)
    expect(loadReplayProjects()[0].cursorTimestamp).toBe(target)
  })

  it('restores the library before metadata, keeps local projects after failure, and opens once', async () => {
    stored()
    const meta = deferred<MarketMetadata>()
    vi.mocked(getMarketMetadata).mockReturnValueOnce(meta.promise)
    wrapper = mount(App)
    await nextTick()
    expect(wrapper.find('.project-item').text()).toContain('本地项目')
    expect(wrapper.find('.workspace-projects').exists()).toBe(true)
    expect(chartLife.mounts).toBe(0)
    expect(getMarketSnapshot).not.toHaveBeenCalled()
    meta.reject(new Error('meta offline'))
    await flushPromises()
    expect(wrapper.find('.project-item').text()).toContain('本地项目')
    expect(wrapper.find('.error-alert').text()).toContain('meta offline')
    expect(wrapper.find('.error-alert button').text()).toBe('重试')
    expect(getMarketSnapshot).not.toHaveBeenCalled()
    await click('复盘')
    expect(getMarketSnapshot).toHaveBeenCalledTimes(1)
    expect(wrapper.find('[data-testid="chart-mock"]').text()).toContain('"close":11')
    await click('项目库')
    await click('复盘')
    expect(getMarketSnapshot).toHaveBeenCalledTimes(1)
  })

  it('opens the entry view instead of the last opened replay', async () => {
    stored('replay')
    wrapper = mount(App, { props: { initialView: 'projects' } })
    await flushPromises()
    expect(wrapper.find('.workspace-projects').exists()).toBe(true)
    expect(wrapper.find('.workspace-replay').exists()).toBe(false)
  })

  it('creates the default project without fetching a snapshot in the library', async () => {
    wrapper = mount(App)
    await flushPromises()
    expect(wrapper.find('.project-item').exists()).toBe(true)
    expect(getMarketSnapshot).not.toHaveBeenCalled()
    expect(chartLife.mounts).toBe(0)
    await click('复盘')
    expect(getMarketSnapshot).toHaveBeenCalledTimes(1)
  })

  it('restores replay immediately but waits for metadata alignment before its single snapshot', async () => {
    const project = stored('replay')
    saveReplayProjects([{ ...project, from: market.first_timestamp - 600, to: market.first_timestamp - 60 }])
    const meta = deferred<MarketMetadata>()
    vi.mocked(getMarketMetadata).mockReturnValueOnce(meta.promise)
    wrapper = mount(App)
    await nextTick()
    expect(wrapper.find('.workspace-replay').exists()).toBe(true)
    expect(wrapper.text()).toContain('本地项目')
    expect(getMarketSnapshot).not.toHaveBeenCalled()
    meta.resolve(market)
    await flushPromises()
    expect(getMarketSnapshot).toHaveBeenCalledTimes(1)
    const aligned = loadReplayProjects()[0]
    expect(aligned.from).toBe(market.first_timestamp + 60)
    expect(aligned.to).toBe(market.last_timestamp + 60)
    expect(vi.mocked(getMarketSnapshot).mock.calls[0][0]).toMatchObject(replayWindowRange(aligned.from, aligned))
    expect(wrapper.find('[data-testid="chart-mock"]').text()).toContain('"close":11')
  })

  it('allows opening while meta is pending and does not resurrect replay after returning to projects', async () => {
    stored()
    const meta = deferred<MarketMetadata>()
    vi.mocked(getMarketMetadata).mockReturnValueOnce(meta.promise)
    wrapper = mount(App)
    await nextTick()
    await click('复盘')
    expect(getMarketSnapshot).not.toHaveBeenCalled()
    await click('项目库')
    meta.resolve(market)
    await flushPromises()
    expect(wrapper.find('.workspace-projects').exists()).toBe(true)
    expect(getMarketSnapshot).not.toHaveBeenCalled()
    await wrapper.find('.project-item').trigger('click')
    await flushPromises()
    expect(getMarketSnapshot).toHaveBeenCalledTimes(1)
  })

  it('uses one request for create/save and ignores an older project response', async () => {
    stored()
    const old = deferred<MarketSnapshot>()
    vi.mocked(getMarketSnapshot).mockReturnValueOnce(old.promise)
    wrapper = mount(App)
    await flushPromises()
    await click('复盘')
    await click('项目库')
    await wrapper.find('.project-form input').setValue('新项目')
    await click('新建并打开')
    expect(getMarketSnapshot).toHaveBeenCalledTimes(2)
    old.resolve(snapshot('1m', market.first_timestamp - 600))
    await flushPromises()
    expect(wrapper.find('[data-testid="chart-mock"]').text()).not.toContain(String(market.first_timestamp - 600))
    await click('项目库')
    await wrapper.find('.project-form').trigger('submit')
    await flushPromises()
    expect(getMarketSnapshot).toHaveBeenCalledTimes(2)
    expect(wrapper.find('.workspace-replay').exists()).toBe(true)
  })

  it('appends another window without remounting the main chart or repeating the request', async () => {
    const project = stored('replay')
    saveReplayProjects([{ ...project, to: project.to + 60 * 10_000 }])
    vi.mocked(getMarketMetadata).mockResolvedValue({ ...market, last_timestamp: project.to + 60 * 10_000 })
    wrapper = mount(App)
    await flushPromises()
    const mounts = chartLife.mounts
    const incoming = deferred<MarketSnapshot>()
    vi.mocked(getMarketSnapshot).mockReturnValueOnce(incoming.promise)
    const app = wrapper.vm as unknown as { loadMoreReplay: () => Promise<void> }
    const first = app.loadMoreReplay()
    const duplicate = app.loadMoreReplay()
    incoming.resolve(snapshot('1m', market.first_timestamp + 60))
    await Promise.all([first, duplicate])
    await flushPromises()
    expect(getMarketSnapshot).toHaveBeenCalledTimes(2)
    expect(chartLife.mounts).toBe(mounts)
    expect(wrapper.find('[data-testid="chart-mock"]').text()).toContain(String(market.first_timestamp))
    expect(wrapper.find('[data-testid="chart-mock"]').text()).toContain(String(market.first_timestamp + 60))
  })

  it('offers retry for snapshot errors and loads successfully once on retry', async () => {
    stored('replay')
    vi.mocked(getMarketSnapshot).mockRejectedValueOnce(new Error('snapshot offline'))
    wrapper = mount(App)
    await flushPromises()
    expect(wrapper.find('.replay-alert').text()).toContain('snapshot offline')
    await wrapper.find('.replay-alert button').trigger('click')
    await flushPromises()
    expect(getMarketSnapshot).toHaveBeenCalledTimes(2)
    expect(wrapper.find('.replay-alert').exists()).toBe(false)
    expect(wrapper.find('[data-testid="chart-mock"]').text()).toContain('"close":11')
  })

  it('remounts both panes on project changes and the main chart on timeframe changes', async () => {
    const project = stored('replay', ['1m', '5m'])
    saveReplayProjects([project, { ...project, id: 'other', name: '另一个项目' }])
    wrapper = mount(App)
    await flushPromises()
    expect(wrapper.findAll('[data-testid="chart-mock"]')).toHaveLength(2)
    const mounts = chartLife.mounts
    const unmounts = chartLife.unmounts
    // Exercise selection without leaving replay so parent v-if cannot mask missing keys.
    ;(wrapper.vm as unknown as { selectProject: (id: string) => void }).selectProject('other')
    await flushPromises()
    expect(chartLife.mounts).toBe(mounts + 2)
    expect(chartLife.unmounts).toBe(unmounts + 2)
    const beforePeriod = chartLife.mounts
    await wrapper.find('[data-testid="replay-pane-timeframe"]').setValue('1h')
    await flushPromises()
    expect(chartLife.mounts).toBeGreaterThan(beforePeriod)
    expect(wrapper.find('[data-testid="chart-mock"]').text()).toContain('"timeframe":"1h"')
  })
})

describe('per-user project data', () => {
  it("restores the signed-in user's server projects instead of another account's cache", async () => {
    const alice = { ...createSeedReplayProject(market), id: 'alice-project', name: 'Alice 项目' }
    const bob = { ...createSeedReplayProject(market), id: 'bob-project', name: 'Bob 项目' }
    localStorage.setItem('btcusd.replay.projects.v2.u.user_bob', JSON.stringify([bob]))
    vi.mocked(listProjects).mockResolvedValue([alice])
    wrapper = mount(App, { props: { userId: 'user_alice' } })
    await flushPromises()
    expect(wrapper.text()).toContain('Alice 项目')
    expect(wrapper.text()).not.toContain('Bob 项目')
    expect(listProjects).toHaveBeenCalled()
  })

  it('asks before adopting unscoped legacy projects and imports them on confirm', async () => {
    const legacy = { ...createSeedReplayProject(market), id: 'legacy-project', name: '旧版项目' }
    localStorage.setItem('btcusd.replay.projects.v2', JSON.stringify([legacy]))
    vi.mocked(listProjects).mockResolvedValue([])
    wrapper = mount(App, { props: { userId: 'user_alice' } })
    await flushPromises()
    expect(wrapper.text()).toContain('发现旧版本机项目')
    const importButton = wrapper.findAll('button').find((button) => button.text() === '导入到我的账户')
    expect(importButton).toBeDefined()
    await importButton!.trigger('click')
    await flushPromises()
    expect(saveProject).toHaveBeenCalledWith(expect.objectContaining({ id: 'legacy-project' }))
    expect(localStorage.getItem('btcusd.replay.projects.v2')).toBeNull()
    expect(localStorage.getItem('btcusd.replay.projects.v2.u.user_alice')).toContain('legacy-project')
  })

  it('deletes legacy projects without importing them when the user declines', async () => {
    localStorage.setItem('btcusd.replay.projects.v2', JSON.stringify([
      { ...createSeedReplayProject(market), id: 'legacy-project' },
    ]))
    vi.mocked(listProjects).mockResolvedValue([])
    wrapper = mount(App, { props: { userId: 'user_alice' } })
    await flushPromises()
    const discard = wrapper.findAll('button').find((button) => button.text() === '删除旧数据')
    await discard!.trigger('click')
    await flushPromises()
    expect(savedProjects()).not.toContain('legacy-project')
    expect(localStorage.getItem('btcusd.replay.projects.v2')).toBeNull()
  })

  function savedProjects() {
    return localStorage.getItem('btcusd.replay.projects.v2.u.user_alice') ?? ''
  }

  it('picks up trades made on another device when the app regains focus', async () => {
    const project = { ...createSeedReplayProject(market), id: 'shared-project', name: 'Shared' }
    vi.mocked(listProjects).mockResolvedValue([project])
    wrapper = mount(App, { props: { userId: 'user_alice' } })
    await flushPromises()

    const webTrade: ManualTrade = {
      id: 'web-trade', candleIndex: 3, timestamp: market.first_timestamp + 180,
      side: 'buy', action: 'open-long', price: 100, quantity: 1, realizedPnl: null,
      createdAt: '2026-01-01T00:00:00.000Z',
    }
    vi.mocked(listProjects).mockResolvedValue([{
      ...project,
      trades: [webTrade],
      updatedAt: new Date(Date.now() + 1000).toISOString(),
    }])

    window.dispatchEvent(new Event('focus'))
    await flushPromises()
    expect(savedProjects()).toContain('web-trade')
  })

  it('keeps trades made here when the server copy is still stale', async () => {
    const project = { ...createSeedReplayProject(market), id: 'shared-project', name: 'Shared' }
    const phoneTrade: ManualTrade = {
      id: 'phone-trade', candleIndex: 4, timestamp: market.first_timestamp + 240,
      side: 'sell', action: 'open-short', price: 101, quantity: 1, realizedPnl: null,
      createdAt: '2026-01-01T00:00:00.000Z',
    }
    localStorage.setItem(
      'btcusd.replay.projects.v2.u.user_alice',
      JSON.stringify([{ ...project, trades: [phoneTrade] }]),
    )
    vi.mocked(listProjects).mockResolvedValue([project])

    wrapper = mount(App, { props: { userId: 'user_alice' } })
    await flushPromises()
    expect(savedProjects()).toContain('phone-trade')
  })
})

