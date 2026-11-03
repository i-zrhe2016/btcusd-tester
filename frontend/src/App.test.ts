import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { flushPromises, mount, type VueWrapper } from '@vue/test-utils'
import { defineComponent, h, nextTick, onMounted, onUnmounted } from 'vue'
import App from './App.vue'
import { getMarketMetadata, getMarketSnapshot } from './api'
import { createSeedReplayProject, loadReplayProjects, replayWindowRange, saveActiveReplayProjectId, saveReplayProjects } from './replay'
import type { MarketMetadata, MarketSnapshot } from './types'

const chartLife = vi.hoisted(() => ({ mounts: 0, unmounts: 0 }))
vi.mock('./api', () => ({ getMarketMetadata: vi.fn(), getMarketSnapshot: vi.fn() }))
vi.mock('./components/MarketChart.vue', () => ({
  __esModule: true,
  default: defineComponent({
    props: ['snapshot', 'loading'],
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
})
afterEach(() => { wrapper?.unmount(); wrapper = undefined })

describe('workspace loading', () => {
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
