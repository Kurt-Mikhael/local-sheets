import { Router } from 'express'
import argon2 from 'argon2'
import { createHash } from 'node:crypto'
import { authRateLimiter, emailRateLimiter } from '../lib/rate-limit.js'
import { accountRepository } from '../repositories/account-repository.js'
import { assertMutationRequest, HttpError } from '../lib/security.js'
import { asyncHandler } from '../lib/async-handler.js'
import { attachSessionCookie, createSession, clearSession, SESSION_COOKIE } from '../lib/session.js'
import cookie from 'cookie'
import { authSchema } from '../../../shared/src/schemas.js'

export const authRouter = Router()

const DUMMY_HASH =
  '$argon2id$v=19$m=19456,t=2,p=1$ZHVtbXlzYWx0Zm9ydGltaW5nYXR0YWNr$ZPq/NovVHCq4LrHZ0q0wY9bp7Q3s5VX8b0F8K6kZ6kA'

function emailKey(email: string): string {
  return createHash('sha256').update(email.toLowerCase()).digest('hex')
}

function rejectRate(res: Parameters<Parameters<typeof asyncHandler>[0]>[1], retryAfter: number, message: string) {
  res.status(429).set('Retry-After', String(retryAfter)).json({ error: message })
}

authRouter.post('/login', asyncHandler(async (req, res) => {
  assertMutationRequest(req)
  const rate = authRateLimiter.consume(`login:${req.ip ?? 'unknown'}`)
  if (!rate.allowed) return rejectRate(res, rate.retryAfterSeconds, 'Terlalu banyak percobaan. Coba lagi nanti.')

  const parsed = authSchema.safeParse(req.body)
  if (!parsed.success) throw new HttpError(400, 'Email atau password tidak valid.')

  const eKey = emailKey(parsed.data.email)
  const emailRate = emailRateLimiter.consume(`login:${eKey}`)
  if (!emailRate.allowed) return rejectRate(res, emailRate.retryAfterSeconds, 'Terlalu banyak percobaan untuk akun ini. Coba lagi nanti.')

  const user = await accountRepository.findUserByEmail(parsed.data.email)
  const verifyTarget = user?.passwordHash ?? DUMMY_HASH
  const valid = await argon2.verify(verifyTarget, parsed.data.password)
  if (!user || !valid) throw new HttpError(401, 'Email atau password salah.')

  const session = await createSession(user.id)
  attachSessionCookie(res, session)
  res.status(200).json({ user: { id: user.id, email: user.email, role: user.role } })
}))

authRouter.post('/register', asyncHandler(async (req, res) => {
  assertMutationRequest(req)
  const rate = authRateLimiter.consume(`register:${req.ip ?? 'unknown'}`)
  if (!rate.allowed) return rejectRate(res, rate.retryAfterSeconds, 'Terlalu banyak percobaan. Coba lagi nanti.')

  const parsed = authSchema.safeParse(req.body)
  if (!parsed.success) throw new HttpError(400, 'Email atau password tidak memenuhi ketentuan.')

  const eKey = emailKey(parsed.data.email)
  const emailRate = emailRateLimiter.consume(`register:${eKey}`)
  if (!emailRate.allowed) return rejectRate(res, emailRate.retryAfterSeconds, 'Terlalu banyak percobaan untuk email ini. Coba lagi nanti.')

  const existing = await accountRepository.findUserByEmail(parsed.data.email)
  if (existing) {
    await argon2.verify(DUMMY_HASH, parsed.data.password).catch(() => false)
    throw new HttpError(409, 'Email sudah terdaftar.')
  }

  const passwordHash = await argon2.hash(parsed.data.password, {
    type: argon2.argon2id,
    memoryCost: 19_456,
    timeCost: 2,
    parallelism: 1,
  })

  const user = await accountRepository.createUser(parsed.data.email, passwordHash, 'user')
  const session = await createSession(user.id)
  attachSessionCookie(res, session)
  res.status(201).json({ user: { id: user.id, email: user.email, role: user.role } })
}))

authRouter.post('/logout', asyncHandler(async (req, res) => {
  assertMutationRequest(req)
  await clearSession(req, res)
  res.json({ ok: true })
}))

// ponytail: WS upgrade can lose the HttpOnly cookie through dev proxies; this endpoint returns the
// same session token in the JSON body so the client can pass it via the WS query string.
authRouter.get('/ws-token', asyncHandler(async (req, res) => {
  const cookies = cookie.parse(req.headers.cookie ?? '')
  const token = cookies[SESSION_COOKIE]
  if (!token) throw new HttpError(401, 'Login diperlukan.')
  res.json({ token })
}))
