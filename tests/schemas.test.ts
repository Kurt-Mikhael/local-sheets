import { describe, it, expect } from 'vitest'
import { authSchema, syncRequestSchema } from '../packages/shared/src/schemas'

describe('authSchema', () => {
  it('menerima email dan password valid', () => {
    const result = authSchema.safeParse({ email: 'user@example.com', password: '1234567890' })
    expect(result.success).toBe(true)
  })

  it('menolak email invalid', () => {
    const result = authSchema.safeParse({ email: 'bukan-email', password: '1234567890' })
    expect(result.success).toBe(false)
  })

  it('menolak password kurang dari 10 karakter', () => {
    const result = authSchema.safeParse({ email: 'user@example.com', password: '123456' })
    expect(result.success).toBe(false)
  })

  it('menolak field tambahan (strict)', () => {
    const result = authSchema.safeParse({ email: 'user@example.com', password: '1234567890', extra: true })
    expect(result.success).toBe(false)
  })
})

describe('syncRequestSchema', () => {
  const validChange = {
    operationId: '550e8400-e29b-41d4-a716-446655440001',
    workbookId: '550e8400-e29b-41d4-a716-446655440002',
    baseVersion: 0,
    title: 'Test Workbook',
    snapshot: { key: 'value' },
    deleted: false,
    clientUpdatedAt: '2026-06-24T12:00:00.000Z',
  }

  it('menerima payload sync valid', () => {
    const result = syncRequestSchema.safeParse({
      clientId: '550e8400-e29b-41d4-a716-446655440000',
      changes: [validChange],
    })
    expect(result.success).toBe(true)
  })

  it('menerima empty changes', () => {
    const result = syncRequestSchema.safeParse({
      clientId: '550e8400-e29b-41d4-a716-446655440000',
      changes: [],
    })
    expect(result.success).toBe(true)
  })

  it('menolak clientId bukan UUID', () => {
    const result = syncRequestSchema.safeParse({
      clientId: 'bukan-uuid',
      changes: [],
    })
    expect(result.success).toBe(false)
  })

  it('menolak operationId bukan UUID', () => {
    const result = syncRequestSchema.safeParse({
      clientId: '550e8400-e29b-41d4-a716-446655440000',
      changes: [{ ...validChange, operationId: 'bukan-uuid' }],
    })
    expect(result.success).toBe(false)
  })

  it('menolak baseVersion negatif', () => {
    const result = syncRequestSchema.safeParse({
      clientId: '550e8400-e29b-41d4-a716-446655440000',
      changes: [{ ...validChange, baseVersion: -1 }],
    })
    expect(result.success).toBe(false)
  })

  it('menolak title dengan karakter kontrol', () => {
    const result = syncRequestSchema.safeParse({
      clientId: '550e8400-e29b-41d4-a716-446655440000',
      changes: [{ ...validChange, title: 'Halo\x00BOM' }],
    })
    expect(result.success).toBe(false)
  })

  it('menolak snapshot dengan key prototype-pollution', () => {
    const malicious = JSON.parse('{"__proto__":{"polluted":true},"constructor":{"prototype":{"polluted":true}}}')
    const result = syncRequestSchema.safeParse({
      clientId: '550e8400-e29b-41d4-a716-446655440000',
      changes: [{ ...validChange, snapshot: malicious }],
    })
    expect(result.success).toBe(false)
  })

  it('menolak snapshot > 1MB', () => {
    const big = 'x'.repeat(1_100_000)
    const result = syncRequestSchema.safeParse({
      clientId: '550e8400-e29b-41d4-a716-446655440000',
      changes: [{ ...validChange, snapshot: { big } }],
    })
    expect(result.success).toBe(false)
  })
})
