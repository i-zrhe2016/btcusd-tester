import { chromium } from '../.verification/browser-tools/node_modules/playwright/index.mjs'
import assert from 'node:assert/strict'
import { writeFile } from 'node:fs/promises'
const origin = 'http://deploy.taile2c45c.ts.net:8083'
if (!process.argv.includes('--allow-production')) throw new Error('Explicit production verification flag required')
const browser = await chromium.launch()
const context = await browser.newContext({ viewport: { width: 1440, height: 1000 } })
const page = await context.newPage()
const pending = new Set()
const durations = []
const started = new Map()
const errors = []
let maximumPending = 0
let tracking = false
page.on('pageerror', e => errors.push(e.message))
page.on('request', r => {
  if (tracking && r.url().includes('/api/market/snapshot')) {
    pending.add(r)
    started.set(r, Date.now())
    maximumPending = Math.max(maximumPending, pending.size)
  }
})
const finish = r => {
  if (started.has(r)) durations.push(Date.now() - started.get(r))
  pending.delete(r)
}
page.on('requestfinished', finish)
page.on('requestfailed', finish)
try {
  await page.goto(origin, { waitUntil: 'networkidle' })
  await page.getByRole('button', { name: '复盘', exact: true }).click()
  await page.locator('.price-chart canvas').first().waitFor()
  await page.getByTestId('replay-pane-count').selectOption('4')
  await page.waitForFunction(() => document.querySelectorAll('.price-chart').length === 4 && [...document.querySelectorAll('.price-chart')].every(e => e.querySelector('canvas')))
  const initial = await page.evaluate(() => {
    const project = JSON.parse(localStorage.getItem('btcusd.replay.projects.v2')).find(p => p.id === localStorage.getItem('btcusd.replay.active.v1'))
    window.__playbackCanvases = [...document.querySelectorAll('canvas')]
    window.__playbackLongTasks = []
    window.__playbackObserver = new PerformanceObserver(entries => window.__playbackLongTasks.push(...entries.getEntries().map(e => e.duration)))
    window.__playbackObserver.observe({ type: 'longtask', buffered: false })
    return project.cursorIndex
  })
  tracking = true
  const start = Date.now()
  await page.getByTestId('replay-speed').focus()
  await page.keyboard.press('End')
  await page.getByRole('button', { name: '播放', exact: true }).click()
  await page.waitForFunction(cursor => {
    const project = JSON.parse(localStorage.getItem('btcusd.replay.projects.v2')).find(p => p.id === localStorage.getItem('btcusd.replay.active.v1'))
    return project.cursorIndex >= cursor + 120
  }, initial, { timeout: 30000 })
  await page.getByRole('button', { name: '暂停', exact: true }).click()
  tracking = false
  const state = await page.evaluate(() => {
    window.__playbackObserver.disconnect()
    return { allCanvasesRetained: window.__playbackCanvases.every(e => e.isConnected), longTasksMs: window.__playbackLongTasks, status: document.querySelector('.replay-topbar-status').innerText }
  })
  assert.equal(state.allCanvasesRetained, true)
  assert.deepEqual(errors, [])
  assert.equal(await page.getByRole('alert').count(), 0)
  assert.ok(maximumPending < 24, `Unexpected snapshot accumulation: ${maximumPending}`)
  durations.sort((a, b) => a - b)
  const result = { result: 'pass', origin, advancedCandles: 120, elapsedMs: Date.now() - start, maximumConcurrentSnapshots: maximumPending, completedSnapshots: durations.length, snapshotMedianMs: durations[Math.floor(durations.length / 2)], snapshotP90Ms: durations[Math.floor(durations.length * 0.9)], ...state, errors }
  await writeFile('docs/testing/evidence/production-playback-results.json', JSON.stringify(result, null, 2))
  console.log(JSON.stringify(result, null, 2))
} finally { await browser.close() }
