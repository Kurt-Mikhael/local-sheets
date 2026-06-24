import { Pool, type PoolClient, type QueryResultRow } from 'pg'

const connectionString = process.env.DATABASE_URL
if (!connectionString) throw new Error('DATABASE_URL belum dikonfigurasi.')

const globalForPostgres = globalThis as unknown as { postgresPool?: Pool }

export const postgresPool = globalForPostgres.postgresPool ?? new Pool({
  connectionString,
  max: Number(process.env.DB_POOL_MAX ?? 10),
  idleTimeoutMillis: 30_000,
  connectionTimeoutMillis: 10_000,
  ssl: process.env.DB_SSL === 'true' ? { rejectUnauthorized: true } : undefined,
})

if (process.env.NODE_ENV !== 'production') globalForPostgres.postgresPool = postgresPool

export async function query<T extends QueryResultRow>(text: string, values: unknown[] = []) {
  return postgresPool.query<T>(text, values)
}

export async function withTransaction<T>(
  callback: (client: PoolClient) => Promise<T>,
  isolation: 'READ COMMITTED' | 'SERIALIZABLE' = 'READ COMMITTED',
): Promise<T> {
  const client = await postgresPool.connect()
  try {
    await client.query('BEGIN')
    await client.query(`SET TRANSACTION ISOLATION LEVEL ${isolation}`)
    const result = await callback(client)
    await client.query('COMMIT')
    return result
  } catch (error) {
    await client.query('ROLLBACK').catch(() => undefined)
    throw error
  } finally {
    client.release()
  }
}
