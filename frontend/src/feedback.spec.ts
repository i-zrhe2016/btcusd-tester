import { describe, expect, it } from 'vitest'
import {
  FEEDBACK_BODY_LIMIT,
  FEEDBACK_TITLE_LIMIT,
  feedbackTimestamp,
  isFeedbackCategory,
  validateFeedbackDraft,
} from './feedback'

describe('feedback draft validation', () => {
  it('accepts a normal bug report', () => {
    expect(validateFeedbackDraft({ title: '图表卡住', body: '切换到 5 分钟周期后不再播放。' })).toBeNull()
  })

  it('names the first empty field', () => {
    expect(validateFeedbackDraft({ title: '   ', body: 'details' })).toBe('titleRequired')
    expect(validateFeedbackDraft({ title: 'title', body: '\n ' })).toBe('bodyRequired')
  })

  it('enforces the server limits on trimmed content', () => {
    expect(validateFeedbackDraft({ title: 't'.repeat(FEEDBACK_TITLE_LIMIT), body: 'body' })).toBeNull()
    expect(validateFeedbackDraft({ title: 't'.repeat(FEEDBACK_TITLE_LIMIT + 1), body: 'body' })).toBe('titleTooLong')
    expect(validateFeedbackDraft({ title: 'title', body: 'b'.repeat(FEEDBACK_BODY_LIMIT) })).toBeNull()
    expect(validateFeedbackDraft({ title: 'title', body: 'b'.repeat(FEEDBACK_BODY_LIMIT + 1) })).toBe('bodyTooLong')
  })
})

describe('feedback metadata helpers', () => {
  it('only accepts the three categories the API stores', () => {
    expect(['bug', 'idea', 'other'].every(isFeedbackCategory)).toBe(true)
    expect(isFeedbackCategory('praise')).toBe(false)
    expect(isFeedbackCategory(null)).toBe(false)
  })

  it('converts server timestamps to UTC seconds and falls back to zero', () => {
    expect(feedbackTimestamp('2026-11-06T14:32:00.000Z')).toBe(Date.UTC(2026, 10, 6, 14, 32) / 1000)
    expect(feedbackTimestamp('not a date')).toBe(0)
  })
})
