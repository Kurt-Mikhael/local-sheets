import { SyncService } from '../application/sync-service'
import { DexieWorkbookRepository } from '../infrastructure/local/dexie-workbook-repository'
import { HttpSyncTransport } from '../infrastructure/remote/http-sync-transport'

export const workbookRepository = new DexieWorkbookRepository()
export const syncService = new SyncService(workbookRepository, new HttpSyncTransport())
