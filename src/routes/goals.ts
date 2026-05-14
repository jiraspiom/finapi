// src/routes/goals.ts
import { Hono } from 'hono'
import { zValidator } from '@hono/zod-validator'
import { z } from 'zod'
import { db } from '../utils/db'
import { authenticate } from '../middleware/auth'

export const goalRoutes = new Hono<{ Variables: { userId: string } }>()
goalRoutes.use('*', authenticate)

const goalSchema = z.object({
  name: z.string().min(1).max(100),
  targetAmount: z.number().positive(),
  currentAmount: z.number().min(0).default(0),
  deadline: z.string().datetime().optional(),
  color: z.string().optional(),
  icon: z.string().optional(),
})

// GET /api/v1/goals
goalRoutes.get('/', async c => {
  const userId = c.get('userId')
  const goals = await db.goal.findMany({
    where: { userId },
    orderBy: { createdAt: 'desc' },
  })

  const enriched = goals.map(g => ({
    ...g,
    percentage: Math.min(
      100,
      Math.round((Number(g.currentAmount) / Number(g.targetAmount)) * 100)
    ),
    remaining: Math.max(0, Number(g.targetAmount) - Number(g.currentAmount)),
    isCompleted: Number(g.currentAmount) >= Number(g.targetAmount),
  }))

  return c.json({ goals: enriched })
})

// POST /api/v1/goals
goalRoutes.post('/', zValidator('json', goalSchema), async c => {
  const userId = c.get('userId')
  const data = c.req.valid('json')

  const goal = await db.goal.create({
    data: {
      ...data,
      userId,
      ...(data.deadline ? { deadline: new Date(data.deadline) } : {}),
    },
  })

  return c.json(goal, 201)
})

// PATCH /api/v1/goals/:id/deposit
goalRoutes.patch(
  '/:id/deposit',
  zValidator('json', z.object({ amount: z.number().positive() })),
  async c => {
    const userId = c.get('userId')
    const { id } = c.req.param()
    const { amount } = c.req.valid('json')

    const existing = await db.goal.findFirst({ where: { id, userId } })
    if (!existing) return c.json({ error: 'Goal not found' }, 404)

    const newAmount = Number(existing.currentAmount) + amount
    const completed = newAmount >= Number(existing.targetAmount)

    const goal = await db.goal.update({
      where: { id },
      data: {
        currentAmount: newAmount,
        status: completed ? 'COMPLETED' : existing.status,
      },
    })

    return c.json({
      goal,
      completed,
      message: completed ? '🎉 Goal achieved!' : undefined,
    })
  }
)

// PUT /api/v1/goals/:id
goalRoutes.put('/:id', zValidator('json', goalSchema.partial()), async c => {
  const userId = c.get('userId')
  const { id } = c.req.param()
  const data = c.req.valid('json')

  const existing = await db.goal.findFirst({ where: { id, userId } })
  if (!existing) return c.json({ error: 'Goal not found' }, 404)

  const goal = await db.goal.update({
    where: { id },
    data: {
      ...data,
      ...(data.deadline ? { deadline: new Date(data.deadline) } : {}),
    },
  })

  return c.json(goal)
})

// DELETE /api/v1/goals/:id
goalRoutes.delete('/:id', async c => {
  const userId = c.get('userId')
  const { id } = c.req.param()

  const existing = await db.goal.findFirst({ where: { id, userId } })
  if (!existing) return c.json({ error: 'Goal not found' }, 404)

  await db.goal.delete({ where: { id } })
  return c.json({ message: 'Goal deleted' })
})
