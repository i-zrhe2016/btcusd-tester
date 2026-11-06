import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'

const json = (body: unknown, status = 200) => ({ ok: true, status, json: async () => body }) as Response

beforeEach(() => {
  vi.resetModules()
  vi.stubGlobal('fetch', vi.fn())
})

afterEach(() => {
  vi.unstubAllGlobals()
})

describe('feedback API', () => {
  it('creates a thread from the draft', async () => {
    vi.mocked(fetch).mockResolvedValueOnce(json({ id: 'thread-1' }, 201))
    const { createFeedback } = await import('./api')
    await createFeedback({ title: '图表卡住', body: '切换到 5 分钟周期后不播放。', category: 'bug' })
    const [url, init] = vi.mocked(fetch).mock.calls[0]!
    expect(String(url)).toBe('/api/feedback')
    expect(init).toMatchObject({
      method: 'POST',
      body: JSON.stringify({ title: '图表卡住', body: '切换到 5 分钟周期后不播放。', category: 'bug' }),
    })
    expect((init?.headers as Record<string, string>)['Content-Type']).toBe('application/json')
  })

  it('reads a thread and posts its follow-up message', async () => {
    vi.mocked(fetch)
      .mockResolvedValueOnce(json({ thread: { id: 'thread-1' }, messages: [] }))
      .mockResolvedValueOnce(json({ id: 'message-2', author: 'user', body: '补充', createdAt: '2026-11-06T00:00:00Z' }, 201))
    const { getFeedback, replyFeedback } = await import('./api')

    await expect(getFeedback('thread-1')).resolves.toMatchObject({ thread: { id: 'thread-1' } })
    await expect(replyFeedback('thread-1', '补充')).resolves.toMatchObject({ id: 'message-2' })

    const [readUrl] = vi.mocked(fetch).mock.calls[0]!
    const [replyUrl, replyInit] = vi.mocked(fetch).mock.calls[1]!
    expect(String(readUrl)).toBe('/api/feedback/thread-1')
    expect(String(replyUrl)).toBe('/api/feedback/thread-1/messages')
    expect(replyInit).toMatchObject({ method: 'POST', body: JSON.stringify({ body: '补充' }) })
  })

  it('surfaces the API error message', async () => {
    vi.mocked(fetch).mockResolvedValueOnce({
      ok: false,
      status: 400,
      json: async () => ({ message: 'body must contain between 1 and 4000 characters' }),
    } as Response)
    const { createFeedback } = await import('./api')
    await expect(createFeedback({ title: 't', body: ' ', category: 'other' })).rejects.toThrow(
      'body must contain between 1 and 4000 characters',
    )
  })
})
