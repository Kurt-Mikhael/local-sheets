const ACCOUNT_CACHE_KEY = 'localsheet:last-account'

export type CachedRole = 'user' | 'admin'

interface CachedAccount {
  id: string
  email: string
  role: CachedRole
  cachedAt: string
}

function parse(raw: string | null): CachedAccount | null {
  if (!raw) return null
  try {
    const parsed = JSON.parse(raw) as CachedAccount
    if (!parsed.id || !parsed.email || (parsed.role !== 'user' && parsed.role !== 'admin')) {
      return null
    }
    return parsed
  } catch {
    return null
  }
}

export function readCachedAccount(): CachedAccount | null {
  if (typeof localStorage === 'undefined') return null
  return parse(localStorage.getItem(ACCOUNT_CACHE_KEY))
}

export function readCachedAccountId(): string | null {
  return readCachedAccount()?.id ?? null
}

export function writeCachedAccount(account: { id: string; email: string; role: CachedRole }): void {
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
