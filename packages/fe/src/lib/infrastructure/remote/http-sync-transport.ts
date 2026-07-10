import type { SyncRequest, SyncResponse } from 'shared/src/workbook'

export class HttpSyncTransport {
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
      const raw = await response.text().catch(() => '')
      let message = raw
      try {
        const parsed = JSON.parse(raw) as { error?: string }
        if (parsed?.error) message = parsed.error
      } catch {}
      const err = new Error(message || `Sinkronisasi gagal (${response.status}).`)
      ;(err as Error & { status?: number }).status = response.status
      throw err
    }

    return response.json() as Promise<SyncResponse>
  }
}
