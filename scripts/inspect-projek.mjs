import pg from 'pg'
const p = new pg.Pool({ connectionString: process.env.DATABASE_URL })
const r = await p.query(`
  select s.workbook_id, s.title, w.version as wb_version, w.id as wb_id
  from workbook_snapshots s
  left join workbooks w on w.user_id = s.user_id and w.id = s.workbook_id
  where s.title = 'projek Baru'
`)
console.log(JSON.stringify(r.rows, null, 2))
await p.end()
