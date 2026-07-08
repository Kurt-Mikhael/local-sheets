-- ponytail: ADD COLUMN IF NOT EXISTS skips the column, but inline CHECK
-- would still try to add a duplicate constraint on re-run. Use a named
-- constraint guarded by IF NOT EXISTS via DO block.
DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM information_schema.columns
    WHERE table_name = 'users' AND column_name = 'role'
  ) THEN
    ALTER TABLE users
      ADD COLUMN role VARCHAR(16) NOT NULL DEFAULT 'user'
      CONSTRAINT users_role_check_legacy CHECK (role IN ('user', 'admin'));
  END IF;
END
$$;

CREATE INDEX IF NOT EXISTS users_role_idx ON users(role);

CREATE TABLE IF NOT EXISTS workbook_access (
  workbook_id UUID NOT NULL,
  user_id UUID NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  granted_by UUID REFERENCES users(id) ON DELETE SET NULL,
  granted_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  PRIMARY KEY (workbook_id, user_id)
);

CREATE INDEX IF NOT EXISTS workbook_access_user_idx ON workbook_access(user_id);
