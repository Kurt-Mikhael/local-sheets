import type { NextRequest } from 'next/server'
import { NextResponse } from 'next/server'
import { decodeCursor, encodeCursor } from '@/lib/server/cursor'
import { syncRateLimiter } from '@/lib/server/rate-limit'
import { syncRepository } from '@/lib/server/repositories/sync-repository'
import { assertMutationRequest, HttpError, readJsonWithLimit, safeErrorResponse } from '@/lib/server/security'
import { getCurrentUser } from '@/lib/server/session'
import { syncRequestSchema } from '@/lib/shared/schemas'
import { MAX_REMOTE_PER_RESPONSE } from '@/lib/shared/sync-contract'

export async function POST(request: NextRequest) {
  try {
    assertMutationRequest(request)
    const user = await getCurrentUser(request)
    if (!user) throw new HttpError(401, 'Login diperlukan untuk sinkronisasi.')

    const rate = syncRateLimiter.consume(`sync:${user.id}`)
    if (!rate.allowed) {
      return NextResponse.json(
        { error: 'Batas sinkronisasi terlampaui.' },
        { status: 429, headers: { 'Retry-After': String(rate.retryAfterSeconds) } },
      )
    }

    const maxBody = Number(process.env.MAX_SYNC_BODY_BYTES ?? 5_242_880)
    const raw = await readJsonWithLimit(request, Math.min(Math.max(maxBody, 65_536), 20_971_520))
    const parsed = syncRequestSchema.safeParse(raw)
    if (!parsed.success) throw new HttpError(400, 'Payload sinkronisasi tidak valid.')

    const { acked, conflicts } = await syncRepository.processChanges(user.id, parsed.data.changes)
    const decodedCursor = decodeCursor(parsed.data.cursor, user.id)
    const remotePage = await syncRepository.listRemote(user.id, decodedCursor, MAX_REMOTE_PER_RESPONSE)
    const last = remotePage.rows.at(-1)
    const cursor = last
      ? encodeCursor({ updatedAt: last.updatedAt, id: last.id }, user.id)
      : parsed.data.cursor

    return NextResponse.json({
      acked,
      conflicts,
      remote: remotePage.rows,
      cursor,
      hasMore: remotePage.hasMore,
    })
  } catch (error) {
    const safe = safeErrorResponse(error)
    return NextResponse.json(safe.body, { status: safe.status })
  }
}
