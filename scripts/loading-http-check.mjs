import assert from 'node:assert/strict'
import { request as httpsRequest } from 'node:https'
import { request as httpRequest } from 'node:http'
import { gunzipSync } from 'node:zlib'
import { mkdir, writeFile } from 'node:fs/promises'
const origin = process.argv[2] ?? 'https://localhost:8448'
const production = process.argv.includes('--allow-production') && new URL(origin).hostname === 'deploy.taile2c45c.ts.net' && new URL(origin).port === '8083'
if (!['localhost', '127.0.0.1'].includes(new URL(origin).hostname) && !production) throw new Error('Use localhost or explicitly authorize the known production origin')
const request = new URL(origin).protocol === 'https:' ? httpsRequest : httpRequest
const get = (path, headers = {}) => new Promise((resolve, reject) => {
  request(new URL(path, origin), { rejectUnauthorized: false, headers }, response => {
    const chunks = []
    response.on('data', data => chunks.push(data))
    response.on('end', () => resolve({ status: response.statusCode, headers: response.headers, body: Buffer.concat(chunks) }))
  }).on('error', reject).end()
})
const index = await get('/')
assert.equal(index.status, 200)
assert.equal(index.headers['cache-control'], 'no-cache')
const asset = index.body.toString().match(/src="([^"]+\.js)"/)[1]
const plain = await get(asset)
const zipped = await get(asset, { 'Accept-Encoding': 'gzip' })
assert.equal(zipped.headers['content-encoding'], 'gzip')
assert.match(zipped.headers.vary, /Accept-Encoding/)
assert.match(zipped.headers['cache-control'], /max-age=31536000, immutable/)
assert.deepEqual(gunzipSync(zipped.body), plain.body)
for (const response of [index, plain, zipped]) {
  assert.equal(response.headers['x-content-type-options'], 'nosniff')
  assert.ok(response.headers['content-security-policy'].includes("default-src 'self'"))
}
const revalidated = await get('/index.html', { 'If-None-Match': index.headers.etag })
assert.equal(revalidated.status, 304)
assert.equal(revalidated.headers['cache-control'], 'no-cache')
const route = await get('/replay')
assert.equal(route.status, 200)
assert.deepEqual(route.body, index.body)
assert.equal(route.headers['cache-control'], 'no-cache')
const missing = await get('/assets/missing-12345678.js')
assert.equal(missing.status, 404)
assert.equal(missing.headers['cache-control'], undefined)
assert.equal(missing.headers['x-content-type-options'], 'nosniff')
const metaResponse = await get('/api/market/meta')
const meta = JSON.parse(metaResponse.body)
assert.equal(metaResponse.status, 200)
assert.equal(meta.source, 'Parquet')
assert.ok(meta.candle_count > 0)
assert.equal(metaResponse.headers['cache-control'], undefined)
const snapshot = await get(`/api/market/snapshot?timeframe=1m&from=${meta.first_timestamp}&to=${meta.first_timestamp + 120}&limit=5`)
const body = JSON.parse(snapshot.body)
assert.equal(snapshot.status, 200)
assert.equal(body.candles[0].timestamp, meta.first_timestamp)
assert.ok(body.candles.every(c => c.timestamp < meta.first_timestamp + 120))
assert.equal(body.candles.length, 2)
assert.ok(Array.isArray(body.stochastic))
const invalid = await get('/api/market/snapshot?from=120&to=60')
const failure = JSON.parse(invalid.body)
assert.equal(invalid.status, 400)
assert.equal(failure.code, 'invalid_request')
assert.equal(failure.message, 'invalid request: from must be earlier than to')
assert.match(invalid.headers['content-type'], /application\/json/)
const result = { result: 'pass', origin, asset, bytes: plain.body.length, gzipBytes: zipped.body.length, htmlRevalidatedStatus: revalidated.status, missingAssetStatus: missing.status, actualParquetCandles: meta.candle_count, checks: ['gzip decoded payload identical', 'immutable hashed asset', 'HTML no-cache and 304', 'SPA route fallback', 'missing asset 404 without long cache', 'security headers retained', 'real Rust API via proxy', 'snapshot inclusive from/exclusive to', 'structured API error', 'no immutable API cache'] }
await mkdir('docs/testing/evidence', { recursive: true })
await writeFile(`docs/testing/evidence/${production ? 'production' : 'loading'}-http-results.json`, JSON.stringify(result, null, 2))
console.log(JSON.stringify(result, null, 2))
