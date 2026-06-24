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

export const authRateLimiter = new InMemoryRateLimiter(10, 10 * 60_000)
export const syncRateLimiter = new InMemoryRateLimiter(60, 60_000)

export function globalRateLimiter(req: import('express').Request, res: import('express').Response, next: () => void): void {
  const key = `global:${req.ip ?? 'unknown'}`
  const result = globalLimiter.consume(key)
  if (!result.allowed) {
    res.status(429).set('Retry-After', String(result.retryAfterSeconds)).json({ error: 'Terlalu banyak request.' })
    return
  }
  next()
}

const globalLimiter = new InMemoryRateLimiter(100, 60_000)
