import type { LocalWorkbook, OutboxRecord, RemoteWorkbook, SyncConflict, SyncRequest, SyncResponse, WorkbookSnapshot } from '@/lib/domain/workbook'

export interface IWorkbookRepository {
  list(): Promise<LocalWorkbook[]>
  get(id: string): Promise<LocalWorkbook | undefined>
  create(workbook: LocalWorkbook): Promise<void>
  saveSnapshot(id: string, snapshot: WorkbookSnapshot): Promise<void>
  rename(id: string, title: string): Promise<void>
  markDeleted(id: string): Promise<void>
  getPendingChanges(limit: number): Promise<OutboxRecord[]>
  applyAck(workbookId: string, operationId: string, serverVersion: number): Promise<void>
  applyConflict(conflict: SyncConflict): Promise<void>
  applyRemote(remote: RemoteWorkbook): Promise<'applied' | 'ignored' | 'conflict'>
  resolveConflictKeepLocal(workbookId: string): Promise<void>
  resolveConflictUseRemote(workbookId: string): Promise<void>
  getCursor(): Promise<string | undefined>
  setCursor(cursor?: string): Promise<void>
  getClientId(): Promise<string>
  ensureAccountBinding(accountId: string): Promise<void>
}

export interface ISyncTransport {
  synchronize(request: SyncRequest): Promise<SyncResponse>
}
