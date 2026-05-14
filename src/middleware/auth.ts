// src/middleware/auth.ts
import type { Context, Next } from 'hono'
import { verifyAccessToken } from '../utils/jwt'

export async function authenticate(c: Context, next: Next) {
  const authHeader = c.req.header('Authorization')
  if (!authHeader?.startsWith('Bearer ')) {
    return c.json(
      { error: 'Unauthorized', message: 'Missing or invalid token' },
      401
    )
  }

  const token = authHeader.slice(7)
  try {
    const payload = verifyAccessToken(token)
    c.set('userId', payload.userId)
    c.set('userEmail', payload.email)
    await next()
  } catch {
    return c.json(
      { error: 'Unauthorized', message: 'Invalid or expired token' },
      401
    )
  }
}
