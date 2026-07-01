ALTER TABLE workbook_snapshots
  ADD COLUMN IF NOT EXISTS title VARCHAR(120) NOT NULL DEFAULT 'Workbook Baru';

UPDATE workbook_snapshots ws
SET title = w.title
FROM workbooks w
WHERE ws.user_id = w.user_id
  AND ws.workbook_id = w.id
  AND ws.title = 'Workbook Baru';
