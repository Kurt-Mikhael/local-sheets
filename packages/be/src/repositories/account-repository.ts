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

  async findWorkbookData(
    userId: string,
    workbookId: string,
  ): Promise<{ title: string; snapshot: Record<string, unknown>; version: number; updatedAt: string } | null> {
    const result = await query<{ title: string; snapshot: Record<string, unknown> | null; version: number; updated_at: Date }>(
      `SELECT title, snapshot, version, updated_at
       FROM workbooks
       WHERE user_id = $1 AND id = $2 AND deleted_at IS NULL
       LIMIT 1`,
      [userId, workbookId],
    )
    const row = result.rows[0]
    if (!row) return null
    return {
      title: row.title,
      snapshot: row.snapshot ?? { id: workbookId, name: row.title, sheetOrder: [], styles: {}, resources: [], sheets: {} },
      version: row.version,
      updatedAt: row.updated_at.toISOString(),
    }
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
      `INSERT INTO workbook_snapshots (user_id, workbook_id, doc, version, title, updated_at)
       VALUES ($1, $2, $3, 1, 'Workbook Baru', NOW())
       ON CONFLICT (user_id, workbook_id)
       DO UPDATE SET doc = EXCLUDED.doc, version = workbook_snapshots.version + 1, updated_at = NOW()`,
      [userId, workbookId, doc],
    )
  }

  async renameSnapshot(userId: string, workbookId: string, title: string): Promise<void> {
    await query(
      `UPDATE workbook_snapshots SET title = $3, updated_at = NOW()
       WHERE user_id = $1 AND workbook_id = $2`,
      [userId, workbookId, title],
    )
  }

  async findSnapshotTitle(userId: string, workbookId: string): Promise<string | null> {
    const result = await query<{ title: string }>(
      'SELECT title FROM workbook_snapshots WHERE user_id = $1 AND workbook_id = $2 LIMIT 1',
      [userId, workbookId],
    )
    return result.rows[0]?.title ?? null
  }

  async createEmptySnapshot(userId: string, workbookId: string, title: string): Promise<void> {
    // ponytail: also seed workbooks so a freshly-created workbook is visible to shared users
    const emptySnapshot = { id: workbookId, name: title, sheetOrder: [], styles: {}, resources: [], sheets: {} }
    await query(
      `INSERT INTO workbook_snapshots (user_id, workbook_id, doc, version, title, updated_at)
       VALUES ($1, $2, '', 1, $3, NOW())
       ON CONFLICT (user_id, workbook_id) DO NOTHING`,
      [userId, workbookId, title],
    )
    await query(
      `INSERT INTO workbooks (user_id, id, title, snapshot, version, updated_at)
       VALUES ($1, $2, $3, $4::jsonb, 0, NOW())
       ON CONFLICT (user_id, id) DO UPDATE SET title = EXCLUDED.title`,
      [userId, workbookId, title, JSON.stringify(emptySnapshot)],
    )
  }

  // ponytail: same as createEmptySnapshot but with a real snapshot (used by Excel import)
  async createWorkbookWithSnapshot(
    userId: string,
    workbookId: string,
    title: string,
    snapshot: Record<string, unknown>,
  ): Promise<void> {
    await query(
      `INSERT INTO workbook_snapshots (user_id, workbook_id, doc, version, title, updated_at)
       VALUES ($1, $2, '', 1, $3, NOW())
       ON CONFLICT (user_id, workbook_id) DO NOTHING`,
      [userId, workbookId, title],
    )
    await query(
      `INSERT INTO workbooks (user_id, id, title, snapshot, version, updated_at)
       VALUES ($1, $2, $3, $4::jsonb, 1, NOW())
       ON CONFLICT (user_id, id) DO UPDATE SET
         title = EXCLUDED.title,
         snapshot = EXCLUDED.snapshot,
         version = EXCLUDED.version,
         updated_at = NOW()`,
      [userId, workbookId, title, JSON.stringify(snapshot)],
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
  // so the row is theirs and shows up here. left-join `workbooks` for live title;
  // fallback to a placeholder when only the snapshot row exists.
  async listWorkbooksByOwner(ownerId: string): Promise<Array<{ id: string; title: string; ownerEmail: string; ownerRole: string }>> {
    const result = await query<{ workbook_id: string; title: string; email: string; role: string }>(
      `SELECT DISTINCT ON (s.workbook_id)
              s.workbook_id,
              COALESCE(NULLIF(w.title, ''), s.title) AS title,
              u.email,
              u.role
       FROM workbook_snapshots s
       INNER JOIN users u ON u.id = s.user_id
       LEFT JOIN workbooks w ON w.user_id = s.user_id AND w.id = s.workbook_id
       WHERE s.user_id = $1
       ORDER BY s.workbook_id, s.updated_at DESC`,
      [ownerId],
    )
    return result.rows.map((r) => ({
      id: r.workbook_id,
      title: r.title,
      ownerEmail: r.email,
      ownerRole: r.role,
    }))
  }

  async listAllWorkbooksForAdmin(): Promise<Array<{ id: string; title: string; ownerEmail: string; ownerRole: string }>> {
    const result = await query<{ workbook_id: string; title: string; email: string; role: string }>(
      `SELECT DISTINCT ON (s.workbook_id)
              s.workbook_id,
              COALESCE(NULLIF(w.title, ''), s.title) AS title,
              u.email,
              u.role
       FROM workbook_snapshots s
       INNER JOIN users u ON u.id = s.user_id
       LEFT JOIN workbooks w ON w.user_id = s.user_id AND w.id = s.workbook_id
       WHERE w.deleted_at IS NULL
       ORDER BY s.workbook_id, s.updated_at DESC`,
    )
    return result.rows.map((r) => ({
      id: r.workbook_id,
      title: r.title,
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

  // ponytail: workbook version history — admin can save labeled snapshots and restore them later.
  // app-level cascade: when a workbook is deleted, also call deleteVersionsForWorkbook in the same transaction.
  async createWorkbookVersion(
    workbookId: string,
    label: string,
    snapshot: Record<string, unknown>,
    createdBy: string,
  ): Promise<{ id: string; createdAt: string }> {
    const result = await query<{ id: string; created_at: Date }>(
      `INSERT INTO workbook_versions (workbook_id, version_label, snapshot, created_by)
       VALUES ($1, $2, $3::jsonb, $4)
       RETURNING id, created_at`,
      [workbookId, label, JSON.stringify(snapshot), createdBy],
    )
    const row = result.rows[0]
    return { id: row.id, createdAt: row.created_at.toISOString() }
  }

  async listWorkbookVersions(
    workbookId: string,
  ): Promise<Array<{ id: string; label: string; createdAt: string; createdBy: string | null; snapshotSize: number }>> {
    const result = await query<{ id: string; label: string; created_at: Date; created_by: string | null; snapshot: Record<string, unknown> }>(
      `SELECT id, version_label, created_at, created_by, snapshot
       FROM workbook_versions
       WHERE workbook_id = $1
       ORDER BY created_at DESC`,
      [workbookId],
    )
    return result.rows.map((r) => ({
      id: r.id,
      label: r.label,
      createdAt: r.created_at.toISOString(),
      createdBy: r.created_by,
      snapshotSize: JSON.stringify(r.snapshot).length,
    }))
  }

  async getWorkbookVersion(
    versionId: string,
  ): Promise<{ id: string; workbookId: string; label: string; snapshot: Record<string, unknown>; createdAt: string; createdBy: string | null } | null> {
    const result = await query<{ id: string; workbook_id: string; label: string; snapshot: Record<string, unknown>; created_at: Date; created_by: string | null }>(
      `SELECT id, workbook_id, version_label, snapshot, created_at, created_by
       FROM workbook_versions
       WHERE id = $1
       LIMIT 1`,
      [versionId],
    )
    const row = result.rows[0]
    if (!row) return null
    return {
      id: row.id,
      workbookId: row.workbook_id,
      label: row.label,
      snapshot: row.snapshot,
      createdAt: row.created_at.toISOString(),
      createdBy: row.created_by,
    }
  }

  async deleteWorkbookVersion(versionId: string): Promise<boolean> {
    const result = await query('DELETE FROM workbook_versions WHERE id = $1', [versionId])
    return result.rowCount !== null && result.rowCount > 0
  }

  async deleteVersionsForWorkbook(workbookId: string): Promise<void> {
    await query('DELETE FROM workbook_versions WHERE workbook_id = $1', [workbookId])
  }

  async pruneOldVersions(workbookId: string, keepCount: number): Promise<void> {
    // ponytail: keep the most recent N versions; admin-labeled ones survive by being newer typically
    await query(
      `DELETE FROM workbook_versions
       WHERE workbook_id = $1
         AND id NOT IN (
           SELECT id FROM workbook_versions
           WHERE workbook_id = $1
           ORDER BY created_at DESC
           LIMIT $2
         )`,
      [workbookId, keepCount],
    )
  }

  async deleteWorkbookRow(userId: string, workbookId: string): Promise<void> {
    await query(
      `UPDATE workbooks SET deleted_at = NOW(), updated_at = NOW()
       WHERE user_id = $1 AND id = $2`,
      [userId, workbookId],
    )
  }

  async deleteSyncOperationsForWorkbook(userId: string, workbookId: string): Promise<void> {
    await query(
      'DELETE FROM sync_operations WHERE user_id = $1 AND workbook_id = $2',
      [userId, workbookId],
    )
  }
}

export const accountRepository = new PostgresAccountRepository()
