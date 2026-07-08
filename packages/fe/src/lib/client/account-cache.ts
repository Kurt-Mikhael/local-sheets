export type Role = 'user' | 'admin' | 'super_admin'

export interface Account {
  id: string
  email: string
  role: Role
}

const ACCOUNT_CACHE_KEY = 'localsheet:last-account'

function parse(raw: string | null): Account | null {
  if (!raw) return null
  try {
    const parsed = JSON.parse(raw) as Account
    if (!parsed.id || !parsed.email || (parsed.role !== 'user' && parsed.role !== 'admin' && parsed.role !== 'super_admin')) {
      return null
    }
    return parsed
  } catch {
    return null
  }
}

export function readCachedAccount(): Account | null {
  if (typeof localStorage === 'undefined') return null
  return parse(localStorage.getItem(ACCOUNT_CACHE_KEY))
}

export function writeCachedAccount(account: Account): void {
  if (typeof localStorage === 'undefined') return
  try {
    const payload: Account = { ...account }
    localStorage.setItem(ACCOUNT_CACHE_KEY, JSON.stringify(payload))
  } catch {}
}

export function clearCachedAccount(): void {
  if (typeof localStorage === 'undefined') return
  try {
    localStorage.removeItem(ACCOUNT_CACHE_KEY)
  } catch {}
}
