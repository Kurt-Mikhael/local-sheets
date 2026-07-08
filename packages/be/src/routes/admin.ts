import { Router } from 'express'
import { randomUUID } from 'node:crypto'
import argon2 from 'argon2'
import { z } from 'zod'
import { accountRepository } from '../repositories/account-repository.js'
import { assertMutationRequest, HttpError } from '../lib/security.js'
import { asyncHandler } from '../lib/async-handler.js'
import { getCurrentUser } from '../lib/session.js'
import { workbookAdminRateLimiter } from '../lib/rate-limit.js'

export const adminRouter = Router()

function ensureAdmin(user: { id: string; email: string; role: 'user' | 'admin' | 'super_admin' } | null): asserts user is { id: string; email: string; role: 'admin' | 'super_admin' } {
  if (!user) throw new HttpError(401, 'Login diperlukan.')
  if (user.role !== 'admin' && user.role !== 'super_admin') throw new HttpError(403, 'Hanya admin yang dapat mengelola workbook.')
}

function ensureSuperAdmin(user: { id: string; email: string; role: 'user' | 'admin' | 'super_admin' } | null): asserts user is { id: string; email: string; role: 'super_admin' } {
  if (!user) throw new HttpError(401, 'Login diperlukan.')
  if (user.role !== 'super_admin') throw new HttpError(403, 'Hanya super admin yang dapat melakukan aksi ini.')
}

function param(req: { params: Record<string, string | string[] | undefined> }, key: string): string {
  const value = req.params[key]
  if (typeof value !== 'string' || value.length === 0) {
    throw new HttpError(400, `${key} wajib diisi.`)
  }
  return value
}

const createWorkbookSchema = z.object({
  workbookId: z.string().uuid().optional(),
  userId: z.string().uuid().optional(),
  title: z.string().trim().min(1).max(120),
})

const shareSchema = z.object({
  email: z.string().email().max(320),
})

const registerUserSchema = z.object({
  email: z.string().email().max(320),
  password: z.string().min(8).max(128),
})

adminRouter.post('/workbooks', asyncHandler(async (req, res) => {
  assertMutationRequest(req)
  const user = await getCurrentUser(req)
  ensureAdmin(user)

  const rate = workbookAdminRateLimiter.consume(`wb-create:${user.id}`)
  if (!rate.allowed) {
    res.status(429).set('Retry-After', String(rate.retryAfterSeconds)).json({ error: 'Terlalu banyak percobaan. Coba lagi nanti.' })
    return
  }

  const parsed = createWorkbookSchema.safeParse(req.body ?? {})
  if (!parsed.success) throw new HttpError(400, 'Payload tidak valid.')

  const workbookId = parsed.data.workbookId ?? randomUUID()
  const ownerId = parsed.data.userId ?? user.id
  if (parsed.data.userId && user.role !== 'super_admin' && parsed.data.userId !== user.id) {
    throw new HttpError(403, 'Hanya super admin yang dapat membuat workbook untuk user lain.')
  }
  const title = parsed.data.title

  await accountRepository.createEmptySnapshot(ownerId, workbookId, title)

  res.status(201).json({ workbookId, ownerId, title, createdBy: user.id })
}))

const importWorkbookSchema = z.object({
  title: z.string().trim().min(1).max(120),
  snapshot: z.record(z.string(), z.unknown()),
})

adminRouter.post('/workbooks/import', asyncHandler(async (req, res) => {
  assertMutationRequest(req)
  const user = await getCurrentUser(req)
  ensureAdmin(user)

  const rate = workbookAdminRateLimiter.consume(`wb-import:${user.id}`)
  if (!rate.allowed) {
    res.status(429).set('Retry-After', String(rate.retryAfterSeconds)).json({ error: 'Terlalu banyak percobaan. Coba lagi nanti.' })
    return
  }

  const parsed = importWorkbookSchema.safeParse(req.body ?? {})
  if (!parsed.success) throw new HttpError(400, 'Payload tidak valid.')

  const workbookId = randomUUID()
  const ownerId = user.id
  const title = parsed.data.title
  const snapshot = parsed.data.snapshot as Record<string, unknown>

  await accountRepository.createWorkbookWithSnapshot(ownerId, workbookId, title, snapshot)

  res.status(201).json({ workbookId, ownerId, title, createdBy: user.id })
}))

adminRouter.delete('/workbooks/:workbookId', asyncHandler(async (req, res) => {
  assertMutationRequest(req)
  const user = await getCurrentUser(req)
  ensureAdmin(user)

  const workbookId = param(req, 'workbookId')
  const owner = await accountRepository.findWorkbookOwner(workbookId)
  if (!owner) throw new HttpError(404, 'Workbook tidak ditemukan.')

  await accountRepository.revokeAllWorkbookAccess(workbookId)
  await accountRepository.deleteSnapshot(workbookId, owner.ownerId)
  await accountRepository.deleteWorkbookRow(owner.ownerId, workbookId)
  await accountRepository.deleteVersionsForWorkbook(workbookId)
  await accountRepository.deleteSyncOperationsForWorkbook(owner.ownerId, workbookId)

  res.json({ ok: true, workbookId, previousOwnerId: owner.ownerId })
}))

adminRouter.post('/workbooks/:workbookId/share', asyncHandler(async (req, res) => {
  assertMutationRequest(req)
  const user = await getCurrentUser(req)
  ensureAdmin(user)

  const workbookId = param(req, 'workbookId')

  const parsed = shareSchema.safeParse(req.body ?? {})
  if (!parsed.success) throw new HttpError(400, 'Email tidak valid.')

  const owner = await accountRepository.findWorkbookOwner(workbookId)
  if (!owner) throw new HttpError(404, 'Workbook tidak ditemukan.')

  const target = await accountRepository.findUserByEmail(parsed.data.email)
  if (!target) throw new HttpError(404, 'User dengan email tersebut tidak ditemukan.')
  if (target.id === owner.ownerId) throw new HttpError(400, 'Owner otomatis memiliki akses.')

  await accountRepository.grantWorkbookAccess(workbookId, target.id, user.id)

  res.json({ ok: true, workbookId, userId: target.id, email: target.email })
}))

adminRouter.delete('/workbooks/:workbookId/share/:userId', asyncHandler(async (req, res) => {
  assertMutationRequest(req)
  const user = await getCurrentUser(req)
  ensureAdmin(user)

  const workbookId = param(req, 'workbookId')
  const userId = param(req, 'userId')

  await accountRepository.revokeWorkbookAccess(workbookId, userId)
  res.json({ ok: true })
}))

adminRouter.get('/workbooks/:workbookId/access', asyncHandler(async (req, res) => {
  const user = await getCurrentUser(req)
  ensureAdmin(user)

  const workbookId = param(req, 'workbookId')
  const list = await accountRepository.listWorkbookAccess(workbookId)
  res.json({ workbookId, access: list })
}))

adminRouter.get('/users', asyncHandler(async (req, res) => {
  const user = await getCurrentUser(req)
  ensureAdmin(user)
  res.json({ users: await accountRepository.listAllUsers() })
}))

adminRouter.get('/workbooks', asyncHandler(async (req, res) => {
  const user = await getCurrentUser(req)
  ensureAdmin(user)
  const workbooks = user.role === 'super_admin'
    ? await accountRepository.listAllWorkbooks()
    : await accountRepository.listWorkbooksByOwner(user.id)
  res.json({ workbooks })
}))

adminRouter.post('/users', asyncHandler(async (req, res) => {
  assertMutationRequest(req)
  const user = await getCurrentUser(req)
  ensureAdmin(user)

  const rate = workbookAdminRateLimiter.consume(`user-create:${user.id}`)
  if (!rate.allowed) {
    res.status(429).set('Retry-After', String(rate.retryAfterSeconds)).json({ error: 'Terlalu banyak percobaan. Coba lagi nanti.' })
    return
  }

  const parsed = registerUserSchema.safeParse(req.body ?? {})
  if (!parsed.success) throw new HttpError(400, 'Email atau password tidak valid.')

  const existing = await accountRepository.findUserByEmail(parsed.data.email)
  if (existing) throw new HttpError(409, 'Email sudah terdaftar.')

  const passwordHash = await argon2.hash(parsed.data.password, {
    type: argon2.argon2id,
    memoryCost: 19_456,
    timeCost: 2,
    parallelism: 1,
  })

  const created = await accountRepository.createUser(parsed.data.email, passwordHash, 'user')
  res.status(201).json({ user: { id: created.id, email: created.email, role: created.role } })
}))

const updateUserRoleSchema = z.object({
  role: z.enum(['user', 'admin', 'super_admin']),
})

adminRouter.patch('/users/:userId/role', asyncHandler(async (req, res) => {
  assertMutationRequest(req)
  const user = await getCurrentUser(req)
  ensureSuperAdmin(user)

  const userId = param(req, 'userId')
  const parsed = updateUserRoleSchema.safeParse(req.body ?? {})
  if (!parsed.success) throw new HttpError(400, 'Role tidak valid.')

  if (userId === user.id && parsed.data.role !== 'super_admin') {
    throw new HttpError(400, 'Anda tidak dapat menurunkan role Anda sendiri.')
  }

  const target = await accountRepository.findUserById(userId)
  if (!target) throw new HttpError(404, 'User tidak ditemukan.')

  await accountRepository.updateUserRole(userId, parsed.data.role)
  res.json({ ok: true, userId, role: parsed.data.role })
}))

// ponytail: workbook version history endpoints
const MAX_VERSIONS_PER_WORKBOOK = 39

adminRouter.post('/workbooks/:workbookId/versions', asyncHandler(async (req, res) => {
  assertMutationRequest(req)
  const user = await getCurrentUser(req)
  ensureAdmin(user)

  const workbookId = param(req, 'workbookId')
  const label = String((req.body as { label?: unknown } | undefined)?.label ?? '').trim()
  if (!label) throw new HttpError(400, 'Label wajib diisi.')
  if (label.length > 120) throw new HttpError(400, 'Label maksimal 120 karakter.')

  const owner = await accountRepository.findWorkbookOwner(workbookId)
  if (!owner) throw new HttpError(404, 'Workbook tidak ditemukan.')

  const data = await accountRepository.findWorkbookData(owner.ownerId, workbookId)
  if (!data) throw new HttpError(404, 'Workbook belum memiliki snapshot untuk disimpan.')

  const created = await accountRepository.createWorkbookVersion(workbookId, label, data.snapshot, user.id)
  await accountRepository.pruneOldVersions(workbookId, MAX_VERSIONS_PER_WORKBOOK)
  res.status(201).json({ version: { id: created.id, label, createdAt: created.createdAt } })
}))

adminRouter.get('/workbooks/:workbookId/versions', asyncHandler(async (req, res) => {
  const user = await getCurrentUser(req)
  ensureAdmin(user)

  const workbookId = param(req, 'workbookId')
  const versions = await accountRepository.listWorkbookVersions(workbookId)
  res.json({ versions })
}))

adminRouter.get('/workbooks/:workbookId/versions/:versionId', asyncHandler(async (req, res) => {
  const user = await getCurrentUser(req)
  ensureAdmin(user)

  const versionId = param(req, 'versionId')
  const v = await accountRepository.getWorkbookVersion(versionId)
  if (!v) throw new HttpError(404, 'Versi tidak ditemukan.')
  res.json({ version: v })
}))

adminRouter.post('/workbooks/:workbookId/versions/:versionId/restore', asyncHandler(async (req, res) => {
  assertMutationRequest(req)
  const user = await getCurrentUser(req)
  ensureAdmin(user)

  const workbookId = param(req, 'workbookId')
  const versionId = param(req, 'versionId')

  const owner = await accountRepository.findWorkbookOwner(workbookId)
  if (!owner) throw new HttpError(404, 'Workbook tidak ditemukan.')

  const version = await accountRepository.getWorkbookVersion(versionId)
  if (!version) throw new HttpError(404, 'Versi tidak ditemukan.')
  if (version.workbookId !== workbookId) throw new HttpError(400, 'Versi bukan untuk workbook ini.')

  const current = await accountRepository.findWorkbookData(owner.ownerId, workbookId)
  if (current) {
    await accountRepository.createWorkbookVersion(
      workbookId,
      `Auto: sebelum restore ke "${version.label}"`,
      current.snapshot,
      user.id,
    )
  }

  // ponytail: restore = apply version snapshot to workbooks, clear yjs binary to force re-init
  const { query } = await import('../lib/postgres.js')
  await query(
    `UPDATE workbooks
     SET snapshot = $3::jsonb, version = version + 1, updated_at = NOW()
     WHERE user_id = $1 AND id = $2`,
    [owner.ownerId, workbookId, JSON.stringify(version.snapshot)],
  )
  await query(
    `UPDATE workbook_snapshots SET doc = ''::bytea, updated_at = NOW() WHERE user_id = $1 AND workbook_id = $2`,
    [owner.ownerId, workbookId],
  )
  await accountRepository.pruneOldVersions(workbookId, MAX_VERSIONS_PER_WORKBOOK)

  // ponytail: signal collab room to disconnect all clients so they re-sync from new state
  const { forceReconnectWorkbook } = await import('./collab.js')
  forceReconnectWorkbook(owner.ownerId, workbookId)

  res.json({ ok: true, versionId })
}))

adminRouter.delete('/workbooks/:workbookId/versions/:versionId', asyncHandler(async (req, res) => {
  assertMutationRequest(req)
  const user = await getCurrentUser(req)
  ensureAdmin(user)

  const versionId = param(req, 'versionId')
  const ok = await accountRepository.deleteWorkbookVersion(versionId)
  if (!ok) throw new HttpError(404, 'Versi tidak ditemukan.')
  res.json({ ok: true })
}))
