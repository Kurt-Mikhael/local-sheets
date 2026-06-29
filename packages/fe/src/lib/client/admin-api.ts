export interface AdminUser {
  id: string
  email: string
  role: 'user' | 'admin'
}

export interface WorkbookAccess {
  userId: string
  email: string
  grantedAt: string
}

interface ApiOptions {
  method?: 'GET' | 'POST' | 'DELETE'
  body?: unknown
}

async function adminFetch<T>(path: string, opts: ApiOptions = {}): Promise<T> {
  const res = await fetch(`/api/admin${path}`, {
    method: opts.method ?? 'GET',
    headers: {
      'Content-Type': 'application/json',
      'X-Requested-With': 'offline-spreadsheet',
    },
    credentials: 'same-origin',
    body: opts.body !== undefined ? JSON.stringify(opts.body) : undefined,
  })
  if (!res.ok) {
    const err = (await res.json().catch(() => ({ error: 'Request gagal' }))) as { error?: string }
    throw new Error(err.error ?? `HTTP ${res.status}`)
  }
  return (await res.json()) as T
}

export interface AdminWorkbook {
  id: string
  ownerEmail: string
  ownerRole: string
}

export async function listAdminWorkbooks(): Promise<AdminWorkbook[]> {
  const result = await adminFetch<{ workbooks: AdminWorkbook[] }>('/workbooks')
  return result.workbooks
}

export async function createAdminWorkbook(payload: {
  workbookId?: string
  title?: string
  userId?: string
}): Promise<{ workbookId: string; ownerId: string; title: string; createdBy: string }> {
  return adminFetch<{ workbookId: string; ownerId: string; title: string; createdBy: string }>(
    '/workbooks',
    { method: 'POST', body: payload },
  )
}

export async function deleteAdminWorkbook(workbookId: string): Promise<void> {
  await adminFetch<{ ok: true }>(`/workbooks/${workbookId}`, { method: 'DELETE' })
}

export async function listAdminUsers(): Promise<AdminUser[]> {
  const result = await adminFetch<{ users: AdminUser[] }>('/users')
  return result.users
}

export async function createAdminUser(payload: { email: string; password: string }): Promise<AdminUser> {
  const result = await adminFetch<{ user: AdminUser }>('/users', {
    method: 'POST',
    body: payload,
  })
  return result.user
}

export async function shareWorkbook(workbookId: string, email: string): Promise<{ userId: string; email: string }> {
  return adminFetch<{ userId: string; email: string }>(`/workbooks/${workbookId}/share`, {
    method: 'POST',
    body: { email },
  })
}

export async function revokeWorkbook(workbookId: string, userId: string): Promise<void> {
  await adminFetch<{ ok: true }>(`/workbooks/${workbookId}/share/${userId}`, { method: 'DELETE' })
}

export async function listWorkbookAccess(workbookId: string): Promise<WorkbookAccess[]> {
  const result = await adminFetch<{ access: WorkbookAccess[] }>(`/workbooks/${workbookId}/access`)
  return result.access
}
