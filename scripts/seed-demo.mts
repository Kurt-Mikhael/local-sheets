import pg from 'pg'
import argon2 from 'argon2'
import { randomUUID } from 'node:crypto'

const connectionString = process.env.DATABASE_URL
if (!connectionString) {
  console.error('DATABASE_URL belum dikonfigurasi.')
  process.exit(1)
}

const pool = new pg.Pool({ connectionString })

async function ensureDemoUser(email: string, password: string) {
  const existing = await pool.query<{ id: string }>(
    'SELECT id FROM users WHERE email = $1 LIMIT 1',
    [email],
  )

  if ((existing.rowCount ?? 0) > 0) {
    console.log(`[seed] User ${email} sudah ada, lewati.`)
    return existing.rows[0].id
  }

  const id = randomUUID()
  const passwordHash = await argon2.hash(password, {
    type: argon2.argon2id,
    memoryCost: 19_456,
    timeCost: 2,
    parallelism: 1,
  })

  await pool.query(
    'INSERT INTO users (id, email, password_hash) VALUES ($1, $2, $3)',
    [id, email, passwordHash],
  )
  console.log(`[seed] User ${email} dibuat (password akan dicetak sekali).`)
  return id
}

async function main() {
  const password = process.env.SEED_PASSWORD ?? `Demo-${randomUUID().slice(0, 12)}Aa1!`
  const emails = (process.env.SEED_EMAILS ?? 'demo@example.com,user@test.com').split(',')

  for (const raw of emails) {
    const email = raw.trim().toLowerCase()
    if (!email) continue
    await ensureDemoUser(email, password)
  }

  console.log('\n=== Kredensial demo ===')
  for (const raw of emails) {
    const email = raw.trim().toLowerCase()
    if (email) console.log(`  ${email}  /  ${password}`)
  }
  console.log('Simpan password ini sekarang. Tidak akan dicetak ulang.\n')
}

main()
  .catch((err) => {
    console.error('[seed] Gagal:', err)
    process.exitCode = 1
  })
  .finally(() => pool.end())
