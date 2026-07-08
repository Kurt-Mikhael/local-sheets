import argon2 from 'argon2'
import { randomUUID } from 'node:crypto'
import process from 'node:process'
import pg from 'pg'

const ADMIN_EMAIL = process.env.ADMIN_EMAIL ?? 'mwt@gmail.com'
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

  // ponytail: only force role='admin' on insert or on existing non-super_admin users.
  // super_admin is a higher privilege and must never be silently demoted by re-seeding.
  const result = await pool.query<{ id: string; email: string; role: string }>(
    `INSERT INTO users (id, email, password_hash, role)
     VALUES ($1, $2, $3, 'admin')
     ON CONFLICT (email)
     DO UPDATE SET password_hash = EXCLUDED.password_hash,
                   role = CASE WHEN users.role = 'super_admin' THEN users.role ELSE 'admin' END
     RETURNING id, email, role`,
    [randomUUID(), ADMIN_EMAIL, passwordHash],
  )
  const user = result.rows[0]
  console.log(`Admin seeded: ${user.email} (${user.id}) role=${user.role}`)
  if (user.role !== 'super_admin') {
    console.log('Jalankan "pnpm db:migrate" setelah ini untuk promote ke super_admin (kalau email cocok dengan APP_GUC_APP_SUPER_ADMIN_EMAIL).')
  }
} catch (error) {
  console.error('Seed admin gagal:', error instanceof Error ? error.message : error)
  process.exit(1)
} finally {
  await pool.end()
}
