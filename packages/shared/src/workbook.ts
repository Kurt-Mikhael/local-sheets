export type WorkbookSnapshot = Record<string, unknown>

export type SyncState = 'local' | 'pending' | 'synced' | 'conflict' | 'deleted'

export interface WorkbookConflict {
  remoteTitle: string
  remoteSnapshot: WorkbookSnapshot
  remoteVersion: number
  remoteDeleted: boolean
  detectedAt: string
}

export interface LocalWorkbook {
  id: string
  title: string
  snapshot: WorkbookSnapshot
  serverVersion: number
  createdAt: string
  updatedAt: string
  lastSyncedAt?: string
  syncState: SyncState
  conflict?: WorkbookConflict
}

export interface OutboxRecord {
  workbookId: string
  operationId: string
  baseVersion: number
  title: string
  snapshot: WorkbookSnapshot
  deleted: boolean
  createdAt: string
  updatedAt: string
}

export interface SyncChange {
  operationId: string
  workbookId: string
  baseVersion: number
  title: string
  snapshot: WorkbookSnapshot
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
  remoteSnapshot: WorkbookSnapshot
  remoteVersion: number
  remoteDeleted: boolean
}

export interface RemoteWorkbook {
  id: string
  title: string
  snapshot: WorkbookSnapshot
  version: number
  updatedAt: string
  deleted: boolean
}

export interface SyncRequest {
  clientId: string
  cursor?: string
  changes: SyncChange[]
}

export interface SyncResponse {
  acked: SyncAck[]
  conflicts: SyncConflict[]
  remote: RemoteWorkbook[]
  cursor?: string
  hasMore: boolean
}
