import { query } from '../lib/postgres'
import type { SyncCursor } from '../lib/cursor'

interface SyncChangeInput {
  operationId: string
  workbookId: string
  baseVersion: number
  title: string
  snapshot: Record<string, unknown>
  deleted: boolean
  clientUpdatedAt: string
}

export interface SyncAck {
  operationId: string
  workbookId: string
  version: number
}

export interface SyncConflict {
  operationId: string
  workbookId: string
  remoteTitle: string
  remoteSnapshot: Record<string, unknown>
  remoteVersion: number
  remoteDeleted: boolean
}

export interface SyncRemoteRow {
  id: string
  title: string
  snapshot: Record<string, unknown>
  version: number
  updatedAt: string
  deleted: boolean
}

export class PostgresSyncRepository {
  async processChanges(
    userId: string,
    changes: SyncChangeInput[],
  ): Promise<{ acked: SyncAck[]; conflicts: SyncConflict[] }> {
    const acked: SyncAck[] = []
    const conflicts: SyncConflict[] = []

    for (const change of changes) {
      const existing = await query<{ version: number }>(
        `SELECT version FROM workbooks
         WHERE user_id = $1 AND id = $2`,
        [userId, change.workbookId],
      )

      const currentVersion = existing.rows[0]?.version ?? 0

      if (change.baseVersion < currentVersion) {
        const remote = await query<{ title: string; snapshot: Record<string, unknown>; version: number; deleted: boolean }>(
          `SELECT title, snapshot, version, deleted_at IS NOT NULL AS deleted
           FROM workbooks
           WHERE user_id = $1 AND id = $2`,
          [userId, change.workbookId],
        )

        if (remote.rows[0]) {
          conflicts.push({
            operationId: change.operationId,
            workbookId: change.workbookId,
            remoteTitle: remote.rows[0].title,
            remoteSnapshot: remote.rows[0].snapshot,
            remoteVersion: remote.rows[0].version,
            remoteDeleted: remote.rows[0].deleted,
          })
        }
        continue
      }

      const newVersion = currentVersion + 1

      if (change.deleted) {
        await query(
          `INSERT INTO workbooks (user_id, id, title, snapshot, version, deleted_at, updated_at)
           VALUES ($1, $2, $3, $4::jsonb, $5, NOW(), $6)
           ON CONFLICT (user_id, id) DO UPDATE SET
             deleted_at = NOW(),
             version = EXCLUDED.version,
             updated_at = $6`,
          [userId, change.workbookId, change.title, JSON.stringify(change.snapshot), newVersion, change.clientUpdatedAt],
        )
      } else {
        await query(
          `INSERT INTO workbooks (user_id, id, title, snapshot, version, updated_at)
           VALUES ($1, $2, $3, $4::jsonb, $5, $6)
           ON CONFLICT (user_id, id) DO UPDATE SET
             title = EXCLUDED.title,
             snapshot = EXCLUDED.snapshot,
             version = EXCLUDED.version,
             deleted_at = NULL,
             updated_at = $6`,
          [userId, change.workbookId, change.title, JSON.stringify(change.snapshot), newVersion, change.clientUpdatedAt],
        )
      }

      await query(
        `INSERT INTO sync_operations (user_id, operation_id, workbook_id, version)
         VALUES ($1, $2, $3, $4)`,
        [userId, change.operationId, change.workbookId, newVersion],
      )

      acked.push({
        operationId: change.operationId,
        workbookId: change.workbookId,
        version: newVersion,
      })
    }

    return { acked, conflicts }
  }

  async listRemote(
    userId: string,
    cursor: SyncCursor | undefined,
    limit: number,
  ): Promise<{ rows: SyncRemoteRow[]; hasMore: boolean }> {
    const cursorDate = cursor?.updatedAt ?? new Date(0).toISOString()
    const cursorId = cursor?.id ?? '00000000-0000-0000-0000-000000000000'

    const result = await query<SyncRemoteRow>(
      `SELECT id, title, snapshot, version, updated_at::text AS "updatedAt",
              deleted_at IS NOT NULL AS deleted
       FROM workbooks
       WHERE user_id = $1
         AND (updated_at, id) > ($2, $3)
       ORDER BY updated_at, id
       LIMIT $4`,
      [userId, cursorDate, cursorId, limit + 1],
    )

    const rows = result.rows.slice(0, limit)
    const hasMore = result.rows.length > limit
    return { rows, hasMore }
  }
}

export const syncRepository = new PostgresSyncRepository()
