import express from 'express'
import { authRouter } from './routes/auth.js'
import { meRouter } from './routes/me.js'
import { syncRouter } from './routes/sync.js'
import { globalRateLimiter } from './lib/rate-limit.js'

export const app = express()
const PORT = Number(process.env.PORT ?? 4000)

const trustProxy = process.env.TRUST_PROXY ?? 'loopback'
app.set('trust proxy', trustProxy)

app.use(globalRateLimiter)
app.use(express.json({ limit: '5mb' }))
app.use(express.urlencoded({ extended: false }))

app.use((req, res, next) => {
  res.setHeader('X-Content-Type-Options', 'nosniff')
  res.setHeader('X-Frame-Options', 'DENY')
  res.setHeader('Referrer-Policy', 'no-referrer')
  res.setHeader(
    'Permissions-Policy',
    'camera=(), microphone=(), geolocation=(), payment=()',
  )
  if (process.env.NODE_ENV === 'production' || process.env.VERCEL === '1') {
    res.setHeader(
      'Strict-Transport-Security',
      'max-age=31536000; includeSubDomains',
    )
  }
  next()
})

app.use('/api/auth', authRouter)
app.use('/api/me', meRouter)
app.use('/api/sync', syncRouter)

app.get('/api/health', (_req, res) => {
  res.json({ ok: true })
})

if (!process.env.VERCEL) {
  app.listen(PORT, () => {
    console.log(`[be] Server running on http://localhost:${PORT}`)
  })
}
