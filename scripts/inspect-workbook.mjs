import pg from 'pg'
const p = new pg.Pool({ connectionString: process.env.DATABASE_URL })
const r = await p.query(`
  select u.email, u.role, u.id
  from users u where u.email in ('mwt@gmail.com', 'example2@gmail.com')
`)
console.log(JSON.stringify(r.rows, null, 2))
const a = await p.query(`select id, title, version from workbooks where id = 'e8e88122-952c-4339-8953-be2922ed22a5'`)
console.log('workbook:', JSON.stringify(a.rows, null, 2))
const b = await p.query(`select user_id, version, length(snapshot::text) sz from workbooks where id = 'e8e88122-952c-4339-8953-be2922ed22a5'`)
console.log('snapshot:', JSON.stringify(b.rows, null, 2))
await p.end()
