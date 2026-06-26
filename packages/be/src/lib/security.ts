import type { IncomingMessage } from 'node:http'

export class HttpError extends Error {
  constructor(
    public readonly status: number,
    message: string,
  ) {
    super(message)
  }
}

function allowedOrigins(): Set<string> {
  const set = new Set<string>([`http://localhost:3000`, `http://localhost:4000`])
  const configuredOrigin = process.env.APP_ORIGIN
  if (configuredOrigin) {
    try {
      set.add(new URL(configuredOrigin).origin)
    } catch {}
  }
  const extra = process.env.APP_ORIGIN_EXTRA
  if (extra) {
    for (const o of extra.split(',')) {
      try {
        set.add(new URL(o.trim()).origin)
      } catch {}
    }
  }
  return set
}

export function assertSameOrigin(req: IncomingMessage): void {
  const origin = req.headers['origin']
  const referer = req.headers['referer']

  if (!origin) {
    if (referer) {
      try {
        const refOrigin = new URL(referer).origin
        if (!allowedOrigins().has(refOrigin)) {
          throw new HttpError(403, 'Referer request ditolak.')
        }
      } catch {
        throw new HttpError(403, 'Referer request tidak valid.')
      }
    } else {
      throw new HttpError(403, 'Origin atau Referer wajib ada.')
    }
    return
  }

  if (!allowedOrigins().has(origin)) {
    throw new HttpError(403, 'Origin request ditolak.')
  }
}

export function assertMutationRequest(req: IncomingMessage): void {
  assertSameOrigin(req)

  const fetchSite = (req.headers['sec-fetch-site'] as string | undefined)
  if (fetchSite && fetchSite !== 'same-origin' && fetchSite !== 'same-site' && fetchSite !== 'none') {
    throw new HttpError(403, 'Sumber request ditolak.')
  }

  if (req.headers['x-requested-with'] !== 'offline-spreadsheet') {
    throw new HttpError(403, 'Header anti-CSRF tidak valid.')
  }
}

export function safeErrorResponse(error: unknown): { status: number; body: { error: string } } {
  if (error instanceof HttpError) {
    return { status: error.status, body: { error: error.message } }
  }
  if (typeof error === 'object' && error && 'code' in error) {
    const code = String((error as { code?: unknown }).code ?? '')
    if (code === '23505') return { status: 409, body: { error: 'Data yang sama sudah tersedia.' } }
    if (code === '40001') return { status: 409, body: { error: 'Terjadi konflik transaksi. Ulangi request.' } }
    if (code === '22P02') return { status: 400, body: { error: 'Format data database tidak valid.' } }
  }
  console.error(error)
  return { status: 500, body: { error: 'Terjadi kesalahan internal.' } }
}
