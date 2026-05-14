// src/middleware/rate-limiter.ts
import type { Context, Next } from 'hono'

interface RateLimitOptions {
  limit: number
  window: number // seconds
}

const store = new Map<string, { count: number; resetAt: number }>()

export function rateLimiter({ limit, window }: RateLimitOptions) {
  return async (c: Context, next: Next) => {
    const ip =
      c.req.header('x-forwarded-for') ?? c.req.header('x-real-ip') ?? 'unknown'
    const now = Date.now()
    const windowMs = window * 1000

    const record = store.get(ip)

    if (!record || now > record.resetAt) {
      store.set(ip, { count: 1, resetAt: now + windowMs })
    } else {
      record.count++
      if (record.count > limit) {
        const retryAfter = Math.ceil((record.resetAt - now) / 1000)
        c.header('Retry-After', String(retryAfter))
        return c.json({ error: 'Too Many Requests' }, 429)
      }
    }

    c.header('X-RateLimit-Limit', String(limit))
    c.header(
      'X-RateLimit-Remaining',
      String(limit - (store.get(ip)?.count ?? 0))
    )
    await next()
  }
}
