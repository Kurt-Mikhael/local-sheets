import pg from 'pg'
const p = new pg.Pool({ connectionString: process.env.DATABASE_URL })
const r = await p.query(
  `select snapshot from workbooks where id = '4cd16652-54b7-4cfe-aa12-e53b8efb2422'`,
)
const s = r.rows[0].snapshot
const cells = s?.sheets?.['78d24b85-7077-403a-8350-ead6d88a746b']?.cellData ?? {}
for (const [row, cols] of Object.entries(cells)) {
  for (const [col, cell] of Object.entries(cols)) {
    console.log(`[${row}][${col}]`, JSON.stringify(cell))
  }
}
await p.end()
