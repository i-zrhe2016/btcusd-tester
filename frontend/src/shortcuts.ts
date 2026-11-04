import { t } from './i18n'
import { scopedStorageKey } from './userStorage'

export const shortcutActions = [
  { id: 'forward', labelKey: 'shortcut.forward', key: ' ' },
  { id: 'backward', labelKey: 'shortcut.backward', key: 'backspace' },
  { id: 'play', labelKey: 'shortcut.play', key: 'a' },
  { id: 'buy', labelKey: 'shortcut.buy', key: 'b' },
  { id: 'sell', labelKey: 'shortcut.sell', key: 's' },
  { id: 'trend', labelKey: 'shortcut.trend', key: 'c' },
] as const
export type ShortcutAction = typeof shortcutActions[number]['id']
export type ShortcutBindings = Record<ShortcutAction, string>
export const shortcutStorageKey = 'btcusd.replay.shortcuts.v1'
export const defaultShortcuts = Object.fromEntries(shortcutActions.map(action => [action.id, action.key])) as ShortcutBindings
export function shortcutActionLabel(id: ShortcutAction): string {
  const action = shortcutActions.find(item => item.id === id)
  return action ? t(action.labelKey) : id
}
export function validShortcut(key: string) {
  return [' ', 'backspace', 'enter', 'arrowup', 'arrowdown', 'arrowleft', 'arrowright'].includes(key) || /^[a-z0-9]$/.test(key)
}
export function loadShortcuts(): ShortcutBindings {
  try {
    const saved = JSON.parse(localStorage.getItem(scopedStorageKey(shortcutStorageKey)) ?? 'null')
    if (saved && shortcutActions.every(action => typeof saved[action.id] === 'string' && validShortcut(saved[action.id])) && new Set(shortcutActions.map(action => saved[action.id])).size === shortcutActions.length) return saved
  } catch { /* Use defaults when browser storage is unavailable. */ }
  return { ...defaultShortcuts }
}
export function shortcutLabel(key: string) {
  const labels: Record<string, string> = {
    ' ': t('shortcut.space'),
    backspace: t('shortcut.backspace'),
    enter: t('shortcut.enter'),
    arrowup: '↑',
    arrowdown: '↓',
    arrowleft: '←',
    arrowright: '→',
  }
  return labels[key] ?? key.toUpperCase()
}
