import { createHash, randomBytes } from 'node:crypto'
import type { IncomingMessage, ServerResponse } from 'node:http'
import * as cookie from 'cookie'
import { accountRepository } from '../repositories/account-repository'

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

export function attachSessionCookie(
  res: ServerResponse,
  session: { token: string; expiresAt: Date },
): void {
  const setCookie = cookie.serialize(SESSION_COOKIE, session.token, {
    httpOnly: true,
    secure: process.env.NODE_ENV === 'production',
    sameSite: 'strict',
    path: '/',
    expires: session.expiresAt,
  })
  res.setHeader('Set-Cookie', setCookie)
}

export async function clearSession(req: IncomingMessage, res: ServerResponse): Promise<void> {
  const cookies = cookie.parse(req.headers.cookie ?? '')
  const token = cookies[SESSION_COOKIE]
  if (token) await accountRepository.deleteSessionByTokenHash(hashToken(token))

  const clearCookie = cookie.serialize(SESSION_COOKIE, '', {
    httpOnly: true,
    secure: process.env.NODE_ENV === 'production',
    sameSite: 'strict',
    path: '/',
    expires: new Date(0),
  })
  res.setHeader('Set-Cookie', clearCookie)
}

export async function getCurrentUser(req: IncomingMessage): Promise<{ id: string; email: string } | null> {
  const cookies = cookie.parse(req.headers.cookie ?? '')
  const token = cookies[SESSION_COOKIE]
  if (!token) return null

  const session = await accountRepository.findUserBySessionHash(hashToken(token))
  if (!session || session.expiresAt <= new Date()) {
    if (session) await accountRepository.deleteSessionById(session.sessionId).catch(() => undefined)
    return null
  }

  return session.user
}
