import { SyncService } from '@/lib/application/sync-service'
import { DexieWorkbookRepository } from '@/lib/infrastructure/local/dexie-workbook-repository'
import { HttpSyncTransport } from '@/lib/infrastructure/remote/http-sync-transport'

export const workbookRepository = new DexieWorkbookRepository()
export const syncService = new SyncService(workbookRepository, new HttpSyncTransport())
