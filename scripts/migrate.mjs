import fs from 'node:fs/promises'
import path from 'node:path'
import process from 'node:process'
import pg from 'pg'

const connectionString = process.env.DATABASE_URL
if (!connectionString) {
  console.error('DATABASE_URL belum dikonfigurasi.')
  process.exit(1)
}

const pool = new pg.Pool({ connectionString })
try {
  const migrationsDir = path.join(process.cwd(), 'db', 'migrations')
  const files = (await fs.readdir(migrationsDir)).filter((name) => name.endsWith('.sql')).sort()
  for (const file of files) {
    const sql = await fs.readFile(path.join(migrationsDir, file), 'utf8')
    await pool.query(sql)
    console.log(`Applied ${file}`)
  }
} finally {
  await pool.end()
}
