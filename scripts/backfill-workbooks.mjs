import pg from 'pg'
const p = new pg.Pool({ connectionString: process.env.DATABASE_URL })
const r = await p.query(`
  INSERT INTO workbooks (user_id, id, title, snapshot, version, updated_at)
  SELECT s.user_id, s.workbook_id, s.title,
         jsonb_build_object('id', s.workbook_id, 'name', s.title, 'sheetOrder', '[]'::jsonb, 'styles', '{}'::jsonb, 'resources', '[]'::jsonb, 'sheets', '{}'::jsonb),
         0, NOW()
  FROM workbook_snapshots s
  LEFT JOIN workbooks w ON w.user_id = s.user_id AND w.id = s.workbook_id
  WHERE w.id IS NULL
  RETURNING id, title
`)
console.log('backfilled:', JSON.stringify(r.rows, null, 2))
await p.end()
