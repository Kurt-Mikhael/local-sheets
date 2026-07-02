import type { Account } from './account-cache'

export type AdminUser = Account

export interface WorkbookAccess {
  userId: string
  email: string
  grantedAt: string
}

export interface AdminWorkbook {
  id: string
  title: string
  ownerEmail: string
}

interface AdminInit {
  method?: 'GET' | 'POST' | 'DELETE'
  body?: unknown
}

async function adminFetch<T>(path: string, init: AdminInit = {}): Promise<T> {
  const res = await fetch(`/api/admin${path}`, {
    method: init.method ?? 'GET',
    headers: {
      'Content-Type': 'application/json',
      'X-Requested-With': 'offline-spreadsheet',
    },
    credentials: 'same-origin',
    body: init.body !== undefined ? JSON.stringify(init.body) : undefined,
  })
  if (!res.ok) {
    const err = (await res.json().catch(() => ({ error: 'Request gagal' }))) as { error?: string }
    throw new Error(err.error ?? `HTTP ${res.status}`)
  }
  return (await res.json()) as T
}

export const listAdminWorkbooks = () =>
  adminFetch<{ workbooks: AdminWorkbook[] }>('/workbooks').then((r) => r.workbooks)

export const createAdminWorkbook = (payload: { workbookId?: string; title: string; userId?: string }) =>
  adminFetch<{ workbookId: string; ownerId: string; title: string; createdBy: string }>('/workbooks', {
    method: 'POST',
    body: payload,
  })

export const importAdminWorkbook = (payload: { title: string; snapshot: Record<string, unknown> }) =>
  adminFetch<{ workbookId: string; ownerId: string; title: string; createdBy: string }>('/workbooks/import', {
    method: 'POST',
    body: payload,
  })

export const deleteAdminWorkbook = (workbookId: string) =>
  adminFetch<{ ok: true }>(`/workbooks/${workbookId}`, { method: 'DELETE' })

export const listAdminUsers = () =>
  adminFetch<{ users: AdminUser[] }>('/users').then((r) => r.users)

export const createAdminUser = (payload: { email: string; password: string }) =>
  adminFetch<{ user: AdminUser }>('/users', { method: 'POST', body: payload }).then((r) => r.user)

export const shareWorkbook = (workbookId: string, email: string) =>
  adminFetch<{ userId: string; email: string }>(`/workbooks/${workbookId}/share`, {
    method: 'POST',
    body: { email },
  })

export const revokeWorkbook = (workbookId: string, userId: string) =>
  adminFetch<{ ok: true }>(`/workbooks/${workbookId}/share/${userId}`, { method: 'DELETE' })

export const listWorkbookAccess = (workbookId: string) =>
  adminFetch<{ access: WorkbookAccess[] }>(`/workbooks/${workbookId}/access`).then((r) => r.access)

export interface MyWorkbook {
  id: string
  title: string
  ownerEmail: string
  ownerRole: 'user' | 'admin'
  version: number
  updatedAt: string
}

export const listMyWorkbooks = async (): Promise<MyWorkbook[]> => {
  const res = await fetch('/api/workbooks', { cache: 'no-store', credentials: 'same-origin' })
  if (!res.ok) throw new Error(`HTTP ${res.status}`)
  const data = (await res.json()) as { workbooks: MyWorkbook[] }
  return data.workbooks
}

export const getWorkbookSnapshot = async (workbookId: string) => {
  const res = await fetch(`/api/workbooks/${workbookId}/snapshot`, {
    cache: 'no-store',
    credentials: 'same-origin',
  })
  if (!res.ok) throw new Error(`HTTP ${res.status}`)
  return (await res.json()) as {
    workbookId: string
    title: string
    version: number
    updatedAt: string
    snapshot: Record<string, unknown>
  }
}

export interface WorkbookVersion {
  id: string
  label: string
  createdAt: string
  createdBy: string | null
  snapshotSize: number
}

export interface WorkbookVersionDetail extends WorkbookVersion {
  workbookId: string
  snapshot: Record<string, unknown>
}

export const listWorkbookVersions = (workbookId: string) =>
  adminFetch<{ versions: WorkbookVersion[] }>(`/workbooks/${workbookId}/versions`).then((r) => r.versions)

export const getWorkbookVersion = (workbookId: string, versionId: string) =>
  adminFetch<{ version: WorkbookVersionDetail }>(`/workbooks/${workbookId}/versions/${versionId}`).then((r) => r.version)

export const createWorkbookVersion = (workbookId: string, label: string) =>
  adminFetch<{ version: { id: string; label: string; createdAt: string } }>(
    `/workbooks/${workbookId}/versions`,
    { method: 'POST', body: { label } },
  ).then((r) => r.version)

export const restoreWorkbookVersion = (workbookId: string, versionId: string) =>
  adminFetch<{ ok: true; versionId: string }>(`/workbooks/${workbookId}/versions/${versionId}/restore`, {
    method: 'POST',
  })

export const deleteWorkbookVersion = (workbookId: string, versionId: string) =>
  adminFetch<{ ok: true }>(`/workbooks/${workbookId}/versions/${versionId}`, { method: 'DELETE' })
