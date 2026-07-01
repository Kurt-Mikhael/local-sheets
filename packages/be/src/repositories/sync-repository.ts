import type { PoolClient } from 'pg'
import { query, withTransaction } from '../lib/postgres.js'
import { HttpError } from '../lib/security.js'
import type { SyncCursor } from '../lib/cursor.js'

interface SyncChangeInput {
  operationId: string
  workbookId: string
  baseVersion: number
  title: string
  snapshot: unknown
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

interface WorkbookVersionRow {
  version: number
  title: string
  snapshot: Record<string, unknown>
  deleted: boolean
}

export class PostgresSyncRepository {
  async processChanges(
    userId: string,
    changes: SyncChangeInput[],
    userRole: 'user' | 'admin' = 'user',
  ): Promise<{ acked: SyncAck[]; conflicts: SyncConflict[] }> {
    return withTransaction(async (client) => {
      await client.query('SET TRANSACTION ISOLATION LEVEL SERIALIZABLE')

      const acked: SyncAck[] = []
      const conflicts: SyncConflict[] = []

      for (const change of changes) {
        const dup = await client.query<{ version: number }>(
          `SELECT version FROM sync_operations
           WHERE user_id = $1 AND operation_id = $2`,
          [userId, change.operationId],
        )
        if ((dup.rowCount ?? 0) > 0) {
          const ackRow = await client.query<{ workbook_id: string; version: number }>(
            `SELECT workbook_id, version FROM sync_operations
             WHERE user_id = $1 AND operation_id = $2`,
            [userId, change.operationId],
          )
          const row = ackRow.rows[0]
          if (row) {
            acked.push({
              operationId: change.operationId,
              workbookId: row.workbook_id,
              version: row.version,
            })
          }
          continue
        }

        let workbookOwnerId = userId
        if (userRole === 'user') {
          const owner = await client.query<{ user_id: string }>(
            'SELECT user_id FROM workbook_snapshots WHERE workbook_id = $1 LIMIT 1',
            [change.workbookId],
          )
          if (owner.rowCount === 0) {
            throw new HttpError(404, 'Workbook tidak ditemukan.')
          }
          workbookOwnerId = owner.rows[0].user_id
          const access = await client.query(
            'SELECT 1 FROM workbook_access WHERE user_id = $1 AND workbook_id = $2 LIMIT 1',
            [userId, change.workbookId],
          )
          if ((access.rowCount ?? 0) === 0) {
            throw new HttpError(403, 'Anda tidak memiliki akses ke workbook ini.')
          }
        }

        const existing = await client.query<WorkbookVersionRow>(
          `SELECT version, title, snapshot, deleted_at IS NOT NULL AS deleted
           FROM workbooks
           WHERE user_id = $1 AND id = $2
           FOR UPDATE`,
          [workbookOwnerId, change.workbookId],
        )

        const current = existing.rows[0]

        if (!current && userRole !== 'admin') {
          throw new HttpError(403, 'Hanya admin yang dapat membuat workbook baru.')
        }

        if (current && change.baseVersion < current.version) {
          conflicts.push({
            operationId: change.operationId,
            workbookId: change.workbookId,
            remoteTitle: current.title,
            remoteSnapshot: current.snapshot,
            remoteVersion: current.version,
            remoteDeleted: current.deleted,
          })
          continue
        }

        const newVersion = (current?.version ?? 0) + 1

        console.log('[sync] upsert', { workbookId: change.workbookId, owner: workbookOwnerId, newVersion, snapshotKeys: Object.keys((change.snapshot as Record<string, unknown>) ?? {}) })

        if (change.deleted) {
          await client.query(
            `INSERT INTO workbooks (user_id, id, title, snapshot, version, deleted_at, updated_at)
             VALUES ($1, $2, $3, $4::jsonb, $5, NOW(), $6)
             ON CONFLICT (user_id, id) DO UPDATE SET
               deleted_at = NOW(),
               version = EXCLUDED.version,
               updated_at = $6`,
            [workbookOwnerId, change.workbookId, change.title, JSON.stringify(change.snapshot), newVersion, change.clientUpdatedAt],
          )
        } else {
          await client.query(
            `INSERT INTO workbooks (user_id, id, title, snapshot, version, updated_at)
             VALUES ($1, $2, $3, $4::jsonb, $5, $6)
             ON CONFLICT (user_id, id) DO UPDATE SET
               title = EXCLUDED.title,
               snapshot = EXCLUDED.snapshot,
               version = EXCLUDED.version,
               deleted_at = NULL,
               updated_at = $6`,
            [workbookOwnerId, change.workbookId, change.title, JSON.stringify(change.snapshot), newVersion, change.clientUpdatedAt],
          )
          await client.query(
            `INSERT INTO workbook_snapshots (user_id, workbook_id, doc, version, title, updated_at)
             VALUES ($1, $2, '', 1, $3, NOW())
             ON CONFLICT (user_id, workbook_id) DO UPDATE SET title = EXCLUDED.title, updated_at = NOW()`,
            [workbookOwnerId, change.workbookId, change.title],
          )
        }

        await client.query(
          `INSERT INTO sync_operations (user_id, operation_id, workbook_id, version)
           VALUES ($1, $2, $3, $4)`,
          [workbookOwnerId, change.operationId, change.workbookId, newVersion],
        )

        acked.push({
          operationId: change.operationId,
          workbookId: change.workbookId,
          version: newVersion,
        })
      }

      return { acked, conflicts }
    })
  }

  async listRemote(
    userId: string,
    cursor: SyncCursor | undefined,
    limit: number,
  ): Promise<{ rows: SyncRemoteRow[]; hasMore: boolean }> {
    const cursorDate = cursor?.updatedAt ?? '1970-01-01T00:00:00.000Z'
    const cursorId = cursor?.id ?? '00000000-0000-0000-0000-000000000000'

    const result = await query<SyncRemoteRow>(
      `SELECT id, title, snapshot, version, updated_at::text AS "updatedAt",
              deleted_at IS NOT NULL AS deleted
       FROM workbooks
       WHERE user_id = $1
         AND (updated_at, id) > ($2::timestamptz, $3::uuid)
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

export type { PoolClient }
