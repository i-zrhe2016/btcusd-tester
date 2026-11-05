// Drawing style presets and recent-color helpers. Kept free of Vue and DOM so the
// palette rules can be unit-tested without mounting the chart.
export const DRAWING_COLOR_PRESETS = [
  '#facc15',
  '#f5e6c8',
  '#dbe4ee',
  '#94a3b8',
  '#38bdf8',
  '#60a5fa',
  '#4ade80',
  '#2dd4bf',
  '#fb7185',
  '#f97316',
  '#a78bfa',
  '#ffffff',
] as const

export const RECENT_COLORS_KEY = 'btcusd.drawing.recentColors.v1'
export const MAX_RECENT_COLORS = 8

const HEX_COLOR = /^#?([\da-f]{3}|[\da-f]{6})$/i

/** Accept `#abc`, `#aabbcc` or the same values without `#`; return lower-case `#rrggbb`. */
export function normalizeHexColor(value: string): string | null {
  if (typeof value !== 'string') return null
  const match = HEX_COLOR.exec(value.trim())
  if (!match) return null
  const digits = match[1].toLowerCase()
  const expanded = digits.length === 3
    ? digits.split('').map((digit) => digit + digit).join('')
    : digits
  return `#${expanded}`
}

/** Newest first, case-insensitive de-dupe, capped. Invalid colors are ignored. */
export function addRecentColor(list: readonly string[], color: string): string[] {
  const normalized = normalizeHexColor(color)
  if (!normalized) return [...list]
  return [normalized, ...list.filter((item) => normalizeHexColor(item) !== normalized)]
    .slice(0, MAX_RECENT_COLORS)
}

/** Parse a persisted recent-color list, tolerating missing, corrupt or partial data. */
export function readRecentColors(raw: string | null): string[] {
  if (!raw) return []
  let parsed: unknown
  try {
    parsed = JSON.parse(raw)
  } catch {
    return []
  }
  if (!Array.isArray(parsed)) return []
  const colors: string[] = []
  for (const item of parsed) {
    if (typeof item !== 'string') continue
    const normalized = normalizeHexColor(item)
    if (!normalized || colors.includes(normalized)) continue
    colors.push(normalized)
    if (colors.length === MAX_RECENT_COLORS) break
  }
  return colors
}
