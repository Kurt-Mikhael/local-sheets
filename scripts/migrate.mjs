import fs from 'node:fs/promises'
import path from 'node:path'
import process from 'node:process'
import pg from 'pg'

const connectionString = process.env.DATABASE_URL
if (!connectionString) {
  console.error('DATABASE_URL belum dikonfigurasi.')
  process.exit(1)
}

// ponytail: pakai single Client (bukan Pool) supaya GUC set_config(..., true)
// stay di session yang sama untuk semua migration. Pool bisa ambil connection
// berbeda tiap query dan GUC session-local bakal hilang.
const client = new pg.Client({ connectionString })
await client.connect()
try {
  // ponytail: forward GUC params into the migration session. Env vars
  // prefixed APP_GUC_ become session-local settings via set_config.
  // Underscores after the prefix map to dots so an env var like
  // APP_GUC_APP_SUPER_ADMIN_EMAIL becomes current_setting('app.super_admin_email', true).
  const gucParams = Object.entries(process.env)
    .filter(([k]) => k.startsWith('APP_GUC_'))
    .map(([k, v]) => [k.slice('APP_GUC_'.length).toLowerCase().replace(/_/g, '.'), v])
  if (gucParams.length > 0) {
    const sets = gucParams
      .map(([k, v], i) => `set_config($${i + 1}, $${i + 2}, true)`)
      .join(', ')
    const values = gucParams.flatMap(([k, v]) => [k, v])
    await client.query(`SELECT ${sets}`, values)
  }

  const migrationsDir = path.join(process.cwd(), 'db', 'migrations')
  const files = (await fs.readdir(migrationsDir)).filter((name) => name.endsWith('.sql')).sort()
  for (const file of files) {
    const sql = await fs.readFile(path.join(migrationsDir, file), 'utf8')
    await client.query(sql)
    console.log(`Applied ${file}`)
  }
} finally {
  await client.end()
}
