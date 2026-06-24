import { createHash, randomBytes } from 'node:crypto'
import type { NextRequest, NextResponse } from 'next/server'
import { accountRepository } from '@/lib/server/repositories/account-repository'

const SESSION_COOKIE = process.env.NODE_ENV === 'production'
  ? '__Host-localsheet_session'
  : 'localsheet_session'

function hashToken(token: string): string {
  return createHash('sha256').update(token).digest('hex')
}

function ttlDays(): number {
  const value = Number(process.env.SESSION_TTL_DAYS ?? 30)
  return Number.isFinite(value) && value > 0 ? Math.min(value, 90) : 30
}

export async function createSession(userId: string): Promise<{ token: string; expiresAt: Date }> {
  const token = randomBytes(32).toString('base64url')
  const expiresAt = new Date(Date.now() + ttlDays() * 86_400_000)
  await accountRepository.createSession(userId, hashToken(token), expiresAt)
  return { token, expiresAt }
}

export function attachSessionCookie(response: NextResponse, session: { token: string; expiresAt: Date }): void {
  response.cookies.set(SESSION_COOKIE, session.token, {
    httpOnly: true,
    secure: process.env.NODE_ENV === 'production',
    sameSite: 'strict',
    path: '/',
    expires: session.expiresAt,
  })
}

export async function clearSession(request: NextRequest, response: NextResponse): Promise<void> {
  const token = request.cookies.get(SESSION_COOKIE)?.value
  if (token) await accountRepository.deleteSessionByTokenHash(hashToken(token))
  response.cookies.set(SESSION_COOKIE, '', {
    httpOnly: true,
    secure: process.env.NODE_ENV === 'production',
    sameSite: 'strict',
    path: '/',
    expires: new Date(0),
  })
}

export async function getCurrentUser(request: NextRequest) {
  const token = request.cookies.get(SESSION_COOKIE)?.value
  if (!token) return null

  const session = await accountRepository.findUserBySessionHash(hashToken(token))
  if (!session || session.expiresAt <= new Date()) {
    if (session) await accountRepository.deleteSessionById(session.sessionId).catch(() => undefined)
    return null
  }

  return session.user
}
