import type { IWorkbookRepository } from '@/lib/application/ports'
import type {
  LocalWorkbook,
  OutboxRecord,
  RemoteWorkbook,
  SyncConflict,
  WorkbookSnapshot,
} from '@/lib/domain/workbook'
import { localDb } from '@/lib/client/db'

function makeOperationId(): string {
  if (typeof globalThis.crypto?.randomUUID === 'function') {
    return globalThis.crypto.randomUUID()
  }
  if (typeof globalThis.crypto?.getRandomValues === 'function') {
    const bytes = new Uint8Array(16)
    globalThis.crypto.getRandomValues(bytes)
    bytes[6] = (bytes[6] & 0x0f) | 0x40
    bytes[8] = (bytes[8] & 0x3f) | 0x80
    const hex = [...bytes].map((b) => b.toString(16).padStart(2, '0')).join('')
    return [
      hex.slice(0, 8),
      hex.slice(8, 12),
      hex.slice(12, 16),
      hex.slice(16, 20),
      hex.slice(20),
    ].join('-')
  }
  throw new Error('Web Crypto API tidak tersedia. Gunakan HTTPS atau localhost.')
}

export class DexieWorkbookRepository implements IWorkbookRepository {
  async list(): Promise<LocalWorkbook[]> {
    return localDb.workbooks.orderBy('updatedAt').reverse().toArray()
  }

  async get(id: string): Promise<LocalWorkbook | undefined> {
    return localDb.workbooks.get(id)
  }

  async create(workbook: LocalWorkbook): Promise<void> {
    await localDb.transaction('rw', localDb.workbooks, localDb.outbox, async () => {
      await localDb.workbooks.put({ ...workbook, syncState: 'pending' })
      await this.queueChange(workbook, false)
    })
  }

  async saveSnapshot(id: string, snapshot: WorkbookSnapshot): Promise<void> {
    await localDb.transaction('rw', localDb.workbooks, localDb.outbox, async () => {
      const current = await localDb.workbooks.get(id)
      if (!current) throw new Error('Workbook lokal tidak ditemukan.')

      const updated: LocalWorkbook = {
        ...current,
        snapshot,
        updatedAt: new Date().toISOString(),
        syncState: current.conflict ? 'conflict' : 'pending',
      }
      await localDb.workbooks.put(updated)
      await this.queueChange(updated, false)
    })
  }

  async rename(id: string, title: string): Promise<void> {
    const normalized = title.trim().slice(0, 120).replace(/[\x00-\x1F\x7F]/g, '')
    if (!normalized) return

    await localDb.transaction('rw', localDb.workbooks, localDb.outbox, async () => {
      const current = await localDb.workbooks.get(id)
      if (!current) return

      const updated: LocalWorkbook = {
        ...current,
        title: normalized,
        snapshot: { ...current.snapshot, name: normalized },
        updatedAt: new Date().toISOString(),
        syncState: current.conflict ? 'conflict' : 'pending',
      }
      await localDb.workbooks.put(updated)
      await this.queueChange(updated, false)
    })
  }

  async markDeleted(id: string): Promise<void> {
    await localDb.transaction('rw', localDb.workbooks, localDb.outbox, async () => {
      const current = await localDb.workbooks.get(id)
      if (!current) return

      const updated: LocalWorkbook = {
        ...current,
        updatedAt: new Date().toISOString(),
        syncState: 'deleted',
      }
      await localDb.workbooks.put(updated)
      await this.queueChange(updated, true)
    })
  }

  async getPendingChanges(limit: number): Promise<OutboxRecord[]> {
    return localDb.outbox.orderBy('updatedAt').limit(limit).toArray()
  }

  async applyAck(workbookId: string, operationId: string, serverVersion: number): Promise<void> {
    await localDb.transaction('rw', localDb.workbooks, localDb.outbox, async () => {
      const [workbook, pending] = await Promise.all([
        localDb.workbooks.get(workbookId),
        localDb.outbox.get(workbookId),
      ])
      if (!workbook) return

      const sameOperation = pending?.operationId === operationId
      if (sameOperation) await localDb.outbox.delete(workbookId)
      if (pending && !sameOperation) {
        await localDb.outbox.put({ ...pending, baseVersion: serverVersion })
      }

      await localDb.workbooks.put({
        ...workbook,
        serverVersion,
        lastSyncedAt: new Date().toISOString(),
        syncState: workbook.syncState === 'deleted'
          ? 'deleted'
          : sameOperation
            ? 'synced'
            : workbook.conflict
              ? 'conflict'
              : 'pending',
      })
    })
  }

  async applyConflict(conflict: SyncConflict): Promise<void> {
    await localDb.workbooks.update(conflict.workbookId, {
      syncState: 'conflict',
      conflict: {
        remoteTitle: conflict.remoteTitle,
        remoteSnapshot: conflict.remoteSnapshot,
        remoteVersion: conflict.remoteVersion,
        remoteDeleted: conflict.remoteDeleted,
        detectedAt: new Date().toISOString(),
      },
    })
  }

  async applyRemote(remote: RemoteWorkbook): Promise<'applied' | 'ignored' | 'conflict'> {
    return localDb.transaction('rw', localDb.workbooks, localDb.outbox, async () => {
      const [current, pending] = await Promise.all([
        localDb.workbooks.get(remote.id),
        localDb.outbox.get(remote.id),
      ])

      if (pending) {
        if (remote.version > pending.baseVersion) {
          if (current) {
            await localDb.workbooks.put({
              ...current,
              syncState: 'conflict',
              conflict: {
                remoteTitle: remote.title,
                remoteSnapshot: remote.snapshot,
                remoteVersion: remote.version,
                remoteDeleted: remote.deleted,
                detectedAt: new Date().toISOString(),
              },
            })
          }
          return 'conflict'
        }
        return 'ignored'
      }

      if (current && remote.version <= current.serverVersion) return 'ignored'

      await localDb.workbooks.put({
        id: remote.id,
        title: remote.title,
        snapshot: remote.snapshot,
        serverVersion: remote.version,
        createdAt: current?.createdAt ?? new Date().toISOString(),
        updatedAt: remote.updatedAt,
        lastSyncedAt: new Date().toISOString(),
        syncState: remote.deleted ? 'deleted' : 'synced',
      })
      return 'applied'
    })
  }

  async resolveConflictKeepLocal(workbookId: string): Promise<void> {
    await localDb.transaction('rw', localDb.workbooks, localDb.outbox, async () => {
      const workbook = await localDb.workbooks.get(workbookId)
      if (!workbook?.conflict) return

      const now = new Date().toISOString()
      const updated: LocalWorkbook = {
        ...workbook,
        serverVersion: workbook.conflict.remoteVersion,
        conflict: undefined,
        syncState: 'pending',
        updatedAt: now,
      }
      await localDb.workbooks.put(updated)
      await localDb.outbox.put({
        workbookId,
        operationId: makeOperationId(),
        baseVersion: workbook.conflict.remoteVersion,
        title: updated.title,
        snapshot: updated.snapshot,
        deleted: false,
        createdAt: now,
        updatedAt: now,
      })
    })
  }

  async resolveConflictUseRemote(workbookId: string): Promise<void> {
    await localDb.transaction('rw', localDb.workbooks, localDb.outbox, async () => {
      const workbook = await localDb.workbooks.get(workbookId)
      if (!workbook?.conflict) return

      const remote = workbook.conflict
      await localDb.outbox.delete(workbookId)
      await localDb.workbooks.put({
        ...workbook,
        title: remote.remoteTitle,
        snapshot: remote.remoteSnapshot,
        serverVersion: remote.remoteVersion,
        conflict: undefined,
        syncState: remote.remoteDeleted ? 'deleted' : 'synced',
        updatedAt: new Date().toISOString(),
        lastSyncedAt: new Date().toISOString(),
      })
    })
  }

  async getCursor(): Promise<string | undefined> {
    return (await localDb.meta.get('sync-cursor'))?.value || undefined
  }

  async setCursor(cursor?: string): Promise<void> {
    if (cursor) await localDb.meta.put({ key: 'sync-cursor', value: cursor })
  }

  async getClientId(): Promise<string> {
    const existing = await localDb.meta.get('client-id')
    if (existing) return existing.value
    const id = makeOperationId()
    await localDb.meta.put({ key: 'client-id', value: id })
    return id
  }

  async ensureAccountBinding(accountId: string): Promise<void> {
    await localDb.transaction('rw', localDb.meta, async () => {
      const existing = await localDb.meta.get('bound-account-id')
      if (!existing) {
        await localDb.meta.put({ key: 'bound-account-id', value: accountId })
        return
      }
      if (existing.value !== accountId) {
        throw new Error('LOCAL_ACCOUNT_MISMATCH')
      }
    })
  }

  private async queueChange(workbook: LocalWorkbook, deleted: boolean): Promise<void> {
    const existing = await localDb.outbox.get(workbook.id)
    const now = new Date().toISOString()
    await localDb.outbox.put({
      workbookId: workbook.id,
      operationId: makeOperationId(),
      baseVersion: workbook.serverVersion,
      title: workbook.title,
      snapshot: workbook.snapshot,
      deleted,
      createdAt: existing?.createdAt ?? now,
      updatedAt: now,
    })
  }
}
