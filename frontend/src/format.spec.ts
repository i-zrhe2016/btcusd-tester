import { describe, expect, it } from 'vitest'
import { formatUtcMonth } from './format'

describe('formatUtcMonth', () => {
  it('formats coverage boundaries as fixed-width UTC months', () => {
    expect(formatUtcMonth(Date.UTC(2013, 9, 6, 0, 14) / 1000)).toBe('2013-10')
    expect(formatUtcMonth(Date.UTC(2026, 0, 1, 0, 0) / 1000)).toBe('2026-01')
    expect(formatUtcMonth(Date.UTC(2026, 11, 31, 23, 59) / 1000)).toBe('2026-12')
  })
})
