import { randomUUID } from 'node:crypto'
import { query } from '../lib/postgres.js'

interface UserRow {
  id: string
  email: string
  password_hash: string
  role: 'user' | 'admin'
}

interface SessionUserRow {
  session_id: string
  expires_at: Date
  user_id: string
  email: string
  role: 'user' | 'admin'
}

export interface AccountUser {
  id: string
  email: string
  passwordHash: string
  role: 'user' | 'admin'
}

export interface SessionUser {
  sessionId: string
  expiresAt: Date
  user: { id: string; email: string; role: 'user' | 'admin' }
}

export class PostgresAccountRepository {
  async findUserByEmail(email: string): Promise<AccountUser | null> {
    const result = await query<UserRow>(
      'SELECT id, email, password_hash, role FROM users WHERE email = $1 LIMIT 1',
      [email],
    )
    const row = result.rows[0]
    return row
      ? { id: row.id, email: row.email, passwordHash: row.password_hash, role: row.role }
      : null
  }

  async createUser(
    email: string,
    passwordHash: string,
    role: 'user' | 'admin' = 'user',
  ): Promise<{ id: string; email: string; role: 'user' | 'admin' }> {
    const id = randomUUID()
    const result = await query<{ id: string; email: string; role: 'user' | 'admin' }>(
      `INSERT INTO users (id, email, password_hash, role)
       VALUES ($1, $2, $3, $4)
       RETURNING id, email, role`,
      [id, email, passwordHash, role],
    )
    return result.rows[0]
  }

  async createSession(userId: string, tokenHash: string, expiresAt: Date): Promise<void> {
    await query(
      `INSERT INTO sessions (id, token_hash, user_id, expires_at)
       VALUES ($1, $2, $3, $4)`,
      [randomUUID(), tokenHash, userId, expiresAt],
    )
  }

  async deleteSessionByTokenHash(tokenHash: string): Promise<void> {
    await query('DELETE FROM sessions WHERE token_hash = $1', [tokenHash])
  }

  async deleteSessionById(id: string): Promise<void> {
    await query('DELETE FROM sessions WHERE id = $1', [id])
  }

  async findUserBySessionHash(tokenHash: string): Promise<SessionUser | null> {
    const result = await query<SessionUserRow>(
      `SELECT s.id AS session_id, s.expires_at, u.id AS user_id, u.email, u.role
       FROM sessions s
       INNER JOIN users u ON u.id = s.user_id
       WHERE s.token_hash = $1
       LIMIT 1`,
      [tokenHash],
    )
    const row = result.rows[0]
    return row
      ? {
          sessionId: row.session_id,
          expiresAt: row.expires_at,
          user: { id: row.user_id, email: row.email, role: row.role },
        }
      : null
  }

  async findSnapshot(userId: string, workbookId: string): Promise<{ doc: Buffer } | null> {
    const result = await query<{ doc: Buffer }>(
      'SELECT doc FROM workbook_snapshots WHERE user_id = $1 AND workbook_id = $2 LIMIT 1',
      [userId, workbookId],
    )
    const row = result.rows[0]
    return row ? { doc: row.doc } : null
  }

  async findWorkbookOwner(workbookId: string): Promise<{ ownerId: string } | null> {
    const result = await query<{ user_id: string }>(
      'SELECT user_id FROM workbook_snapshots WHERE workbook_id = $1 LIMIT 1',
      [workbookId],
    )
    const row = result.rows[0]
    return row ? { ownerId: row.user_id } : null
  }

  async upsertSnapshot(userId: string, workbookId: string, doc: Buffer): Promise<void> {
    await query(
      `INSERT INTO workbook_snapshots (user_id, workbook_id, doc, version, updated_at)
       VALUES ($1, $2, $3, 1, NOW())
       ON CONFLICT (user_id, workbook_id)
       DO UPDATE SET doc = EXCLUDED.doc, version = workbook_snapshots.version + 1, updated_at = NOW()`,
      [userId, workbookId, doc],
    )
  }

  async createEmptySnapshot(userId: string, workbookId: string): Promise<void> {
    await query(
      `INSERT INTO workbook_snapshots (user_id, workbook_id, doc, version, updated_at)
       VALUES ($1, $2, '', 1, NOW())
       ON CONFLICT (user_id, workbook_id) DO NOTHING`,
      [userId, workbookId],
    )
  }

  async grantWorkbookAccess(workbookId: string, userId: string, grantedBy: string): Promise<void> {
    await query(
      `INSERT INTO workbook_access (workbook_id, user_id, granted_by)
       VALUES ($1, $2, $3)
       ON CONFLICT (workbook_id, user_id) DO NOTHING`,
      [workbookId, userId, grantedBy],
    )
  }

  async revokeWorkbookAccess(workbookId: string, userId: string): Promise<void> {
    await query(
      'DELETE FROM workbook_access WHERE workbook_id = $1 AND user_id = $2',
      [workbookId, userId],
    )
  }

  async revokeAllWorkbookAccess(workbookId: string): Promise<void> {
    await query('DELETE FROM workbook_access WHERE workbook_id = $1', [workbookId])
  }

  async deleteSnapshot(workbookId: string, userId: string): Promise<void> {
    await query(
      'DELETE FROM workbook_snapshots WHERE workbook_id = $1 AND user_id = $2',
      [workbookId, userId],
    )
  }

  // ponytail: admin sees only workbooks they own. schema has no separate
  // "owner_id" — whoever inserts the first snapshot row for a workbook_id is the owner.
  // when admin creates a workbook, createEmptySnapshot inserts under admin's user_id,
  // so the row is theirs and shows up here.
  async listWorkbooksByOwner(ownerId: string): Promise<Array<{ id: string; ownerEmail: string; ownerRole: string }>> {
    const result = await query<{ workbook_id: string; email: string; role: string }>(
      `SELECT DISTINCT ON (s.workbook_id)
              s.workbook_id,
              u.email,
              u.role
       FROM workbook_snapshots s
       INNER JOIN users u ON u.id = s.user_id
       WHERE s.user_id = $1
       ORDER BY s.workbook_id, s.updated_at DESC`,
      [ownerId],
    )
    return result.rows.map((r) => ({
      id: r.workbook_id,
      ownerEmail: r.email,
      ownerRole: r.role,
    }))
  }

  async listSharedWorkbookIds(userId: string): Promise<string[]> {
    const result = await query<{ workbook_id: string }>(
      'SELECT workbook_id FROM workbook_access WHERE user_id = $1 ORDER BY granted_at DESC',
      [userId],
    )
    return result.rows.map((r) => r.workbook_id)
  }

  async listWorkbookAccess(workbookId: string): Promise<Array<{ userId: string; email: string; grantedAt: Date }>> {
    const result = await query<{ user_id: string; email: string; granted_at: Date }>(
      `SELECT a.user_id, u.email, a.granted_at
       FROM workbook_access a
       INNER JOIN users u ON u.id = a.user_id
       WHERE a.workbook_id = $1
       ORDER BY a.granted_at DESC`,
      [workbookId],
    )
    return result.rows.map((r) => ({ userId: r.user_id, email: r.email, grantedAt: r.granted_at }))
  }

  async userHasWorkbookAccess(userId: string, workbookId: string): Promise<boolean> {
    const result = await query(
      'SELECT 1 FROM workbook_access WHERE user_id = $1 AND workbook_id = $2 LIMIT 1',
      [userId, workbookId],
    )
    return result.rowCount !== null && result.rowCount > 0
  }

  async listAllUsers(): Promise<Array<{ id: string; email: string; role: 'user' | 'admin' }>> {
    const result = await query<{ id: string; email: string; role: 'user' | 'admin' }>(
      'SELECT id, email, role FROM users ORDER BY created_at ASC',
    )
    return result.rows
  }
}

export const accountRepository = new PostgresAccountRepository()
