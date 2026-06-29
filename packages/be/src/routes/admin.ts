import { Router } from 'express'
import { randomUUID } from 'node:crypto'
import argon2 from 'argon2'
import { z } from 'zod'
import { accountRepository } from '../repositories/account-repository.js'
import { assertMutationRequest, HttpError, safeErrorResponse } from '../lib/security.js'
import { getCurrentUser } from '../lib/session.js'
import { workbookAdminRateLimiter } from '../lib/rate-limit.js'

export const adminRouter = Router()

function ensureAdmin(user: { id: string; email: string; role: 'user' | 'admin' } | null): asserts user is { id: string; email: string; role: 'admin' } {
  if (!user) throw new HttpError(401, 'Login diperlukan.')
  if (user.role !== 'admin') throw new HttpError(403, 'Hanya admin yang dapat mengelola workbook.')
}

const createWorkbookSchema = z.object({
  workbookId: z.string().uuid().optional(),
  userId: z.string().uuid().optional(),
  title: z.string().min(1).max(120).optional(),
})

adminRouter.post('/workbooks', async (req, res) => {
  try {
    assertMutationRequest(req)
    const user = await getCurrentUser(req)
    ensureAdmin(user)

    const rate = workbookAdminRateLimiter.consume(`wb-create:${user.id}`)
    if (!rate.allowed) {
      res.status(429)
        .set('Retry-After', String(rate.retryAfterSeconds))
        .json({ error: 'Terlalu banyak percobaan. Coba lagi nanti.' })
      return
    }

    const parsed = createWorkbookSchema.safeParse(req.body ?? {})
    if (!parsed.success) throw new HttpError(400, 'Payload tidak valid.')

    const workbookId = parsed.data.workbookId ?? randomUUID()
    const ownerId = parsed.data.userId ?? user.id
    const title = parsed.data.title ?? 'Workbook Baru'

    await accountRepository.createEmptySnapshot(ownerId, workbookId)

    res.status(201).json({
      workbookId,
      ownerId,
      title,
      createdBy: user.id,
    })
  } catch (error) {
    if (res.headersSent) return
    const safe = safeErrorResponse(error)
    res.status(safe.status).json(safe.body)
  }
})

adminRouter.delete('/workbooks/:workbookId', async (req, res) => {
  try {
    assertMutationRequest(req)
    const user = await getCurrentUser(req)
    ensureAdmin(user)

    const workbookId = req.params.workbookId
    if (!workbookId) throw new HttpError(400, 'workbookId wajib diisi.')

    const owner = await accountRepository.findWorkbookOwner(workbookId)
    if (!owner) throw new HttpError(404, 'Workbook tidak ditemukan.')

    await accountRepository.revokeAllWorkbookAccess(workbookId)
    await accountRepository.deleteSnapshot(workbookId, owner.ownerId)

    res.json({ ok: true, workbookId, previousOwnerId: owner.ownerId })
  } catch (error) {
    if (res.headersSent) return
    const safe = safeErrorResponse(error)
    res.status(safe.status).json(safe.body)
  }
})

const shareSchema = z.object({
  email: z.string().email().max(320),
})

adminRouter.post('/workbooks/:workbookId/share', async (req, res) => {
  try {
    assertMutationRequest(req)
    const user = await getCurrentUser(req)
    ensureAdmin(user)

    const workbookId = req.params.workbookId
    if (!workbookId) throw new HttpError(400, 'workbookId wajib diisi.')

    const parsed = shareSchema.safeParse(req.body ?? {})
    if (!parsed.success) throw new HttpError(400, 'Email tidak valid.')

    const owner = await accountRepository.findWorkbookOwner(workbookId)
    if (!owner) throw new HttpError(404, 'Workbook tidak ditemukan.')

    const target = await accountRepository.findUserByEmail(parsed.data.email)
    if (!target) throw new HttpError(404, 'User dengan email tersebut tidak ditemukan.')
    if (target.id === owner.ownerId) throw new HttpError(400, 'Owner otomatis memiliki akses.')

    await accountRepository.grantWorkbookAccess(workbookId, target.id, user.id)

    res.json({ ok: true, workbookId, userId: target.id, email: target.email })
  } catch (error) {
    if (res.headersSent) return
    const safe = safeErrorResponse(error)
    res.status(safe.status).json(safe.body)
  }
})

adminRouter.delete('/workbooks/:workbookId/share/:userId', async (req, res) => {
  try {
    assertMutationRequest(req)
    const user = await getCurrentUser(req)
    ensureAdmin(user)

    const { workbookId, userId } = req.params
    if (!workbookId || !userId) throw new HttpError(400, 'Parameter tidak lengkap.')

    await accountRepository.revokeWorkbookAccess(workbookId, userId)
    res.json({ ok: true })
  } catch (error) {
    if (res.headersSent) return
    const safe = safeErrorResponse(error)
    res.status(safe.status).json(safe.body)
  }
})

adminRouter.get('/workbooks/:workbookId/access', async (req, res) => {
  try {
    const user = await getCurrentUser(req)
    ensureAdmin(user)

    const workbookId = req.params.workbookId
    if (!workbookId) throw new HttpError(400, 'workbookId wajib diisi.')

    const list = await accountRepository.listWorkbookAccess(workbookId)
    res.json({ workbookId, access: list })
  } catch (error) {
    if (res.headersSent) return
    const safe = safeErrorResponse(error)
    res.status(safe.status).json(safe.body)
  }
})

adminRouter.get('/users', async (req, res) => {
  try {
    const user = await getCurrentUser(req)
    ensureAdmin(user)

    const users = await accountRepository.listAllUsers()
    res.json({ users })
  } catch (error) {
    if (res.headersSent) return
    const safe = safeErrorResponse(error)
    res.status(safe.status).json(safe.body)
  }
})

adminRouter.get('/workbooks', async (req, res) => {
  try {
    const user = await getCurrentUser(req)
    ensureAdmin(user)

    const workbooks = await accountRepository.listWorkbooksByOwner(user.id)
    res.json({ workbooks })
  } catch (error) {
    if (res.headersSent) return
    const safe = safeErrorResponse(error)
    res.status(safe.status).json(safe.body)
  }
})

const registerUserSchema = z.object({
  email: z.string().email().max(320),
  password: z.string().min(8).max(128),
})

adminRouter.post('/users', async (req, res) => {
  try {
    assertMutationRequest(req)
    const user = await getCurrentUser(req)
    ensureAdmin(user)

    const rate = workbookAdminRateLimiter.consume(`user-create:${user.id}`)
    if (!rate.allowed) {
      res.status(429)
        .set('Retry-After', String(rate.retryAfterSeconds))
        .json({ error: 'Terlalu banyak percobaan. Coba lagi nanti.' })
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
  } catch (error) {
    if (res.headersSent) return
    const safe = safeErrorResponse(error)
    res.status(safe.status).json(safe.body)
  }
})
