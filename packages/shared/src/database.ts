// Database row types — cocokkan dengan skema Supabase / PostgreSQL
// Auto-generated dari db/migrations/001_init.sql & db/supabase/001_schema.sql

export interface UserRow {
  id: string
  email: string
  password_hash: string
  created_at: string
  updated_at: string
}

export interface SessionRow {
  id: string
  token_hash: string
  user_id: string
  expires_at: string
  created_at: string
}

export interface WorkbookRow {
  user_id: string
  id: string
  title: string
  snapshot: Record<string, unknown>
  version: number
  created_at: string
  updated_at: string
  deleted_at: string | null
}

export interface SyncOperationRow {
  user_id: string
  operation_id: string
  workbook_id: string
  version: number
  created_at: string
}

// Helper: tipe untuk INSERT (tanpa field dengan DEFAULT)
export type UserInsert = Pick<UserRow, 'id' | 'email' | 'password_hash'>
export type SessionInsert = Pick<SessionRow, 'id' | 'token_hash' | 'user_id' | 'expires_at'>
export type WorkbookInsert = Pick<WorkbookRow, 'user_id' | 'id' | 'title' | 'snapshot' | 'version'>
export type SyncOperationInsert = Pick<SyncOperationRow, 'user_id' | 'operation_id' | 'workbook_id' | 'version'>
