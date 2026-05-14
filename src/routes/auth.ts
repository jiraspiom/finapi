// src/routes/auth.ts
import { Hono } from 'hono'
import { zValidator } from '@hono/zod-validator'
import { z } from 'zod'
import bcrypt from 'bcryptjs'
import { db } from '../utils/db'
import {
  signAccessToken,
  signRefreshToken,
  verifyRefreshToken,
} from '../utils/jwt'
import { authenticate } from '../middleware/auth'
import dayjs from 'dayjs'

export const authRoutes = new Hono<{ Variables: { userId: string } }>()

const registerSchema = z.object({
  name: z.string().min(2).max(100),
  email: z.string().email(),
  password: z
    .string()
    .min(8)
    .regex(/^(?=.*[a-z])(?=.*[A-Z])(?=.*\d)/, {
      message: 'Password must contain uppercase, lowercase and number',
    }),
  currency: z.string().length(3).default('BRL'),
  timezone: z.string().default('America/Sao_Paulo'),
})

const loginSchema = z.object({
  email: z.string().email(),
  password: z.string(),
})

// POST /api/v1/auth/register
authRoutes.post('/register', zValidator('json', registerSchema), async c => {
  const { name, email, password, currency, timezone } = c.req.valid('json')

  const existing = await db.user.findUnique({ where: { email } })
  if (existing) {
    return c.json({ error: 'Email already registered' }, 409)
  }

  const hashed = await bcrypt.hash(password, 12)
  const user = await db.user.create({
    data: { name, email, password: hashed, currency, timezone },
    select: {
      id: true,
      name: true,
      email: true,
      currency: true,
      timezone: true,
      createdAt: true,
    },
  })

  // Create default categories for new user
  await createDefaultCategories(user.id)

  const accessToken = signAccessToken({ userId: user.id, email: user.email })
  const refreshToken = signRefreshToken({ userId: user.id, email: user.email })

  await db.refreshToken.create({
    data: {
      token: refreshToken,
      userId: user.id,
      expiresAt: dayjs().add(7, 'day').toDate(),
    },
  })

  return c.json({ user, accessToken, refreshToken }, 201)
})

// POST /api/v1/auth/login
authRoutes.post('/login', zValidator('json', loginSchema), async c => {
  const { email, password } = c.req.valid('json')

  const user = await db.user.findUnique({ where: { email } })
  if (!user) {
    return c.json({ error: 'Invalid credentials' }, 401)
  }

  const valid = await bcrypt.compare(password, user.password)
  if (!valid) {
    return c.json({ error: 'Invalid credentials' }, 401)
  }

  const accessToken = signAccessToken({ userId: user.id, email: user.email })
  const refreshToken = signRefreshToken({ userId: user.id, email: user.email })

  await db.refreshToken.create({
    data: {
      token: refreshToken,
      userId: user.id,
      expiresAt: dayjs().add(7, 'day').toDate(),
    },
  })

  const { password: _, ...safeUser } = user
  return c.json({ user: safeUser, accessToken, refreshToken })
})

// POST /api/v1/auth/refresh
authRoutes.post('/refresh', async c => {
  const body = await c.req.json()
  const { refreshToken } = body

  if (!refreshToken) {
    return c.json({ error: 'Refresh token required' }, 400)
  }

  try {
    const payload = verifyRefreshToken(refreshToken)
    const stored = await db.refreshToken.findUnique({
      where: { token: refreshToken },
    })

    if (!stored || stored.expiresAt < new Date()) {
      return c.json({ error: 'Invalid or expired refresh token' }, 401)
    }

    // Rotate refresh token
    await db.refreshToken.delete({ where: { token: refreshToken } })

    const newAccessToken = signAccessToken({
      userId: payload.userId,
      email: payload.email,
    })
    const newRefreshToken = signRefreshToken({
      userId: payload.userId,
      email: payload.email,
    })

    await db.refreshToken.create({
      data: {
        token: newRefreshToken,
        userId: payload.userId,
        expiresAt: dayjs().add(7, 'day').toDate(),
      },
    })

    return c.json({
      accessToken: newAccessToken,
      refreshToken: newRefreshToken,
    })
  } catch {
    return c.json({ error: 'Invalid refresh token' }, 401)
  }
})

// POST /api/v1/auth/logout
authRoutes.post('/logout', authenticate, async c => {
  const body = await c.req.json().catch(() => ({}))
  if (body.refreshToken) {
    await db.refreshToken.deleteMany({ where: { token: body.refreshToken } })
  }
  return c.json({ message: 'Logged out successfully' })
})

// GET /api/v1/auth/me
authRoutes.get('/me', authenticate, async c => {
  const userId = c.get('userId')
  const user = await db.user.findUnique({
    where: { id: userId },
    select: {
      id: true,
      name: true,
      email: true,
      currency: true,
      timezone: true,
      createdAt: true,
    },
  })
  if (!user) return c.json({ error: 'User not found' }, 404)
  return c.json(user)
})

// PATCH /api/v1/auth/me
authRoutes.patch(
  '/me',
  authenticate,
  zValidator(
    'json',
    z.object({
      name: z.string().min(2).max(100).optional(),
      currency: z.string().length(3).optional(),
      timezone: z.string().optional(),
    })
  ),
  async c => {
    const userId = c.get('userId')
    const data = c.req.valid('json')
    const user = await db.user.update({
      where: { id: userId },
      data,
      select: {
        id: true,
        name: true,
        email: true,
        currency: true,
        timezone: true,
      },
    })
    return c.json(user)
  }
)

async function createDefaultCategories(userId: string) {
  const defaults = [
    { name: 'Salário', type: 'INCOME' as const, color: '#22c55e', icon: '💼' },
    {
      name: 'Freelance',
      type: 'INCOME' as const,
      color: '#3b82f6',
      icon: '💻',
    },
    {
      name: 'Investimentos',
      type: 'INCOME' as const,
      color: '#8b5cf6',
      icon: '📈',
    },
    {
      name: 'Outros (Receita)',
      type: 'INCOME' as const,
      color: '#06b6d4',
      icon: '💰',
    },
    {
      name: 'Alimentação',
      type: 'EXPENSE' as const,
      color: '#f59e0b',
      icon: '🍽️',
    },
    {
      name: 'Transporte',
      type: 'EXPENSE' as const,
      color: '#ef4444',
      icon: '🚗',
    },
    { name: 'Moradia', type: 'EXPENSE' as const, color: '#f97316', icon: '🏠' },
    { name: 'Saúde', type: 'EXPENSE' as const, color: '#ec4899', icon: '🏥' },
    {
      name: 'Educação',
      type: 'EXPENSE' as const,
      color: '#14b8a6',
      icon: '📚',
    },
    { name: 'Lazer', type: 'EXPENSE' as const, color: '#a855f7', icon: '🎮' },
    { name: 'Compras', type: 'EXPENSE' as const, color: '#f43f5e', icon: '🛍️' },
    {
      name: 'Outros (Despesa)',
      type: 'EXPENSE' as const,
      color: '#64748b',
      icon: '📦',
    },
  ]

  await db.category.createMany({
    data: defaults.map(c => ({ ...c, userId })),
  })
}
