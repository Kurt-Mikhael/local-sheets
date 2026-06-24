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
    const rate = authRateLimiter.consume(`login:${requestKey(request)}`)
    if (!rate.allowed) {
      return NextResponse.json(
        { error: 'Terlalu banyak percobaan. Coba lagi nanti.' },
        { status: 429, headers: { 'Retry-After': String(rate.retryAfterSeconds) } },
      )
    }

    const raw = await readJsonWithLimit(request, 16_384)
    const parsed = authSchema.safeParse(raw)
    if (!parsed.success) throw new HttpError(400, 'Email atau password tidak valid.')

    const user = await accountRepository.findUserByEmail(parsed.data.email)
    const valid = user ? await argon2.verify(user.passwordHash, parsed.data.password) : false
    if (!user || !valid) throw new HttpError(401, 'Email atau password salah.')

    const session = await createSession(user.id)
    const response = NextResponse.json({ user: { id: user.id, email: user.email } })
    attachSessionCookie(response, session)
    return response
  } catch (error) {
    const safe = safeErrorResponse(error)
    return NextResponse.json(safe.body, { status: safe.status })
  }
}
