import argon2 from 'argon2'
import type { NextRequest } from 'next/server'
import { NextResponse } from 'next/server'
import { authRateLimiter } from '@/lib/server/rate-limit'
import { accountRepository } from '@/lib/server/repositories/account-repository'
import { assertMutationRequest, HttpError, readJsonWithLimit, safeErrorResponse } from '@/lib/server/security'
import { attachSessionCookie, createSession } from '@/lib/server/session'
import { authSchema } from '@/lib/shared/schemas'

function requestKey(request: NextRequest): string {
  return request.headers.get('x-forwarded-for')?.split(',')[0]?.trim() ?? 'unknown'
}

export async function POST(request: NextRequest) {
  try {
    assertMutationRequest(request)
    const rate = authRateLimiter.consume(`register:${requestKey(request)}`)
    if (!rate.allowed) {
      return NextResponse.json(
        { error: 'Terlalu banyak percobaan. Coba lagi nanti.' },
        { status: 429, headers: { 'Retry-After': String(rate.retryAfterSeconds) } },
      )
    }

    const raw = await readJsonWithLimit(request, 16_384)
    const parsed = authSchema.safeParse(raw)
    if (!parsed.success) throw new HttpError(400, 'Email atau password tidak memenuhi ketentuan.')

    const existing = await accountRepository.findUserByEmail(parsed.data.email)
    if (existing) throw new HttpError(409, 'Email sudah terdaftar.')

    const passwordHash = await argon2.hash(parsed.data.password, {
      type: argon2.argon2id,
      memoryCost: 19_456,
      timeCost: 2,
      parallelism: 1,
    })

    const user = await accountRepository.createUser(parsed.data.email, passwordHash)
    const session = await createSession(user.id)
    const response = NextResponse.json({ user }, { status: 201 })
    attachSessionCookie(response, session)
    return response
  } catch (error) {
    const safe = safeErrorResponse(error)
    return NextResponse.json(safe.body, { status: safe.status })
  }
}
