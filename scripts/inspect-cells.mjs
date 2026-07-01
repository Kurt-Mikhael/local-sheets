import pg from 'pg'
const p = new pg.Pool({ connectionString: process.env.DATABASE_URL })
const r = await p.query(
  `select snapshot from workbooks where id = '4cd16652-54b7-4cfe-aa12-e53b8efb2422'`,
)
console.log(JSON.stringify(r.rows[0].snapshot, null, 2))
await p.end()
