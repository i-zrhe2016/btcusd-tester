export type FeedbackCategory = 'bug' | 'idea' | 'other'
export type FeedbackStatus = 'open' | 'in_progress' | 'resolved'
export type FeedbackAuthor = 'user' | 'team'

export interface FeedbackThread {
  id: string
  title: string
  category: FeedbackCategory
  status: FeedbackStatus
  authorCode: string
  mine: boolean
  messageCount: number
  lastBody: string
  createdAt: string
  updatedAt: string
}

export interface FeedbackMessage {
  id: string
  author: FeedbackAuthor
  body: string
  createdAt: string
}

export interface FeedbackThreadDetail {
  thread: FeedbackThread
  messages: FeedbackMessage[]
}

export interface FeedbackDraft {
  title: string
  body: string
  category: FeedbackCategory
}

export const FEEDBACK_TITLE_LIMIT = 120
export const FEEDBACK_BODY_LIMIT = 4000
export const FEEDBACK_CATEGORIES: readonly FeedbackCategory[] = ['bug', 'idea', 'other']

export type FeedbackFieldError = 'titleRequired' | 'titleTooLong' | 'bodyRequired' | 'bodyTooLong'

/** Mirrors the server checks so the composer can name the problem before a round trip. */
export function validateFeedbackDraft(draft: Pick<FeedbackDraft, 'title' | 'body'>): FeedbackFieldError | null {
  const title = draft.title.trim()
  const body = draft.body.trim()
  if (!title) return 'titleRequired'
  if (title.length > FEEDBACK_TITLE_LIMIT) return 'titleTooLong'
  if (!body) return 'bodyRequired'
  if (body.length > FEEDBACK_BODY_LIMIT) return 'bodyTooLong'
  return null
}

export function isFeedbackCategory(value: unknown): value is FeedbackCategory {
  return typeof value === 'string' && (FEEDBACK_CATEGORIES as readonly string[]).includes(value)
}

/** Server timestamps are ISO strings; the product shows every wall clock in UTC. */
export function feedbackTimestamp(value: string): number {
  const timestamp = Date.parse(value)
  return Number.isFinite(timestamp) ? Math.floor(timestamp / 1000) : 0
}
