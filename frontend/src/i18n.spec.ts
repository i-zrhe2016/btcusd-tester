import { afterEach, describe, expect, it } from 'vitest'
import { formatUtc } from './format'
import { locale, resolveLocale, setLocale, t, timeframeLabel } from './i18n'

afterEach(() => {
  setLocale('zh')
})

describe('Chinese and English support', () => {
  it('interpolates placeholders in Chinese', () => {
    setLocale('zh')
    expect(t('app.paneN', { n: 2 })).toBe('第 2 屏')
    expect(timeframeLabel('1h')).toBe('1 小时')
  })

  it('switches to English and updates the document language', () => {
    setLocale('en')
    expect(locale.value).toBe('en')
    expect(document.documentElement.lang).toBe('en')
    expect(document.title).toBe('grailab · Market replay and trading practice')
    expect(t('app.paneN', { n: 2 })).toBe('Pane 2')
    expect(timeframeLabel('1h')).toBe('1h')
  })

  it('formats dates with the active locale', () => {
    const timestamp = Date.UTC(2023, 10, 14, 22, 13) / 1000
    setLocale('zh')
    const chinese = formatUtc(timestamp)
    setLocale('en')
    const english = formatUtc(timestamp)
    expect(chinese).not.toBe(english)
    expect(chinese).toContain('2023')
  })
})

describe('browser language detection', () => {
  it.each(['zh', 'zh-CN', 'zh-TW', 'zh-Hans-CN', 'ZH-cn'])('uses Chinese for %s', language => {
    expect(resolveLocale([language])).toBe('zh')
  })

  it.each(['en', 'en-US', 'en-GB', 'ja-JP', 'de', 'fr-FR', ''])('falls back to English for %s', language => {
    expect(resolveLocale([language])).toBe('en')
  })

  it('uses English when the browser reports no languages', () => {
    expect(resolveLocale([])).toBe('en')
  })

  it('only considers the primary browser language', () => {
    expect(resolveLocale(['zh-CN', 'en-US'])).toBe('zh')
    expect(resolveLocale(['en-US', 'zh-CN'])).toBe('en')
  })
})
