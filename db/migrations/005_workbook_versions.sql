CREATE TABLE IF NOT EXISTS workbook_versions (
  id            UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  workbook_id   UUID NOT NULL,
  version_label VARCHAR(120) NOT NULL,
  snapshot      JSONB NOT NULL,
  created_at    TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  created_by    UUID REFERENCES users(id) ON DELETE SET NULL
);

CREATE INDEX IF NOT EXISTS workbook_versions_workbook_idx
  ON workbook_versions(workbook_id, created_at DESC);
