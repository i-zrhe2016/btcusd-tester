import { afterEach, describe, expect, it } from 'vitest'
import { hasStorageUser, scopedStorageKey, setStorageUser } from './userStorage'

afterEach(() => setStorageUser(null))

describe('user-scoped browser storage', () => {
  it('separates keys per Clerk subject', () => {
    setStorageUser('user_alice')
    expect(hasStorageUser()).toBe(true)
    expect(scopedStorageKey('btcusd.replay.projects.v2')).toBe('btcusd.replay.projects.v2.u.user_alice')

    setStorageUser('user_bob')
    expect(scopedStorageKey('btcusd.replay.projects.v2')).toBe('btcusd.replay.projects.v2.u.user_bob')
  })

  it('falls back to the unscoped key without a verified subject', () => {
    for (const value of [undefined, null, '', 'guest', 'user_', 'user_a b', 'user_' + 'a'.repeat(300)]) {
      setStorageUser(value)
      expect(hasStorageUser()).toBe(false)
      expect(scopedStorageKey('btcusd.replay.projects.v2')).toBe('btcusd.replay.projects.v2')
    }
  })
})
