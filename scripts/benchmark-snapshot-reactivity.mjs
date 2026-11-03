// Isolates Vue candle-read overhead; does not measure full chart rendering or network latency.
import { createRequire } from 'node:module'
import assert from 'node:assert/strict'
const require = createRequire(import.meta.url)
const { reactive, markRaw } = require('../frontend/node_modules/vue')
const count = 5000
function snapshot() {
  return { candles: Array.from({ length: count }, (_, i) => ({ timestamp: i * 60, open: i, high: i + 2, low: i - 1, close: i + 1, volume: 1 })) }
}
const deep = reactive({ snapshot: snapshot() })
const raw = reactive({ snapshot: markRaw(snapshot()) })
function read(pane) {
  let sum = 0
  for (const candle of pane.snapshot.candles) sum += candle.close + candle.high + candle.low + candle.volume
  return sum
}
assert.equal(read(deep), read(raw))
function measure(pane) {
  const start = performance.now()
  let sum = 0
  for (let i = 0; i < 200; i++) sum += read(pane)
  return { milliseconds: performance.now() - start, sum }
}
for (let i = 0; i < 20; i++) { read(deep); read(raw) }
const results = { deep: [], raw: [] }
for (let trial = 0; trial < 7; trial++) {
  for (const key of trial % 2 ? ['raw', 'deep'] : ['deep', 'raw']) {
    const result = measure(key === 'deep' ? deep : raw)
    assert.equal(result.sum, read(raw) * 200)
    results[key].push(result.milliseconds)
  }
}
const median = (values) => [...values].sort((a, b) => a - b)[Math.floor(values.length / 2)]
console.log(JSON.stringify({ candles: count, readsPerTrial: 200, trials: 7, medianMs: { deep: median(results.deep), raw: median(results.raw) }, note: 'Synthetic candle-read microbenchmark only; not end-to-end switching speed.' }, null, 2))
