import { afterEach, describe, expect, it } from 'vitest'
import { formatUtc } from './format'
import { locale, setLocale, t, timeframeLabel, toggleLocale } from './i18n'

afterEach(() => {
  setLocale('zh')
  document.documentElement.lang = ''
})

describe('Chinese and English support', () => {
  it('defaults to Chinese and interpolates placeholders', () => {
    expect(locale.value).toBe('zh')
    expect(t('app.paneN', { n: 2 })).toBe('第 2 屏')
    expect(timeframeLabel('1h')).toBe('1 小时')
  })

  it('switches to English, persists the choice and updates the document language', () => {
    setLocale('en')
    expect(locale.value).toBe('en')
    expect(localStorage.getItem('btcusd.locale.v1')).toBe('en')
    expect(document.documentElement.lang).toBe('en')
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

  it('toggles back to Chinese', () => {
    setLocale('en')
    toggleLocale()
    expect(locale.value).toBe('zh')
    expect(localStorage.getItem('btcusd.locale.v1')).toBe('zh')
  })
})
