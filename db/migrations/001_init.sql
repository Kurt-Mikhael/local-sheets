CREATE TABLE IF NOT EXISTS users (
  id UUID PRIMARY KEY,
  email VARCHAR(320) NOT NULL UNIQUE,
  password_hash TEXT NOT NULL,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE TABLE IF NOT EXISTS sessions (
  id UUID PRIMARY KEY,
  token_hash CHAR(64) NOT NULL UNIQUE,
  user_id UUID NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  expires_at TIMESTAMPTZ NOT NULL,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);
CREATE INDEX IF NOT EXISTS sessions_user_id_idx ON sessions(user_id);
CREATE INDEX IF NOT EXISTS sessions_expires_at_idx ON sessions(expires_at);

CREATE TABLE IF NOT EXISTS workbooks (
  user_id UUID NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  id UUID NOT NULL,
  title VARCHAR(120) NOT NULL,
  snapshot JSONB NOT NULL,
  version INTEGER NOT NULL DEFAULT 1 CHECK (version >= 0),
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  deleted_at TIMESTAMPTZ,
  PRIMARY KEY (user_id, id)
);
CREATE INDEX IF NOT EXISTS workbooks_user_cursor_idx ON workbooks(user_id, updated_at, id);

CREATE TABLE IF NOT EXISTS sync_operations (
  user_id UUID NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  operation_id UUID NOT NULL,
  workbook_id UUID NOT NULL,
  version INTEGER NOT NULL CHECK (version >= 0),
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  PRIMARY KEY (user_id, operation_id)
);
CREATE INDEX IF NOT EXISTS sync_operations_user_created_idx ON sync_operations(user_id, created_at);
CREATE INDEX IF NOT EXISTS sync_operations_workbook_idx ON sync_operations(user_id, workbook_id);
