import type { PoolClient } from 'pg'
import type {
  RemoteWorkbook,
  SyncAck,
  SyncChange,
  SyncConflict,
} from '@/lib/domain/workbook'
import { query, withTransaction } from '@/lib/server/postgres'

interface OperationRow {
  workbook_id: string
  version: number
}

interface WorkbookRow {
  id: string
  title: string
  snapshot: Record<string, unknown>
  version: number
  updated_at: Date
  deleted_at: Date | null
}

export interface SyncBatchResult {
  acked: SyncAck[]
  conflicts: SyncConflict[]
}

export interface RemotePage {
  rows: RemoteWorkbook[]
  hasMore: boolean
}

function isSerializationFailure(error: unknown): boolean {
  return typeof error === 'object' && error !== null && 'code' in error
    && String((error as { code?: unknown }).code) === '40001'
}

export class PostgresSyncRepository {
  async processChanges(userId: string, changes: SyncChange[]): Promise<SyncBatchResult> {
    for (let attempt = 0; attempt < 3; attempt += 1) {
      try {
        return await withTransaction(
          (client) => this.processChangesInTransaction(client, userId, changes),
          'SERIALIZABLE',
        )
      } catch (error) {
        if (!isSerializationFailure(error) || attempt === 2) throw error
      }
    }
    throw new Error('Transaksi sinkronisasi gagal.')
  }

  async listRemote(
    userId: string,
    cursor: { updatedAt: string; id: string } | undefined,
    limit: number,
  ): Promise<RemotePage> {
    const values: unknown[] = [userId, limit + 1]
    const cursorClause = cursor
      ? 'AND (updated_at > $3::timestamptz OR (updated_at = $3::timestamptz AND id > $4::uuid))'
      : ''
    if (cursor) values.push(cursor.updatedAt, cursor.id)

    const result = await query<WorkbookRow>(
      `SELECT id, title, snapshot, version, updated_at, deleted_at
       FROM workbooks
       WHERE user_id = $1
       ${cursorClause}
       ORDER BY updated_at ASC, id ASC
       LIMIT $2`,
      values,
    )

    const hasMore = result.rows.length > limit
    const rows = (hasMore ? result.rows.slice(0, limit) : result.rows).map((row) => ({
      id: row.id,
      title: row.title,
      snapshot: row.snapshot,
      version: row.version,
      updatedAt: row.updated_at.toISOString(),
      deleted: Boolean(row.deleted_at),
    }))

    return { rows, hasMore }
  }

  private async processChangesInTransaction(
    client: PoolClient,
    userId: string,
    changes: SyncChange[],
  ): Promise<SyncBatchResult> {
    const acked: SyncAck[] = []
    const conflicts: SyncConflict[] = []

    for (const change of changes) {
      const duplicateResult = await client.query<OperationRow>(
        `SELECT workbook_id, version
         FROM sync_operations
         WHERE user_id = $1 AND operation_id = $2
         LIMIT 1`,
        [userId, change.operationId],
      )
      const duplicate = duplicateResult.rows[0]
      if (duplicate) {
        acked.push({
          operationId: change.operationId,
          workbookId: duplicate.workbook_id,
          version: duplicate.version,
        })
        continue
      }

      const currentResult = await client.query<WorkbookRow>(
        `SELECT id, title, snapshot, version, updated_at, deleted_at
         FROM workbooks
         WHERE user_id = $1 AND id = $2
         FOR UPDATE`,
        [userId, change.workbookId],
      )
      const current = currentResult.rows[0]

      if (!current) {
        if (change.baseVersion !== 0) {
          conflicts.push({
            operationId: change.operationId,
            workbookId: change.workbookId,
            remoteTitle: change.title,
            remoteSnapshot: {},
            remoteVersion: 0,
            remoteDeleted: true,
          })
          continue
        }

        const version = change.deleted ? 0 : 1
        if (!change.deleted) {
          await client.query(
            `INSERT INTO workbooks (user_id, id, title, snapshot, version)
             VALUES ($1, $2, $3, $4::jsonb, $5)`,
            [userId, change.workbookId, change.title, JSON.stringify(change.snapshot), version],
          )
        }
        await this.insertOperation(client, userId, change, version)
        acked.push({ operationId: change.operationId, workbookId: change.workbookId, version })
        continue
      }

      if (current.version !== change.baseVersion) {
        conflicts.push({
          operationId: change.operationId,
          workbookId: change.workbookId,
          remoteTitle: current.title,
          remoteSnapshot: current.snapshot,
          remoteVersion: current.version,
          remoteDeleted: Boolean(current.deleted_at),
        })
        continue
      }

      const updated = await client.query<{ version: number }>(
        `UPDATE workbooks
         SET title = $3,
             snapshot = $4::jsonb,
             deleted_at = CASE WHEN $5::boolean THEN NOW() ELSE NULL END,
             version = version + 1,
             updated_at = NOW()
         WHERE user_id = $1 AND id = $2 AND version = $6
         RETURNING version`,
        [
          userId,
          change.workbookId,
          change.title,
          JSON.stringify(change.deleted ? {} : change.snapshot),
          change.deleted,
          change.baseVersion,
        ],
      )

      if (!updated.rows[0]) {
        const latest = await client.query<WorkbookRow>(
          `SELECT id, title, snapshot, version, updated_at, deleted_at
           FROM workbooks
           WHERE user_id = $1 AND id = $2`,
          [userId, change.workbookId],
        )
        const row = latest.rows[0]
        conflicts.push({
          operationId: change.operationId,
          workbookId: change.workbookId,
          remoteTitle: row?.title ?? change.title,
          remoteSnapshot: row?.snapshot ?? {},
          remoteVersion: row?.version ?? 0,
          remoteDeleted: !row || Boolean(row.deleted_at),
        })
        continue
      }

      const version = updated.rows[0].version
      await this.insertOperation(client, userId, change, version)
      acked.push({ operationId: change.operationId, workbookId: change.workbookId, version })
    }

    return { acked, conflicts }
  }

  private async insertOperation(
    client: PoolClient,
    userId: string,
    change: SyncChange,
    version: number,
  ): Promise<void> {
    await client.query(
      `INSERT INTO sync_operations (user_id, operation_id, workbook_id, version)
       VALUES ($1, $2, $3, $4)`,
      [userId, change.operationId, change.workbookId, version],
    )
  }
}

export const syncRepository = new PostgresSyncRepository()
