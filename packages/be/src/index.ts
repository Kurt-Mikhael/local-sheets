// ponytail: --env-file=.env is a Node 20+ built-in; replace with dotenv only if a CLI flag isn't enough.
import express from 'express'
import { createServer } from 'node:http'
import { authRouter } from './routes/auth.js'
import { meRouter } from './routes/me.js'
import { syncRouter } from './routes/sync.js'
import { adminRouter } from './routes/admin.js'
import { sharedRouter } from './routes/shared.js'
import { workbooksRouter } from './routes/workbooks.js'
import { handleCollabUpgrade } from './routes/collab.js'
import { globalRateLimiter } from './lib/rate-limit.js'

// ponytail: keep the process alive on background-task failures (WS load/save, collab timer, etc.)
// so a transient DB blip doesn't take the whole API down until `pnpm dev` is restarted.
process.on('unhandledRejection', (reason) => {
  console.error('[be] unhandledRejection:', reason)
})
process.on('uncaughtException', (err) => {
  console.error('[be] uncaughtException:', err)
})

export const app = express()
const PORT = Number(process.env.PORT ?? 4000)

const trustProxy = process.env.TRUST_PROXY ?? 'loopback'
app.set('trust proxy', trustProxy)

app.use(globalRateLimiter)
// ponytail: import membawa snapshot utuh (10MB+ untuk file yang lewat beberapa ribu sel),
// jadi parser dengan limit lebih tinggi dipasang khusus untuk path itu sebelum parser global 5MB.
app.use('/api/admin/workbooks/import', express.json({ limit: '50mb' }))
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
app.use('/api/admin', adminRouter)
app.use('/api/shared', sharedRouter)
app.use('/api/workbooks', workbooksRouter)

app.get('/api/health', (_req, res) => {
  res.json({ ok: true })
})

if (!process.env.VERCEL) {
  const server = createServer(app)

  server.on('upgrade', (req, socket, head) => {
    const url = req.url ?? ''
    if (url.startsWith('/api/collab')) {
      handleCollabUpgrade(req, socket, head)
      return
    }
    socket.destroy()
  })

  server.listen(PORT, '0.0.0.0', () => {
    console.log(`[be] Server running on 0.0.0.0:${PORT}`)
  })
}
