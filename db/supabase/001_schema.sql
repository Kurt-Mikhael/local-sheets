-- =====================================================
-- Schema untuk Supabase (PostgreSQL)
-- Aplikasi: LocalSheet / offline-excel
-- =====================================================

-- Extensions (sudah aktif secara default di Supabase)
CREATE EXTENSION IF NOT EXISTS pgcrypto;   -- untuk gen_random_uuid()
CREATE EXTENSION IF NOT EXISTS pg_stat_statements;

-- =====================================================
-- Trigger: auto-update updated_at
-- =====================================================
CREATE OR REPLACE FUNCTION update_updated_at()
RETURNS TRIGGER AS $$
BEGIN
  NEW.updated_at = NOW();
  RETURN NEW;
END;
$$ LANGUAGE plpgsql;

-- =====================================================
-- Tabel: users
-- =====================================================
CREATE TABLE IF NOT EXISTS users (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  email VARCHAR(320) NOT NULL UNIQUE,
  password_hash TEXT NOT NULL,
  role VARCHAR(16) NOT NULL DEFAULT 'user'
    CHECK (role IN ('user', 'admin', 'super_admin')),
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE TRIGGER trg_users_updated_at
  BEFORE UPDATE ON users
  FOR EACH ROW EXECUTE FUNCTION update_updated_at();

-- =====================================================
-- Tabel: sessions
-- =====================================================
CREATE TABLE IF NOT EXISTS sessions (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  token_hash CHAR(64) NOT NULL UNIQUE,
  user_id UUID NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  expires_at TIMESTAMPTZ NOT NULL,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS sessions_user_id_idx ON sessions(user_id);
CREATE INDEX IF NOT EXISTS sessions_expires_at_idx ON sessions(expires_at);
CREATE INDEX IF NOT EXISTS sessions_token_hash_idx ON sessions(token_hash);

-- =====================================================
-- Tabel: workbooks
-- =====================================================
CREATE TABLE IF NOT EXISTS workbooks (
  user_id UUID NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  id UUID NOT NULL DEFAULT gen_random_uuid(),
  title VARCHAR(120) NOT NULL,
  snapshot JSONB NOT NULL DEFAULT '{}'::jsonb,
  version INTEGER NOT NULL DEFAULT 1 CHECK (version >= 0),
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  deleted_at TIMESTAMPTZ,
  PRIMARY KEY (user_id, id)
);

CREATE TRIGGER trg_workbooks_updated_at
  BEFORE UPDATE ON workbooks
  FOR EACH ROW EXECUTE FUNCTION update_updated_at();

CREATE INDEX IF NOT EXISTS workbooks_user_cursor_idx ON workbooks(user_id, updated_at, id);
CREATE INDEX IF NOT EXISTS workbooks_deleted_at_idx ON workbooks(user_id, deleted_at) WHERE deleted_at IS NULL;

-- =====================================================
-- Tabel: sync_operations
-- =====================================================
CREATE TABLE IF NOT EXISTS sync_operations (
  user_id UUID NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  operation_id UUID NOT NULL DEFAULT gen_random_uuid(),
  workbook_id UUID NOT NULL,
  version INTEGER NOT NULL CHECK (version >= 0),
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  PRIMARY KEY (user_id, operation_id)
);

CREATE INDEX IF NOT EXISTS sync_operations_user_created_idx ON sync_operations(user_id, created_at);
CREATE INDEX IF NOT EXISTS sync_operations_workbook_idx ON sync_operations(user_id, workbook_id);

-- =====================================================
-- Row Level Security (RLS)
-- Catatan: RLS berlaku jika koneksi via Supabase API / anon key.
--          Untuk koneksi direct via pg (service_role key), RLS dilewati.
--          Aplikasi ini menggunakan direct pg connection, jadi RLS bersifat opsional.
-- =====================================================
ALTER TABLE users ENABLE ROW LEVEL SECURITY;
ALTER TABLE sessions ENABLE ROW LEVEL SECURITY;
ALTER TABLE workbooks ENABLE ROW LEVEL SECURITY;
ALTER TABLE sync_operations ENABLE ROW LEVEL SECURITY;

-- Policy: users hanya bisa membaca data dirinya sendiri
CREATE POLICY users_self ON users
  FOR ALL
  USING (id = auth.uid()::uuid);

-- Policy: sessions hanya milik user yang bersangkutan
CREATE POLICY sessions_self ON sessions
  FOR ALL
  USING (user_id = auth.uid()::uuid);

-- Policy: workbooks hanya milik user yang bersangkutan
CREATE POLICY workbooks_self ON workbooks
  FOR ALL
  USING (user_id = auth.uid()::uuid);

-- Policy: sync_operations hanya milik user yang bersangkutan
CREATE POLICY sync_operations_self ON sync_operations
  FOR ALL
  USING (user_id = auth.uid()::uuid);
