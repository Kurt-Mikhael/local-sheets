import { Router } from 'express'
import { decodeCursor, encodeCursor } from '../lib/cursor.js'
import { syncRateLimiter } from '../lib/rate-limit.js'
import { syncRepository } from '../repositories/sync-repository.js'
import { assertMutationRequest, HttpError } from '../lib/security.js'
import { asyncHandler } from '../lib/async-handler.js'
import { getCurrentUser } from '../lib/session.js'
import { syncRequestSchema } from '../../../shared/src/schemas.js'
import { MAX_REMOTE_PER_RESPONSE } from '../../../shared/src/sync-contract.js'

export const syncRouter = Router()

syncRouter.post('/', asyncHandler(async (req, res) => {
  assertMutationRequest(req)
  const user = await getCurrentUser(req)
  if (!user) throw new HttpError(401, 'Login diperlukan untuk sinkronisasi.')

  const rate = syncRateLimiter.consume(`sync:${user.id}`)
  if (!rate.allowed) {
    res.status(429).set('Retry-After', String(rate.retryAfterSeconds)).json({ error: 'Batas sinkronisasi terlampaui.' })
    return
  }

  const parsed = syncRequestSchema.safeParse(req.body)
  if (!parsed.success) {
    console.error('[sync] zod error:', JSON.stringify(parsed.error.issues, null, 2))
    throw new HttpError(400, 'Payload sinkronisasi tidak valid.')
  }

  const { acked, conflicts } = await syncRepository.processChanges(user.id, parsed.data.changes, user.role)
  const decodedCursor = decodeCursor(parsed.data.cursor, user.id)
  const remotePage = await syncRepository.listRemote(user.id, decodedCursor, MAX_REMOTE_PER_RESPONSE)
  const last = remotePage.rows[remotePage.rows.length - 1]
  const cursor = last ? encodeCursor({ updatedAt: last.updatedAt, id: last.id }, user.id) : parsed.data.cursor

  res.json({
    acked,
    conflicts,
    remote: remotePage.rows,
    cursor,
    hasMore: remotePage.hasMore,
  })
}))
