import type { IncomingMessage } from 'node:http'

export class HttpError extends Error {
  constructor(
    public readonly status: number,
    message: string,
  ) {
    super(message)
  }
}

export function assertSameOrigin(req: IncomingMessage): void {
  const origin = req.headers['origin']
  if (!origin) return

  const allowedOrigins = new Set([`http://localhost:3000`, `http://localhost:4000`])
  const configuredOrigin = process.env.APP_ORIGIN
  if (configuredOrigin) {
    try {
      allowedOrigins.add(new URL(configuredOrigin).origin)
    } catch {}
  }

  if (!allowedOrigins.has(origin)) throw new HttpError(403, 'Origin request ditolak.')
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
