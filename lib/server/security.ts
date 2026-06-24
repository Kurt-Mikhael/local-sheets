import type { NextRequest } from 'next/server'

export class HttpError extends Error {
  constructor(
    public readonly status: number,
    message: string,
  ) {
    super(message)
  }
}

export function assertSameOrigin(request: NextRequest): void {
  const origin = request.headers.get('origin')
  if (!origin) return

  const allowedOrigins = new Set([request.nextUrl.origin])
  const configuredOrigin = process.env.APP_ORIGIN
  if (configuredOrigin) allowedOrigins.add(new URL(configuredOrigin).origin)

  if (!allowedOrigins.has(origin)) throw new HttpError(403, 'Origin request ditolak.')
}

export function assertMutationRequest(request: NextRequest): void {
  assertSameOrigin(request)

  const fetchSite = request.headers.get('sec-fetch-site')
  if (fetchSite && fetchSite !== 'same-origin' && fetchSite !== 'none') {
    throw new HttpError(403, 'Sumber request ditolak.')
  }

  if (request.headers.get('x-requested-with') !== 'offline-spreadsheet') {
    throw new HttpError(403, 'Header anti-CSRF tidak valid.')
  }
}

export async function readJsonWithLimit(request: NextRequest, maxBytes: number): Promise<unknown> {
  const contentType = request.headers.get('content-type') ?? ''
  if (!contentType.toLowerCase().startsWith('application/json')) {
    throw new HttpError(415, 'Content-Type harus application/json.')
  }

  const declaredLength = Number(request.headers.get('content-length') ?? 0)
  if (declaredLength > maxBytes) throw new HttpError(413, 'Payload terlalu besar.')
  if (!request.body) throw new HttpError(400, 'Body request kosong.')

  const reader = request.body.getReader()
  const chunks: Uint8Array[] = []
  let totalBytes = 0

  try {
    while (true) {
      const { done, value } = await reader.read()
      if (done) break
      totalBytes += value.byteLength
      if (totalBytes > maxBytes) {
        await reader.cancel()
        throw new HttpError(413, 'Payload terlalu besar.')
      }
      chunks.push(value)
    }
  } finally {
    reader.releaseLock()
  }

  const text = Buffer.concat(chunks.map((chunk) => Buffer.from(chunk))).toString('utf8')
  try {
    return JSON.parse(text)
  } catch {
    throw new HttpError(400, 'JSON tidak valid.')
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
