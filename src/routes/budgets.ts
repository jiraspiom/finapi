// src/routes/budgets.ts
import { Hono } from 'hono'
import { zValidator } from '@hono/zod-validator'
import { z } from 'zod'
import { db } from '../utils/db'
import { authenticate } from '../middleware/auth'

export const budgetRoutes = new Hono<{ Variables: { userId: string } }>()
budgetRoutes.use('*', authenticate)

const budgetSchema = z.object({
  categoryId: z.string().cuid(),
  amount: z.number().positive(),
  month: z.number().int().min(1).max(12),
  year: z.number().int().min(2000).max(2100),
})

// GET /api/v1/budgets?month=&year=
budgetRoutes.get('/', async c => {
  const userId = c.get('userId')
  const now = new Date()
  const month = Number(c.req.query('month')) || now.getMonth() + 1
  const year = Number(c.req.query('year')) || now.getFullYear()

  const budgets = await db.budget.findMany({
    where: { userId, month, year },
    include: { category: true },
    orderBy: { category: { name: 'asc' } },
  })

  const totalBudgeted = budgets.reduce((s, b) => s + Number(b.amount), 0)
  const totalSpent = budgets.reduce((s, b) => s + Number(b.spent), 0)

  const enriched = budgets.map(b => ({
    ...b,
    percentage:
      Number(b.amount) > 0
        ? Math.round((Number(b.spent) / Number(b.amount)) * 100)
        : 0,
    remaining: Number(b.amount) - Number(b.spent),
    status:
      Number(b.spent) >= Number(b.amount)
        ? 'exceeded'
        : Number(b.spent) >= Number(b.amount) * 0.8
          ? 'warning'
          : 'ok',
  }))

  return c.json({
    budgets: enriched,
    summary: {
      totalBudgeted,
      totalSpent,
      remaining: totalBudgeted - totalSpent,
    },
  })
})

// POST /api/v1/budgets
budgetRoutes.post('/', zValidator('json', budgetSchema), async c => {
  const userId = c.get('userId')
  const data = c.req.valid('json')

  // Calculate already spent for this month/category
  const startDate = new Date(data.year, data.month - 1, 1)
  const endDate = new Date(data.year, data.month, 0, 23, 59, 59)

  const spent = await db.transaction.aggregate({
    where: {
      userId,
      categoryId: data.categoryId,
      type: 'EXPENSE',
      date: { gte: startDate, lte: endDate },
    },
    _sum: { amount: true },
  })

  const budget = await db.budget.upsert({
    where: {
      userId_categoryId_month_year: {
        userId,
        categoryId: data.categoryId,
        month: data.month,
        year: data.year,
      },
    },
    create: { ...data, userId, spent: Number(spent._sum.amount ?? 0) },
    update: { amount: data.amount },
    include: { category: true },
  })

  return c.json(budget, 201)
})

// PUT /api/v1/budgets/:id
budgetRoutes.put(
  '/:id',
  zValidator('json', z.object({ amount: z.number().positive() })),
  async c => {
    const userId = c.get('userId')
    const { id } = c.req.param()
    const { amount } = c.req.valid('json')

    const existing = await db.budget.findFirst({ where: { id, userId } })
    if (!existing) return c.json({ error: 'Budget not found' }, 404)

    const budget = await db.budget.update({
      where: { id },
      data: { amount },
      include: { category: true },
    })
    return c.json(budget)
  }
)

// DELETE /api/v1/budgets/:id
budgetRoutes.delete('/:id', async c => {
  const userId = c.get('userId')
  const { id } = c.req.param()

  const existing = await db.budget.findFirst({ where: { id, userId } })
  if (!existing) return c.json({ error: 'Budget not found' }, 404)

  await db.budget.delete({ where: { id } })
  return c.json({ message: 'Budget deleted' })
})

// GET /api/v1/budgets/alerts
budgetRoutes.get('/alerts', async c => {
  const userId = c.get('userId')
  const now = new Date()

  const budgets = await db.budget.findMany({
    where: { userId, month: now.getMonth() + 1, year: now.getFullYear() },
    include: { category: true },
  })

  const alerts = budgets
    .filter(b => Number(b.spent) >= Number(b.amount) * 0.8)
    .map(b => ({
      budget: b,
      percentage: Math.round((Number(b.spent) / Number(b.amount)) * 100),
      exceeded: Number(b.spent) >= Number(b.amount),
    }))

  return c.json({ alerts })
})
