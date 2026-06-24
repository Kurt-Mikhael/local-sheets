import {makeId} from '@/lib/shared/make-id'

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



export function createEmptyWorkbook(title = 'Workbook Baru'): LocalWorkbook {
  const id = makeId()
  const sheetId = makeId()
  const now = new Date().toISOString()

  return {
    id,
    title,
    serverVersion: 0,
    updatedAt: now,
    createdAt: now,
    syncState: 'pending',
    conflict: undefined,
    snapshot: {
      id,
      name: title,
      appVersion: '0.25.0',
      locale: 'enUS',
      sheetOrder: [sheetId],
      styles: {},
      resources: [],
      sheets: {
        [sheetId]: {
          id: sheetId,
          name: 'Sheet1',
          tabColor: '',
          hidden: 0,
          rowCount: 1000,
          columnCount: 26,
          zoomRatio: 1,
          freeze: {
            xSplit: 0,
            ySplit: 0,
            startRow: -1,
            startColumn: -1,
          },
          scrollTop: 0,
          scrollLeft: 0,
          defaultRowHeight: 24,
          defaultColumnWidth: 88,
          mergeData: [],
          rowData: {},
          columnData: {},
          rowHeader: { width: 46, hidden: 0 },
          columnHeader: { height: 20, hidden: 0 },
          showGridlines: 1,
          rightToLeft: 0,
          cellData: {
            0: {
              0: { v: 'Offline Spreadsheet' },
              1: { v: 'Data tersimpan di perangkat sebelum disinkronkan.' },
            },
            2: {
              0: { v: 10 },
              1: { v: 20 },
              2: { f: '=SUM(A3:B3)' },
            },
          },
        },
      },
    },
  }
}
