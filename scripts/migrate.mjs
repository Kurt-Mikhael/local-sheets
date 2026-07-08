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
  // ponytail: forward GUC params into the migration session. Migration 006
  // reads 'app.super_admin_email'. Env var names can't contain dots, so the
  // env var is APP_GUC_SUPER_ADMIN_EMAIL and we set the GUC key explicitly
  // (no auto-mapping — env-name conventions break when GUC keys have
  // underscores of their own, like super_admin).
  const gucValues = []
  if (process.env.APP_GUC_SUPER_ADMIN_EMAIL) {
    gucValues.push(['app.super_admin_email', process.env.APP_GUC_SUPER_ADMIN_EMAIL])
  }
  if (gucValues.length > 0) {
    console.log(`[migrate] forwarding GUC params: ${gucValues.map(([k, v]) => `${k}=${v}`).join(', ')}`)
    const sets = gucValues
      .map(([,], i) => `set_config($${i * 2 + 1}, $${i * 2 + 2}, true)`)
      .join(', ')
    const params = gucValues.flatMap(([k, v]) => [k, v])
    await client.query(`SELECT ${sets}`, params)
  } else {
    console.log('[migrate] no APP_GUC_* env vars found in process.env')
  }
  if (gucParams.length > 0) {
    console.log(`[migrate] forwarding GUC params: ${gucParams.map(([k, v]) => `${k}=${v}`).join(', ')}`)
    const sets = gucParams
      .map(([k, v], i) => `set_config($${i + 1}, $${i + 2}, true)`)
      .join(', ')
    const values = gucParams.flatMap(([k, v]) => [k, v])
    await client.query(`SELECT ${sets}`, values)
  } else {
    console.log('[migrate] no APP_GUC_* env vars found in process.env')
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
