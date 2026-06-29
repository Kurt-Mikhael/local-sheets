const ACCOUNT_CACHE_KEY = 'localsheet:last-account'

interface CachedAccount {
  id: string
  email: string
  role: 'user' | 'admin'
  cachedAt: string
}

export function readCachedAccount(): CachedAccount | null {
  if (typeof localStorage === 'undefined') return null
  try {
    const raw = localStorage.getItem(ACCOUNT_CACHE_KEY)
    if (!raw) return null
    const parsed = JSON.parse(raw) as CachedAccount
    if (!parsed.id || !parsed.email || (parsed.role !== 'user' && parsed.role !== 'admin')) {
      return null
    }
    return parsed
  } catch {
    return null
  }
}

export function writeCachedAccount(account: { id: string; email: string; role: 'user' | 'admin' }): void {
  if (typeof localStorage === 'undefined') return
  try {
    const payload: CachedAccount = { ...account, cachedAt: new Date().toISOString() }
    localStorage.setItem(ACCOUNT_CACHE_KEY, JSON.stringify(payload))
  } catch {}
}

export function clearCachedAccount(): void {
  if (typeof localStorage === 'undefined') return
  try {
    localStorage.removeItem(ACCOUNT_CACHE_KEY)
  } catch {}
}
