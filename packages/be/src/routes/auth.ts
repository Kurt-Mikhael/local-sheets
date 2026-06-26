import { Router } from 'express'
import argon2 from 'argon2'
import { createHash } from 'node:crypto'
import { authRateLimiter, emailRateLimiter } from '../lib/rate-limit.js'
import { accountRepository } from '../repositories/account-repository.js'
import { assertMutationRequest, HttpError, safeErrorResponse } from '../lib/security.js'
import { attachSessionCookie, createSession } from '../lib/session.js'
import { clearSession } from '../lib/session.js'
import { authSchema } from '../../../shared/src/schemas.js'

export const authRouter = Router()

const DUMMY_HASH =
  '$argon2id$v=19$m=19456,t=2,p=1$ZHVtbXlzYWx0Zm9ydGltaW5nYXR0YWNr$ZPq/NovVHCq4LrHZ0q0wY9bp7Q3s5VX8b0F8K6kZ6kA'

function emailKey(email: string): string {
  return createHash('sha256').update(email.toLowerCase()).digest('hex')
}

authRouter.post('/login', async (req, res) => {
  try {
    assertMutationRequest(req)
    const rate = authRateLimiter.consume(`login:${req.ip ?? 'unknown'}`)
    if (!rate.allowed) {
      res.status(429)
        .set('Retry-After', String(rate.retryAfterSeconds))
        .json({ error: 'Terlalu banyak percobaan. Coba lagi nanti.' })
      return
    }

    const parsed = authSchema.safeParse(req.body)
    if (!parsed.success) throw new HttpError(400, 'Email atau password tidak valid.')

    const eKey = emailKey(parsed.data.email)
    const emailRate = emailRateLimiter.consume(`login:${eKey}`)
    if (!emailRate.allowed) {
      res.status(429)
        .set('Retry-After', String(emailRate.retryAfterSeconds))
        .json({ error: 'Terlalu banyak percobaan untuk akun ini. Coba lagi nanti.' })
      return
    }

    const user = await accountRepository.findUserByEmail(parsed.data.email)
    const verifyTarget = user?.passwordHash ?? DUMMY_HASH
    const valid = await argon2.verify(verifyTarget, parsed.data.password)
    if (!user || !valid) throw new HttpError(401, 'Email atau password salah.')

    const session = await createSession(user.id)
    attachSessionCookie(res, session)
    res.status(200).json({ user: { id: user.id, email: user.email } })
  } catch (error) {
    if (res.headersSent) return
    const safe = safeErrorResponse(error)
    res.status(safe.status).json(safe.body)
  }
})

authRouter.post('/register', async (req, res) => {
  try {
    assertMutationRequest(req)
    const rate = authRateLimiter.consume(`register:${req.ip ?? 'unknown'}`)
    if (!rate.allowed) {
      res.status(429)
        .set('Retry-After', String(rate.retryAfterSeconds))
        .json({ error: 'Terlalu banyak percobaan. Coba lagi nanti.' })
      return
    }

    const parsed = authSchema.safeParse(req.body)
    if (!parsed.success) throw new HttpError(400, 'Email atau password tidak memenuhi ketentuan.')

    const eKey = emailKey(parsed.data.email)
    const emailRate = emailRateLimiter.consume(`register:${eKey}`)
    if (!emailRate.allowed) {
      res.status(429)
        .set('Retry-After', String(emailRate.retryAfterSeconds))
        .json({ error: 'Terlalu banyak percobaan untuk email ini. Coba lagi nanti.' })
      return
    }

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

    const user = await accountRepository.createUser(parsed.data.email, passwordHash)
    const session = await createSession(user.id)
    attachSessionCookie(res, session)
    res.status(201).json({ user })
  } catch (error) {
    if (res.headersSent) return
    const safe = safeErrorResponse(error)
    res.status(safe.status).json(safe.body)
  }
})

authRouter.post('/logout', async (req, res) => {
  try {
    assertMutationRequest(req)
    await clearSession(req, res)
    res.json({ ok: true })
  } catch (error) {
    if (res.headersSent) return
    const safe = safeErrorResponse(error)
    res.status(safe.status).json(safe.body)
  }
})
