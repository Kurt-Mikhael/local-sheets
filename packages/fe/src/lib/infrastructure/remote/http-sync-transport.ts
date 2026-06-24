import type { ISyncTransport } from '@/lib/application/ports'
import type { SyncRequest, SyncResponse } from '@/lib/domain/workbook'

export class HttpSyncTransport implements ISyncTransport {
  async synchronize(request: SyncRequest): Promise<SyncResponse> {
    const response = await fetch('/api/sync', {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'X-Requested-With': 'offline-spreadsheet',
      },
      credentials: 'same-origin',
      cache: 'no-store',
      body: JSON.stringify(request),
    })

    if (response.status === 401) {
      throw new Error('LOGIN_REQUIRED')
    }
    if (!response.ok) {
      const message = await response.text().catch(() => '')
      throw new Error(message || `Sinkronisasi gagal (${response.status}).`)
    }

    return response.json() as Promise<SyncResponse>
  }
}
