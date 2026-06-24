import { Router } from 'express'
import argon2 from 'argon2'
import { authRateLimiter } from '../lib/rate-limit'
import { accountRepository } from '../repositories/account-repository'
import { assertMutationRequest, HttpError, safeErrorResponse } from '../lib/security'
import { attachSessionCookie, createSession } from '../lib/session'
import { clearSession } from '../lib/session'
import { authSchema } from '../../../shared/src/schemas'

export const authRouter = Router()

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

    const user = await accountRepository.findUserByEmail(parsed.data.email)
    const valid = user ? await argon2.verify(user.passwordHash, parsed.data.password) : false
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
