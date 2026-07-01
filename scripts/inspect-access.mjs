import pg from 'pg'
const p = new pg.Pool({ connectionString: process.env.DATABASE_URL })
const r = await p.query(
  `select wa.workbook_id, u.email, w.title
   from workbook_access wa
   join users u on u.id = wa.user_id
   left join workbook_snapshots w on w.workbook_id = wa.workbook_id`,
)
console.log(JSON.stringify(r.rows, null, 2))
await p.end()
