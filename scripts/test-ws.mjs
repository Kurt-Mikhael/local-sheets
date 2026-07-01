import { WebSocket } from 'ws'
import pg from 'pg'
import argon2 from 'argon2'

const p = new pg.Pool({ connectionString: process.env.DATABASE_URL })

const email = 'mwt@gmail.com'
const password = 'indonesiA'

const user = await p.query('select id, password_hash from users where email = $1', [email])
if (user.rowCount === 0) { console.error('user not found'); process.exit(1) }
const ok = await argon2.verify(user.rows[0].password_hash, password)
if (!ok) { console.error('bad password'); process.exit(1) }

const sessionId = (await import('node:crypto')).randomUUID()
const token = (await import('node:crypto')).randomBytes(32).toString('base64url')
const { createHash } = await import('node:crypto')
const tokenHash = createHash('sha256').update(token).digest('hex')
const expires = new Date(Date.now() + 24 * 60 * 60 * 1000)
await p.query(
  'insert into sessions (id, token_hash, user_id, expires_at) values ($1, $2, $3, $4)',
  [sessionId, tokenHash, user.rows[0].id, expires],
)
console.log('cookie:', `localsheet_session=${token}`)
await p.end()

const ws = new WebSocket(`ws://localhost:3000/api/collab/4cd16652-54b7-4cfe-aa12-e53b8efb2422?uid=${user.rows[0].id}`, {
  headers: { Cookie: `localsheet_session=${token}` },
})
ws.on('open', () => console.log('WS opened'))
ws.on('error', (e) => console.log('WS error:', e.message))
ws.on('close', (code, reason) => {
  console.log('WS close:', code, reason.toString())
  process.exit(0)
})
setTimeout(() => process.exit(0), 3000)
