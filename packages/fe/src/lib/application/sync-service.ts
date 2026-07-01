import type { SyncChange } from 'shared/src/workbook'
import type { DexieWorkbookRepository } from '../infrastructure/local/dexie-workbook-repository'
import type { HttpSyncTransport } from '../infrastructure/remote/http-sync-transport'

export interface SyncRunResult {
  acked: number
  conflicts: number
  remoteApplied: string[]
  remoteConflicts: string[]
}

export class SyncService {
  private running?: Promise<SyncRunResult>
  private runningAccountId?: string

  constructor(
    private readonly repository: DexieWorkbookRepository,
    private readonly transport: HttpSyncTransport,
  ) {}

  run(accountId: string, accountRole: 'user' | 'admin' = 'user'): Promise<SyncRunResult> {
    if (this.running) {
      if (this.runningAccountId !== accountId) {
        return Promise.reject(new Error('LOCAL_ACCOUNT_MISMATCH'))
      }
      return this.running
    }
    this.runningAccountId = accountId
    this.running = this.execute(accountId).finally(() => {
      this.running = undefined
      this.runningAccountId = undefined
    })
    return this.running
  }

  private async execute(accountId: string): Promise<SyncRunResult> {
    await this.repository.ensureAccountBinding(accountId)

    const aggregate: SyncRunResult = { acked: 0, conflicts: 0, remoteApplied: [], remoteConflicts: [] }
    let hasMore = true
    let page = 0
    let pushEnabled = true

    while (hasMore && page < 20) {
      page += 1
      const pending = pushEnabled ? await this.repository.getPendingChanges(25) : []
      const cursor = await this.repository.getCursor()
      const clientId = await this.repository.getClientId()

      const changes: SyncChange[] = pending.map((item) => ({
        operationId: item.operationId,
        workbookId: item.workbookId,
        baseVersion: Number(item.baseVersion),
        title: item.title,
        snapshot: item.snapshot,
        deleted: Boolean(item.deleted),
        clientUpdatedAt: item.updatedAt,
      }))

      const response = await this.transport.synchronize({ clientId, cursor, changes })

      for (const ack of response.acked) {
        await this.repository.applyAck(ack.workbookId, ack.operationId, ack.version)
        aggregate.acked += 1
      }

      if (response.conflicts.length > 0) pushEnabled = false

      for (const conflict of response.conflicts) {
        await this.repository.applyConflict(conflict)
        aggregate.conflicts += 1
      }

      for (const remote of response.remote) {
        const result = await this.repository.applyRemote(remote)
        if (result === 'applied') aggregate.remoteApplied.push(remote.id)
        if (result === 'conflict') {
          aggregate.remoteConflicts.push(remote.id)
          pushEnabled = false
        }
      }

      await this.repository.setCursor(response.cursor)
      const hasAnotherPushBatch = pushEnabled && pending.length === 25
      hasMore = response.hasMore || hasAnotherPushBatch
    }

    return aggregate
  }
}
