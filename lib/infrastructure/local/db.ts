import Dexie, { type EntityTable } from 'dexie'
import type { LocalWorkbook, OutboxRecord } from '@/lib/domain/workbook'

export interface MetaRecord {
  key: string
  value: string
}

class OfflineSpreadsheetDB extends Dexie {
  workbooks!: EntityTable<LocalWorkbook, 'id'>
  outbox!: EntityTable<OutboxRecord, 'workbookId'>
  meta!: EntityTable<MetaRecord, 'key'>

  constructor() {
    super('offline-spreadsheet-db')
    this.version(1).stores({
      workbooks: 'id, updatedAt, syncState',
      outbox: 'workbookId, updatedAt, operationId',
      meta: 'key',
    })
  }
}

export const localDb = new OfflineSpreadsheetDB()
