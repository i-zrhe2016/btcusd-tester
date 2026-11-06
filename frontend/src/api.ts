import { markRaw } from 'vue'
import { normalizeSymbol } from './symbols'
import { getAuthToken } from './auth'
import { t } from './i18n'
import type { ReplayProject } from './replay'
import type {
  FeedbackDraft,
  FeedbackMessage,
  FeedbackThread,
  FeedbackThreadDetail,
} from './feedback'
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
  if (response.status === 204) return undefined as T
  return (await response.json()) as T
}

export function listProjects(): Promise<ReplayProject[]> {
  return requestJson<ReplayProject[]>('/api/projects')
}

export function saveProject(project: ReplayProject, options: { keepalive?: boolean } = {}): Promise<ReplayProject> {
  return requestJson<ReplayProject>(`/api/projects/${encodeURIComponent(project.id)}`, {
    method: 'PUT',
    body: JSON.stringify(project),
    keepalive: options.keepalive,
  })
}

export function deleteProject(id: string): Promise<void> {
  return requestJson<void>(`/api/projects/${encodeURIComponent(id)}`, { method: 'DELETE' })
}

export function listFeedback(): Promise<FeedbackThread[]> {
  return requestJson<FeedbackThread[]>('/api/feedback')
}

export function createFeedback(draft: FeedbackDraft): Promise<FeedbackThread> {
  return requestJson<FeedbackThread>('/api/feedback', {
    method: 'POST',
    body: JSON.stringify(draft),
  })
}

export function getFeedback(id: string): Promise<FeedbackThreadDetail> {
  return requestJson<FeedbackThreadDetail>(`/api/feedback/${encodeURIComponent(id)}`)
}

export function replyFeedback(id: string, body: string): Promise<FeedbackMessage> {
  return requestJson<FeedbackMessage>(`/api/feedback/${encodeURIComponent(id)}/messages`, {
    method: 'POST',
    body: JSON.stringify({ body }),
  })
}

export function getPaymentStatus(order: string): Promise<{ status: 'paid' | 'pending' }> {
  return requestJson(`/api/payments/status?order=${encodeURIComponent(order)}`)
}

export function createCheckout(): Promise<{ checkoutUrl: string }> {
  return requestJson('/api/payments/checkout', { method: 'POST' })
}

export function getMarketMetadata(symbol = 'BTCUSD', options: { fresh?: boolean } = {}): Promise<MarketMetadata> {
  const normalized = normalizeSymbol(symbol)
  return requestJson<MarketMetadata>(
    `/api/market/meta?${new URLSearchParams({ symbol: normalized })}`,
    options.fresh ? { cache: 'no-store' } : undefined,
  )
    .then((metadata) => {
      if (normalizeSymbol(metadata.symbol) !== normalized) {
        throw new Error(`Market metadata symbol mismatch: expected ${normalized}, received ${metadata.symbol}`)
      }
      return metadata
    })
}

const snapshotCache = new Map<string, { snapshot: MarketSnapshot; expiresAt: number }>()
const pendingSnapshots = new Map<string, Promise<MarketSnapshot>>()
const SNAPSHOT_CACHE_LIMIT = 24
const SNAPSHOT_CACHE_TTL = 5 * 60 * 1000

export function getMarketSnapshot(params: {
  symbol?: string
  timeframe: string
  from: number
  to: number
  limit?: number
  lengths: [number, number, number]
  fresh?: boolean
}): Promise<MarketSnapshot> {
  const query = new URLSearchParams({
    symbol: normalizeSymbol(params.symbol ?? 'BTCUSD'),
    timeframe: params.timeframe,
    from: String(params.from),
    to: String(params.to),
    limit: String(params.limit ?? 500),
    lengths: params.lengths.join(','),
  })
  const key = query.toString()
  if (!params.fresh) {
    const cached = snapshotCache.get(key)
    if (cached && cached.expiresAt > Date.now()) {
      snapshotCache.delete(key)
      snapshotCache.set(key, cached)
      return Promise.resolve(cached.snapshot)
    }
    const pending = pendingSnapshots.get(key)
    if (pending) return pending
  }
  snapshotCache.delete(key)

  const request = requestJson<MarketSnapshot>(`/api/market/snapshot?${query}`)
    .then((snapshot) => {
      if (normalizeSymbol(snapshot.symbol) !== query.get('symbol')) {
        throw new Error(`Market data symbol mismatch: expected ${query.get('symbol')}, received ${snapshot.symbol}`)
      }
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
