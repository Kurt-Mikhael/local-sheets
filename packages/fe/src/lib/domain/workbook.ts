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

function makeId(): string {
  const webCrypto = globalThis.crypto

  if (webCrypto && typeof webCrypto.randomUUID === 'function') {
    return webCrypto.randomUUID()
  }

  if (webCrypto && typeof webCrypto.getRandomValues === 'function') {
    const bytes = new Uint8Array(16)
    webCrypto.getRandomValues(bytes)

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

  return `id-${Date.now()}-${Math.random().toString(16).slice(2)}`
}

export function createEmptyWorkbook(title = 'Workbook Baru'): LocalWorkbook {
  return createEmptyWorkbookWithId(makeId(), title)
}

export function createEmptyWorkbookWithId(id: string, title = 'Workbook Baru'): LocalWorkbook {
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
