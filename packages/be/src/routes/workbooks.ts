import { Router } from 'express'
import { z } from 'zod'
import { accountRepository } from '../repositories/account-repository.js'
import { assertMutationRequest, HttpError } from '../lib/security.js'
import { asyncHandler } from '../lib/async-handler.js'
import { getCurrentUser } from '../lib/session.js'

export const workbooksRouter = Router()

interface WorkbookListItem {
  id: string
  title: string
  ownerEmail: string
  ownerRole: string
  version: number
  updatedAt: string
}

type WorkbookData = Awaited<ReturnType<typeof accountRepository.findWorkbookData>>

workbooksRouter.get('/', asyncHandler(async (req, res) => {
  const user = await getCurrentUser(req)
  if (!user) throw new HttpError(401, 'Login diperlukan.')

  const items: WorkbookListItem[] = []

  if (user.role === 'super_admin') {
    const all = await accountRepository.listAllWorkbooks()
    for (const wb of all) {
      const ownerId = wb.ownerId
      let data: WorkbookData = null
      try {
        data = await accountRepository.findWorkbookData(ownerId, wb.id)
      } catch (err) {
        console.error('[workbooks] findWorkbookData failed for', wb.id, err)
      }
      items.push({
        id: wb.id,
        title: wb.title,
        ownerEmail: wb.ownerEmail,
        ownerRole: wb.ownerRole === 'super_admin' ? 'super_admin' : wb.ownerRole === 'admin' ? 'admin' : 'user',
        version: data?.version ?? 0,
        updatedAt: data?.updatedAt ?? new Date().toISOString(),
      })
    }
  } else if (user.role === 'admin') {
    const own = await accountRepository.listWorkbooksByOwner(user.id)
    for (const wb of own) {
      let data: WorkbookData = null
      try {
        data = await accountRepository.findWorkbookData(user.id, wb.id)
      } catch (err) {
        console.error('[workbooks] findWorkbookData failed for', wb.id, err)
      }
      items.push({
        id: wb.id,
        title: wb.title,
        ownerEmail: wb.ownerEmail,
        ownerRole: wb.ownerRole === 'admin' ? 'admin' : 'user',
        version: data?.version ?? 0,
        updatedAt: data?.updatedAt ?? new Date().toISOString(),
      })
    }
  } else {
    const sharedIds = await accountRepository.listSharedWorkbookIds(user.id)
    for (const id of sharedIds) {
      const owner = await accountRepository.findWorkbookOwner(id)
      if (!owner) continue
      let data: WorkbookData = null
      try {
        data = await accountRepository.findWorkbookData(owner.ownerId, id)
      } catch (err) {
        console.error('[workbooks] findWorkbookData failed for', id, err)
        continue
      }
      if (!data) continue
      items.push({
        id,
        title: data.title,
        ownerEmail: user.email,
        ownerRole: user.role,
        version: data.version,
        updatedAt: data.updatedAt,
      })
    }
  }

  res.json({ workbooks: items })
}))

workbooksRouter.get('/:id/snapshot', asyncHandler(async (req, res) => {
  const user = await getCurrentUser(req)
  if (!user) throw new HttpError(401, 'Login diperlukan.')

  const workbookId = typeof req.params.id === 'string' ? req.params.id : ''
  if (!workbookId) throw new HttpError(400, 'workbookId wajib diisi.')

  const owner = await accountRepository.findWorkbookOwner(workbookId)
  if (!owner) throw new HttpError(404, 'Workbook tidak ditemukan.')

  const isOwner = owner.ownerId === user.id
  const isSuperAdmin = user.role === 'super_admin'
  if (!isOwner && !isSuperAdmin) {
    const granted = await accountRepository.userHasWorkbookAccess(user.id, workbookId)
    if (!granted) throw new HttpError(403, 'Anda tidak memiliki akses ke workbook ini.')
  }

  const data = await accountRepository.findWorkbookData(owner.ownerId, workbookId)
  if (!data) throw new HttpError(404, 'Snapshot workbook belum tersedia di server.')

  res.json({
    workbookId,
    title: data.title,
    version: data.version,
    snapshot: data.snapshot,
    updatedAt: data.updatedAt,
  })
}))

const protectedRangeSchema = z.object({
  id: z.string().min(1),
  range: z.object({
    startRow: z.number().int().min(0),
    startColumn: z.number().int().min(0),
    endRow: z.number().int().min(0),
    endColumn: z.number().int().min(0),
  }).refine((r) => r.endRow >= r.startRow && r.endColumn >= r.startColumn, {
    message: 'endRow >= startRow dan endColumn >= startColumn',
  }),
  allowedRoles: z.array(z.enum(['admin', 'super_admin'])).min(1),
})

const protectionBodySchema = z.object({
  sheetId: z.string().min(1),
  ranges: z.array(protectedRangeSchema),
})

workbooksRouter.put('/:id/protection', asyncHandler(async (req, res) => {
  assertMutationRequest(req)
  const user = await getCurrentUser(req)
  if (!user) throw new HttpError(401, 'Login diperlukan.')
  if (user.role !== 'admin' && user.role !== 'super_admin') {
    throw new HttpError(403, 'Hanya admin/super_admin yang dapat mengatur proteksi sel.')
  }

  const workbookId = typeof req.params.id === 'string' ? req.params.id : ''
  if (!workbookId) throw new HttpError(400, 'workbookId wajib diisi.')

  const parsed = protectionBodySchema.safeParse(req.body)
  if (!parsed.success) {
    throw new HttpError(400, 'Payload protection tidak valid.')
  }

  const owner = await accountRepository.findWorkbookOwner(workbookId)
  if (!owner) throw new HttpError(404, 'Workbook tidak ditemukan.')

  const data = await accountRepository.findWorkbookData(owner.ownerId, workbookId)
  if (!data) throw new HttpError(404, 'Snapshot workbook belum tersedia di server.')

  const snapshot = data.snapshot as Record<string, unknown>
  const sheets = (snapshot.sheets && typeof snapshot.sheets === 'object'
    ? snapshot.sheets : {}) as Record<string, unknown>
  const sheet = sheets[parsed.data.sheetId]
  if (!sheet || typeof sheet !== 'object') {
    throw new HttpError(404, 'Sheet tidak ditemukan di snapshot.')
  }

  const nextSheet = { ...(sheet as Record<string, unknown>) }
  if (parsed.data.ranges.length === 0) {
    delete nextSheet.protectedRanges
  } else {
    nextSheet.protectedRanges = parsed.data.ranges
  }
  const nextSheets = { ...sheets, [parsed.data.sheetId]: nextSheet }
  const nextSnapshot = { ...snapshot, sheets: nextSheets }

  await accountRepository.updateWorkbookSnapshot(
    owner.ownerId,
    workbookId,
    nextSnapshot,
    data.title,
  )

  res.json({ ok: true, snapshot: nextSnapshot })
}))
