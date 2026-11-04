import { markRaw } from 'vue'
import { getAuthToken } from './auth'
import { t } from './i18n'
import type {
  MarketMetadata,
  MarketSnapshot,
} from './types'

interface ApiErrorBody {
  code?: string
  message?: string
}

async function requestJson<T>(input: RequestInfo | URL, init?: RequestInit): Promise<T> {
  const token = await getAuthToken()
  const response = await fetch(input, {
    ...init,
    headers: {
      Accept: 'application/json',
      ...(token ? { Authorization: `Bearer ${token}` } : {}),
      ...(init?.body ? { 'Content-Type': 'application/json' } : {}),
      ...init?.headers,
    },
  })
  if (!response.ok) {
    let body: ApiErrorBody = {}
    try {
      body = (await response.json()) as ApiErrorBody
    } catch {
      // The status text is a safe fallback when an upstream returns no JSON.
    }
    throw new Error(body.message || t('api.requestFailed', { status: response.status }))
  }
  return (await response.json()) as T
}

export function getPaymentStatus(order: string): Promise<{ status: 'paid' | 'pending' }> {
  return requestJson(`/api/payments/status?order=${encodeURIComponent(order)}`)
}

export function createCheckout(): Promise<{ checkoutUrl: string }> {
  return requestJson('/api/payments/checkout', { method: 'POST' })
}

export function getMarketMetadata(): Promise<MarketMetadata> {
  return requestJson('/api/market/meta')
}

const snapshotCache = new Map<string, { snapshot: MarketSnapshot; expiresAt: number }>()
const pendingSnapshots = new Map<string, Promise<MarketSnapshot>>()
const SNAPSHOT_CACHE_LIMIT = 24
const SNAPSHOT_CACHE_TTL = 5 * 60 * 1000

export function getMarketSnapshot(params: {
  timeframe: string
  from: number
  to: number
  limit?: number
  lengths: [number, number, number]
}): Promise<MarketSnapshot> {
  const query = new URLSearchParams({
    symbol: 'BTCUSD',
    timeframe: params.timeframe,
    from: String(params.from),
    to: String(params.to),
    limit: String(params.limit ?? 500),
    lengths: params.lengths.join(','),
  })
  const key = query.toString()
  const cached = snapshotCache.get(key)
  if (cached && cached.expiresAt > Date.now()) {
    snapshotCache.delete(key)
    snapshotCache.set(key, cached)
    return Promise.resolve(cached.snapshot)
  }
  snapshotCache.delete(key)
  const pending = pendingSnapshots.get(key)
  if (pending) return pending

  const request = requestJson<MarketSnapshot>(`/api/market/snapshot?${query}`)
    .then((snapshot) => {
      // Snapshots are replaced as a whole; keep candle reads out of Vue's deep proxy.
      markRaw(snapshot)
      snapshotCache.set(key, { snapshot, expiresAt: Date.now() + SNAPSHOT_CACHE_TTL })
      while (snapshotCache.size > SNAPSHOT_CACHE_LIMIT) {
        snapshotCache.delete(snapshotCache.keys().next().value!)
      }
      return snapshot
    })
    .finally(() => pendingSnapshots.delete(key))
  pendingSnapshots.set(key, request)
  return request
}
