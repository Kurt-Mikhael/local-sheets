import type {
  LocalWorkbook,
  WorkbookSnapshot,
  SyncState,
  WorkbookConflict,
  OutboxRecord,
  SyncChange,
  SyncAck,
  SyncConflict,
  RemoteWorkbook,
  SyncRequest,
  SyncResponse,
} from 'shared/src/workbook'

export type {
  WorkbookSnapshot,
  SyncState,
  WorkbookConflict,
  LocalWorkbook,
  OutboxRecord,
  SyncChange,
  SyncAck,
  SyncConflict,
  RemoteWorkbook,
  SyncRequest,
  SyncResponse,
}

export const UNIVER_APP_VERSION = '0.25.0'

function newSheet(id: string, name: string): Record<string, unknown> {
  return {
    id,
    name,
    tabColor: '',
    hidden: 0,
    rowCount: 1000,
    columnCount: 26,
    zoomRatio: 1,
    freeze: { xSplit: 0, ySplit: 0, startRow: -1, startColumn: -1 },
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
  }
}

export function createEmptyWorkbook(title = 'Workbook Baru'): LocalWorkbook {
  return createEmptyWorkbookWithId(crypto.randomUUID(), title)
}

export function createEmptyWorkbookWithId(id: string, title = 'Workbook Baru'): LocalWorkbook {
  const sheetId = crypto.randomUUID()
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
      appVersion: UNIVER_APP_VERSION,
      locale: 'enUS',
      sheetOrder: [sheetId],
      styles: {},
      resources: [],
      sheets: { [sheetId]: newSheet(sheetId, 'Sheet1') },
    },
  }
}
