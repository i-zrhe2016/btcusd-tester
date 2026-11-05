import { describe, expect, it } from 'vitest'
import {
  DRAWING_COLOR_PRESETS,
  MAX_RECENT_COLORS,
  addRecentColor,
  normalizeHexColor,
  readRecentColors,
} from './drawingStyle'

describe('normalizeHexColor', () => {
  it('accepts six-digit colors with or without a hash and lowers the case', () => {
    expect(normalizeHexColor('#38BDF8')).toBe('#38bdf8')
    expect(normalizeHexColor('38bdf8')).toBe('#38bdf8')
    expect(normalizeHexColor('  #FACC15  ')).toBe('#facc15')
  })

  it('expands three-digit colors', () => {
    expect(normalizeHexColor('#abc')).toBe('#aabbcc')
    expect(normalizeHexColor('0f8')).toBe('#00ff88')
  })

  it('rejects malformed values', () => {
    for (const value of ['#12', '#12345', '#gggggg', 'red', '', '#', '##ffffff']) {
      expect(normalizeHexColor(value)).toBeNull()
    }
  })
})

describe('addRecentColor', () => {
  it('prepends new colors', () => {
    expect(addRecentColor(['#facc15'], '#38bdf8')).toEqual(['#38bdf8', '#facc15'])
  })

  it('de-dupes case-insensitively and moves the color to the front', () => {
    expect(addRecentColor(['#38bdf8', '#facc15'], '#38BDF8')).toEqual(['#38bdf8', '#facc15'])
  })

  it('caps the list', () => {
    const list = Array.from({ length: MAX_RECENT_COLORS }, (_, index) => `#0000${index.toString(16).padStart(2, '0')}`)
    const next = addRecentColor(list, '#ffffff')
    expect(next).toHaveLength(MAX_RECENT_COLORS)
    expect(next[0]).toBe('#ffffff')
  })

  it('ignores invalid colors without losing the existing list', () => {
    expect(addRecentColor(['#facc15'], 'nope')).toEqual(['#facc15'])
  })
})

describe('readRecentColors', () => {
  it('returns an empty list for missing or malformed data', () => {
    expect(readRecentColors(null)).toEqual([])
    expect(readRecentColors('{')).toEqual([])
    expect(readRecentColors('"#fff"')).toEqual([])
  })

  it('normalizes, filters and de-dupes persisted entries', () => {
    expect(readRecentColors(JSON.stringify(['#ABC', 'red', 12, '#aabbcc', '#38bdf8']))).toEqual(['#aabbcc', '#38bdf8'])
  })

  it('caps persisted entries', () => {
    const raw = JSON.stringify(Array.from({ length: 20 }, (_, index) => `#0000${index.toString(16).padStart(2, '0')}`))
    expect(readRecentColors(raw)).toHaveLength(MAX_RECENT_COLORS)
  })
})

describe('DRAWING_COLOR_PRESETS', () => {
  it('offers a chart-tuned palette starting with the default amber', () => {
    expect(DRAWING_COLOR_PRESETS).toHaveLength(12)
    expect(DRAWING_COLOR_PRESETS[0]).toBe('#facc15')
    for (const color of DRAWING_COLOR_PRESETS) {
      expect(normalizeHexColor(color)).toBe(color)
    }
  })
})
