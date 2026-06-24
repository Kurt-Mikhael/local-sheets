import { createHmac, timingSafeEqual } from 'node:crypto'
import { HttpError } from './security'

export interface SyncCursor {
  updatedAt: string
  id: string
}

function signingSecret(): string {
  const secret = process.env.CURSOR_SIGNING_SECRET
  if (secret) return secret
  if (process.env.NODE_ENV === 'production') {
    throw new Error('CURSOR_SIGNING_SECRET wajib dikonfigurasi di production.')
  }
  return 'development-only-change-this-cursor-secret'
}

function signature(payload: string, userId: string): Buffer {
  return createHmac('sha256', signingSecret()).update(`${userId}.${payload}`).digest()
}

export function encodeCursor(cursor: SyncCursor, userId: string): string {
  const payload = Buffer.from(JSON.stringify(cursor), 'utf8').toString('base64url')
  return `${payload}.${signature(payload, userId).toString('base64url')}`
}

export function decodeCursor(value: string | undefined, userId: string): SyncCursor | undefined {
  if (!value) return undefined
  try {
    const [payload, suppliedSignature, extra] = value.split('.')
    if (!payload || !suppliedSignature || extra) throw new Error('invalid')

    const supplied = Buffer.from(suppliedSignature, 'base64url')
    const expected = signature(payload, userId)
    if (supplied.length !== expected.length || !timingSafeEqual(supplied, expected)) {
      throw new Error('invalid')
    }

    const parsed = JSON.parse(Buffer.from(payload, 'base64url').toString('utf8')) as Partial<SyncCursor>
    const uuid = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i
    if (!parsed.updatedAt || !parsed.id || !uuid.test(parsed.id) || Number.isNaN(Date.parse(parsed.updatedAt))) {
      throw new Error('invalid')
    }
    return { updatedAt: parsed.updatedAt, id: parsed.id }
  } catch {
    throw new HttpError(400, 'Cursor sinkronisasi tidak valid.')
  }
}
