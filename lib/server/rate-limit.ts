interface Bucket {
  count: number
  resetAt: number
}

export class InMemoryRateLimiter {
  private readonly buckets = new Map<string, Bucket>()

  constructor(
    private readonly limit: number,
    private readonly windowMs: number,
  ) {}

  consume(key: string): { allowed: boolean; retryAfterSeconds: number } {
    const now = Date.now()
    const bucket = this.buckets.get(key)

    if (!bucket || bucket.resetAt <= now) {
      this.buckets.set(key, { count: 1, resetAt: now + this.windowMs })
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
}

export const authRateLimiter = new InMemoryRateLimiter(10, 10 * 60_000)
export const syncRateLimiter = new InMemoryRateLimiter(60, 60_000)
