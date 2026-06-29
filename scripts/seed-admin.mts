import argon2 from 'argon2'
import { randomUUID } from 'node:crypto'
import process from 'node:process'
import pg from 'pg'
import { readFileSync, existsSync } from 'node:fs'
import { resolve } from 'node:path'

const envPath = resolve(process.cwd(), '.env')
if (existsSync(envPath)) {
  for (const line of readFileSync(envPath, 'utf8').split(/\r?\n/)) {
    const trimmed = line.trim()
    if (!trimmed || trimmed.startsWith('#')) continue
    const eq = trimmed.indexOf('=')
    if (eq === -1) continue
    const key = trimmed.slice(0, eq).trim()
    const value = trimmed.slice(eq + 1).trim().replace(/^["']|["']$/g, '')
    if (process.env[key] === undefined) process.env[key] = value
  }
}

const ADMIN_EMAIL = process.env.ADMIN_EMAIL ?? 'mwt@2026'
const ADMIN_PASSWORD = process.env.ADMIN_PASSWORD ?? 'indonesiA'

const connectionString = process.env.DATABASE_URL
if (!connectionString) {
  console.error('DATABASE_URL belum dikonfigurasi.')
  process.exit(1)
}

const pool = new pg.Pool({ connectionString })

try {
  const passwordHash = await argon2.hash(ADMIN_PASSWORD, {
    type: argon2.argon2id,
    memoryCost: 19_456,
    timeCost: 2,
    parallelism: 1,
  })

  const result = await pool.query<{ id: string; email: string; role: string }>(
    `INSERT INTO users (id, email, password_hash, role)
     VALUES ($1, $2, $3, 'admin')
     ON CONFLICT (email)
     DO UPDATE SET password_hash = EXCLUDED.password_hash, role = 'admin'
     RETURNING id, email, role`,
    [randomUUID(), ADMIN_EMAIL, passwordHash],
  )
  const user = result.rows[0]
  console.log(`Admin seeded: ${user.email} (${user.id}) role=${user.role}`)
} catch (error) {
  console.error('Seed admin gagal:', error instanceof Error ? error.message : error)
  process.exit(1)
} finally {
  await pool.end()
}
