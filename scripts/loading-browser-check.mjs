// Browser acceptance against the production build, real Nginx/TLS and Rust API.
// Install isolated tooling: npm install --prefix .verification/browser-tools --no-save playwright
import assert from 'node:assert/strict'
import { writeFile, mkdir } from 'node:fs/promises'
import { resolve } from 'node:path'
import { pathToFileURL } from 'node:url'
const { chromium } = await import(pathToFileURL(resolve('.verification/browser-tools/node_modules/playwright/index.mjs')).href)
const origin = process.argv[2] ?? 'https://localhost:8448'
const production = process.argv.includes('--allow-production') && new URL(origin).hostname === 'deploy.taile2c45c.ts.net' && new URL(origin).port === '8083'
if (!['localhost', '127.0.0.1'].includes(new URL(origin).hostname) && !production) throw new Error('Use localhost or explicitly authorize the known production origin')
const evidencePrefix = production ? 'docs/testing/evidence/production' : 'docs/testing/evidence/loading'
const browser = await chromium.launch({ headless: true })
const context = await browser.newContext({ ignoreHTTPSErrors: true, viewport: { width: 1440, height: 1000 } })
const page = await context.newPage()
const errors = []
const requests = []
const checks = []
page.on('pageerror', error => errors.push(error.message))
page.on('request', request => requests.push({ url: request.url(), time: Date.now() }))
const projectState = () => page.evaluate(() => {
  const projects = JSON.parse(localStorage.getItem('btcusd.replay.projects.v2') ?? '[]')
  return projects.find(p => p.id === localStorage.getItem('btcusd.replay.active.v1'))
})
const loaded = async () => {
  await page.locator('.price-chart canvas').first().waitFor()
  await page.waitForFunction(() => !document.querySelector('.chart-loading') && document.querySelector('.replay-topbar-status')?.textContent.includes('已暂停'))
}
const run = async (name, action) => {
  const start = Date.now()
  await action()
  checks.push({ name, elapsedMs: Date.now() - start, result: 'pass' })
}
await mkdir('docs/testing/evidence', { recursive: true })
try {
  let metadata
  await run('project library: no snapshot or chart module', async () => {
    const metaResponse = page.waitForResponse(r => r.url().endsWith('/api/market/meta'))
    await page.goto(origin, { waitUntil: 'networkidle' })
    metadata = await (await metaResponse).json()
    await page.getByRole('heading', { name: '复盘项目库', exact: true }).waitFor()
    assert.equal(requests.filter(r => r.url.includes('/snapshot')).length, 0)
    assert.equal(requests.filter(r => /\/MarketChart-.*\.js/.test(r.url)).length, 0)
    assert.equal(metadata.source, 'Parquet')
  })
  await run('create project: one snapshot, usable canvas', async () => {
    await page.getByLabel('项目名称', { exact: true }).fill('加载体验验证')
    await page.getByLabel('开始时间（UTC）', { exact: true }).fill(new Date((metadata.first_timestamp + 86400) * 1000).toISOString().slice(0, 16))
    await page.getByRole('button', { name: '新建并打开', exact: true }).click()
    await loaded()
    assert.equal(requests.filter(r => r.url.includes('/snapshot')).length, 1)
    assert.equal((await projectState()).name, '加载体验验证')
  })
  await run('append window: preserve canvas and drawings', async () => {
    const canvas = await page.locator('.price-chart canvas').first().elementHandle()
    await page.getByRole('button', { name: '趋势线', exact: true }).click()
    const area = await page.locator('.price-chart').first().boundingBox()
    await page.mouse.click(area.x + area.width * 0.35, area.y + area.height * 0.18)
    await page.mouse.click(area.x + area.width * 0.55, area.y + area.height * 0.28)
    await page.waitForFunction(() => JSON.parse(localStorage.getItem('btcusd.replay.projects.v2') ?? '[]').some(p => p.drawings.length > 0))
    const drawings = (await projectState()).drawings
    const response = page.waitForResponse(r => r.url().includes('/snapshot'))
    await page.getByTestId('replay-load-more').click()
    await response
    await page.waitForFunction(() => document.querySelector('[data-testid="replay-load-more"]')?.textContent.trim() === '加载更多')
    assert.equal(await canvas.evaluate(node => node.isConnected), true)
    assert.deepEqual((await projectState()).drawings, drawings)
  })
  await run('manual trading: buy, close, sell, close', async () => {
    await page.getByRole('button', { name: 'Buy', exact: true }).click()
    await page.waitForFunction(() => document.querySelector('.replay-topbar-status .status-chip:last-child')?.textContent.trim().startsWith('多 '))
    await page.getByTestId('replay-close-position').click()
    await page.waitForFunction(() => document.querySelector('.replay-topbar-status')?.textContent.includes('空仓'))
    await page.getByRole('button', { name: 'Sell', exact: true }).click()
    await page.waitForFunction(() => document.querySelector('.replay-topbar-status .status-chip:last-child')?.textContent.trim().startsWith('空 '))
    await page.getByTestId('replay-close-position').click()
    assert.equal((await projectState()).trades.length, 4)
  })
  await run('all supported timeframe switches', async () => {
    for (const timeframe of metadata.supported_timeframes.filter(t => t !== '1m').concat('1m')) {
      const response = page.waitForResponse(r => r.url().includes('/snapshot?') && new URL(r.url()).searchParams.get('timeframe') === timeframe)
      await page.locator('.replay-pane select').first().selectOption(timeframe)
      const result = await response
      assert.equal(result.status(), 200, timeframe)
      const body = await result.json()
      assert.equal(body.timeframe, timeframe)
      assert.ok(body.candles.length > 0, timeframe)
      await loaded()
    }
  })
  await run('four panes and fast playback', async () => {
    await page.getByTestId('replay-pane-count').selectOption('4')
    await page.waitForFunction(() => document.querySelectorAll('.price-chart').length === 4 && [...document.querySelectorAll('.price-chart')].every(e => e.querySelector('canvas')))
    const cursor = (await projectState()).cursorIndex
    await page.getByTestId('replay-speed').focus()
    await page.keyboard.press('End')
    await page.getByRole('button', { name: '播放', exact: true }).click()
    await page.waitForFunction(index => {
      const projects = JSON.parse(localStorage.getItem('btcusd.replay.projects.v2') ?? '[]')
      return projects.find(p => p.id === localStorage.getItem('btcusd.replay.active.v1'))?.cursorIndex >= index + 8
    }, cursor)
    await page.getByRole('button', { name: '暂停', exact: true }).click()
    assert.equal((await projectState()).speed, 8)
    assert.equal(await page.getByRole('alert').count(), 0)
  })
  await run('indicator settings, visibility and fullscreen', async () => {
    const pane = page.locator('.replay-pane').first()
    await pane.locator('.stoch-settings summary').click()
    await pane.getByTestId('stoch-groups-6').check()
    await pane.getByLabel('Stoch K1', { exact: true }).fill('35')
    await pane.getByRole('button', { name: '应用参数', exact: true }).click()
    await page.waitForFunction(() => JSON.parse(localStorage.getItem('btcusd.stoch.parameters.v1') ?? '{}')['1m']?.groups === 6)
    assert.ok((await pane.locator('.stoch-settings summary').innerText()).includes('35 /'))
    await pane.locator('.stoch-settings summary').click()
    await pane.getByRole('button', { name: '隐藏指标', exact: true }).click()
    await pane.getByRole('button', { name: '显示指标', exact: true }).click()
    await page.getByTestId('drawing-lock').click()
    assert.equal(await page.getByTestId('drawing-lock').getAttribute('aria-pressed'), 'true')
    await page.getByTestId('drawing-lock').click()
    await page.getByTestId('replay-fullscreen-console').click()
    await page.waitForFunction(() => Boolean(document.fullscreenElement))
    await page.getByTestId('replay-fullscreen-console').click()
    await page.waitForFunction(() => !document.fullscreenElement)
  })
  await run('reload restores project, cursor, trades, drawings and four panes', async () => {
    const before = await projectState()
    await page.reload({ waitUntil: 'networkidle' })
    await loaded()
    await page.waitForFunction(() => document.querySelectorAll('.price-chart').length === 4)
    const after = await projectState()
    assert.equal(after.id, before.id)
    assert.equal(after.cursorTimestamp, before.cursorTimestamp)
    // Candle indices are relative to each loaded window and legitimately re-anchor.
    const stableTrades = trades => trades.map(({ candleIndex, ...trade }) => trade)
    assert.deepEqual(stableTrades(after.trades), stableTrades(before.trades))
    assert.deepEqual(after.drawings, before.drawings)
    assert.equal(after.panes.length, 4)
  })
  await page.screenshot({ path: `${evidencePrefix}-four-panes.png`, fullPage: true })
  await run('return to library, save project, reopen', async () => {
    await page.getByRole('button', { name: '项目库', exact: true }).click()
    await page.getByRole('heading', { name: '复盘项目库', exact: true }).waitFor()
    await page.getByLabel('项目名称', { exact: true }).fill('加载体验验证-已保存')
    await page.getByRole('button', { name: '保存并打开', exact: true }).click()
    await loaded()
    assert.equal((await projectState()).name, '加载体验验证-已保存')
  })
  await run('snapshot transport failure has a working retry', async () => {
    let injected = false
    const handler = route => {
      if (!injected && new URL(route.request().url()).searchParams.get('timeframe') === '1h') {
        injected = true
        return route.abort('failed')
      }
      return route.continue()
    }
    await page.route('**/api/market/snapshot?**', handler)
    await page.locator('.replay-pane select').first().selectOption('1h')
    await page.getByRole('alert').waitFor()
    assert.ok((await page.getByRole('alert').innerText()).includes('重试'))
    await page.getByRole('button', { name: '重试', exact: true }).click()
    await loaded()
    await page.getByRole('alert').waitFor({ state: 'hidden' })
    assert.equal(injected, true)
    await page.unroute('**/api/market/snapshot?**', handler)
  })
  if (!production && new URL(origin).protocol === 'https:') {
    checks.push({ name: 'browser cache reuse', result: 'N/A', reason: 'Chromium does not reuse scripts from this local self-signed TLS origin; production cache checked separately' })
  } else {
    await run('second page reuses cached versioned scripts', async () => {
      // Use a context without route interception, which disables browser caching.
      const cacheContext = await browser.newContext({ storageState: await context.storageState(), ignoreHTTPSErrors: true })
      const warm = await cacheContext.newPage()
      await warm.goto(origin, { waitUntil: 'networkidle' })
      await warm.locator('.price-chart canvas').first().waitFor()
      const cached = await cacheContext.newPage()
      await cached.goto(origin, { waitUntil: 'networkidle' })
      await cached.locator('.price-chart canvas').first().waitFor()
      const scripts = await cached.evaluate(() => performance.getEntriesByType('resource').filter(r => new URL(r.name).pathname.endsWith('.js')).map(r => ({ url: r.name, transferSize: r.transferSize })))
      assert.ok(scripts.length >= 2)
      assert.ok(scripts.every(r => r.transferSize === 0), JSON.stringify(scripts))
      await cacheContext.close()
    })
  }
  assert.deepEqual(errors, [])
  await writeFile(`${evidencePrefix}-browser-results.json`, JSON.stringify({ origin, source: production ? 'deployed frontend + production Nginx + Rust + complete real Parquet' : 'real Rust + local Parquet + Nginx TLS + production frontend', metadata, checks, errors }, null, 2))
  console.log(JSON.stringify({ result: 'pass', checks }, null, 2))
} catch (error) {
  await page.screenshot({ path: `${evidencePrefix}-browser-failure.png`, fullPage: true }).catch(() => {})
  await writeFile(`${evidencePrefix}-browser-results.json`, JSON.stringify({ origin, checks, errors, failure: error.stack, visibleText: await page.locator('body').innerText() }, null, 2))
  throw error
} finally { await browser.close() }
