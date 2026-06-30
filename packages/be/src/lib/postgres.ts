import pg from 'pg'

const connectionString = process.env.DATABASE_URL
if (!connectionString) throw new Error('DATABASE_URL belum dikonfigurasi.')

const { Pool } = pg

let pool: pg.Pool | undefined

function withSslMode(url: string): string {
  // ponytail: serverless cold start + cross-region Neon
  // needs longer than 10s for TCP handshake when the function region
  // differs from the DB region. keepAlive stops Vercel NAT from
  // silently dropping idle pooled connections between requests.
  if (/[?&]sslmode=/.test(url)) return url
  return url + (url.includes('?') ? '&' : '?') + 'sslmode=require'
}

function getPool(): pg.Pool {
  if (pool) return pool

  const dbSsl = process.env.DB_SSL === 'true'
  const rejectUnauthorized = process.env.DB_SSL_REJECT_UNAUTHORIZED !== 'false'
  const finalUrl = dbSsl ? withSslMode(connectionString) : connectionString

  pool = new Pool({
    connectionString: finalUrl,
    max: Number(process.env.DB_POOL_MAX ?? 10),
    idleTimeoutMillis: 30_000,
    connectionTimeoutMillis: 30_000,
    keepAlive: true,
    statement_timeout: Number(process.env.DB_STATEMENT_TIMEOUT_MS ?? 30_000),
    query_timeout: Number(process.env.DB_QUERY_TIMEOUT_MS ?? 30_000),
    ssl: dbSsl ? { rejectUnauthorized } : false,
  })

  pool.on('error', (err) => {
    console.error('[pg] idle client error:', err)
  })

  return pool
}

export async function query<T extends pg.QueryResultRow>(text: string, values: unknown[] = []) {
  return getPool().query<T>(text, values)
}

export async function withTransaction<T>(fn: (client: pg.PoolClient) => Promise<T>): Promise<T> {
  const client = await getPool().connect()
  try {
    await client.query('BEGIN')
    const result = await fn(client)
    await client.query('COMMIT')
    return result
  } catch (err) {
    await client.query('ROLLBACK').catch(() => undefined)
    throw err
  } finally {
    client.release()
  }
}
