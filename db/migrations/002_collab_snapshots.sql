CREATE TABLE IF NOT EXISTS workbook_snapshots (
  user_id     UUID NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  workbook_id UUID NOT NULL,
  doc         BYTEA NOT NULL,
  title       VARCHAR(120) NOT NULL DEFAULT 'Workbook Baru',
  version     BIGINT NOT NULL DEFAULT 1,
  updated_at  TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  PRIMARY KEY (user_id, workbook_id)
);
CREATE INDEX IF NOT EXISTS workbook_snapshots_updated_idx
  ON workbook_snapshots(updated_at);
