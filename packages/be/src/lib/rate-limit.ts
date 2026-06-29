import type { IncomingMessage, ServerResponse } from 'node:http'

interface Bucket {
  count: number
  resetAt: number
}

export class InMemoryRateLimiter {
  private readonly buckets = new Map<string, Bucket>()
  private cleanupTimer?: ReturnType<typeof setInterval>

  constructor(
    private readonly limit: number,
    private readonly windowMs: number,
  ) {
    const interval = Math.max(windowMs, 60_000)
    this.cleanupTimer = setInterval(() => this.cleanup(), interval)
    if (this.cleanupTimer.unref) this.cleanupTimer.unref()
  }

  consume(key: string): { allowed: boolean; retryAfterSeconds: number } {
    const now = Date.now()
    let bucket = this.buckets.get(key)

    if (!bucket || bucket.resetAt <= now) {
      bucket = { count: 1, resetAt: now + this.windowMs }
      this.buckets.set(key, bucket)
      return { allowed: true, retryAfterSeconds: 0 }
    }

    if (bucket.count >= this.limit) {
      return {
        allowed: false,
        retryAfterSeconds: Math.max(1, Math.ceil((bucket.resetAt - now) / 1000)),
      }
    }

    bucket.count += 1
    return { allowed: true, retryAfterSeconds: 0 }
  }

  private cleanup(): void {
    const now = Date.now()
    for (const [key, bucket] of this.buckets) {
      if (bucket.resetAt <= now) this.buckets.delete(key)
    }
  }

  dispose(): void {
    if (this.cleanupTimer) clearInterval(this.cleanupTimer)
    this.buckets.clear()
  }
}

const isDev = process.env.NODE_ENV !== 'production' && process.env.VERCEL !== '1'

export const authRateLimiter = new InMemoryRateLimiter(isDev ? 1000 : 10, 10 * 60_000)
export const emailRateLimiter = new InMemoryRateLimiter(isDev ? 1000 : 5, 15 * 60_000)
export const syncRateLimiter = new InMemoryRateLimiter(isDev ? 10_000 : 60, 60_000)
export const workbookAdminRateLimiter = new InMemoryRateLimiter(isDev ? 1000 : 30, 60_000)

function getClientIp(req: IncomingMessage): string {
  const forwarded = req.headers['x-forwarded-for']
  if (typeof forwarded === 'string' && forwarded.length > 0) {
    return forwarded.split(',')[0]?.trim() || 'unknown'
  }
  return req.socket.remoteAddress ?? 'unknown'
}

export function globalRateLimiter(req: IncomingMessage, res: ServerResponse, next: () => void): void {
  const ip = getClientIp(req)
  const result = globalLimiter.consume(`global:${ip}`)
  if (!result.allowed) {
    res.statusCode = 429
    res.setHeader('Retry-After', String(result.retryAfterSeconds))
    res.setHeader('Content-Type', 'application/json')
    res.end(JSON.stringify({ error: 'Terlalu banyak request.' }))
    return
  }
  next()
}

const globalLimiter = new InMemoryRateLimiter(1000, 60_000)
