// Browser storage is shared by every account that signs in on the same origin.
// Scope every user-owned key with the verified Clerk subject so a device handed
// between accounts never shows another user's workspace state.
const CLERK_SUBJECT = /^user_[A-Za-z0-9_]{1,250}$/

let storageUser = ''

export function setStorageUser(userId: string | null | undefined): void {
  storageUser = typeof userId === 'string' && CLERK_SUBJECT.test(userId.trim())
    ? userId.trim()
    : ''
}

export function scopedStorageKey(key: string): string {
  return storageUser ? `${key}.u.${storageUser}` : key
}

export function hasStorageUser(): boolean {
  return Boolean(storageUser)
}

export function browserStorage(): Storage | null {
  if (typeof window === 'undefined') return null
  try {
    return window.localStorage
  } catch {
    // Storage can be blocked by browser privacy settings.
    return null
  }
}
