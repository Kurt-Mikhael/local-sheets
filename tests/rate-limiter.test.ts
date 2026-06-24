import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest'
import { InMemoryRateLimiter } from '../packages/be/src/lib/rate-limit'

describe('InMemoryRateLimiter', () => {
  beforeEach(() => {
    vi.useFakeTimers()
  })

  afterEach(() => {
    vi.useRealTimers()
  })

  it('mengizinkan request pertama', () => {
    const limiter = new InMemoryRateLimiter(3, 60_000)
    const result = limiter.consume('test-key')
    expect(result.allowed).toBe(true)
    expect(result.retryAfterSeconds).toBe(0)
  })

  it('memblokir setelah melebihi limit', () => {
    const limiter = new InMemoryRateLimiter(2, 60_000)

    expect(limiter.consume('test-key').allowed).toBe(true)
    expect(limiter.consume('test-key').allowed).toBe(true)
    const blocked = limiter.consume('test-key')
    expect(blocked.allowed).toBe(false)
    expect(blocked.retryAfterSeconds).toBeGreaterThan(0)
  })

  it('mereset setelah windowMs berlalu', () => {
    const limiter = new InMemoryRateLimiter(1, 60_000)

    expect(limiter.consume('test-key').allowed).toBe(true)
    expect(limiter.consume('test-key').allowed).toBe(false)

    vi.advanceTimersByTime(60_001)

    expect(limiter.consume('test-key').allowed).toBe(true)
  })

  it('key yang berbeda punya bucket terpisah', () => {
    const limiter = new InMemoryRateLimiter(1, 60_000)

    expect(limiter.consume('key-a').allowed).toBe(true)
    expect(limiter.consume('key-a').allowed).toBe(false)
    expect(limiter.consume('key-b').allowed).toBe(true)
  })

  it('membersihkan expired entries lewat cleanup', () => {
    const limiter = new InMemoryRateLimiter(1, 60_000)
    const map = (limiter as unknown as { buckets: Map<string, unknown> }).buckets

    limiter.consume('key-a')
    limiter.consume('key-b')
    expect(map.size).toBe(2)

    vi.advanceTimersByTime(60_001)

    limiter.consume('key-a')
    expect(map.size).toBe(1)

    limiter.consume('key-c')
    expect(map.size).toBe(2)
  })

  it('dispose membersihkan semua', () => {
    const limiter = new InMemoryRateLimiter(1, 60_000)
    const map = (limiter as unknown as { buckets: Map<string, unknown> }).buckets

    limiter.consume('key-a')
    limiter.consume('key-b')
    expect(map.size).toBe(2)

    limiter.dispose()
    expect(map.size).toBe(0)
  })
})
