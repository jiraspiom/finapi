// src/routes/accounts.ts
import { zValidator } from '@hono/zod-validator'
import { Hono } from 'hono'
import { z } from 'zod'
import { authenticate } from '../middleware/auth'
import { db } from '../utils/db'

export const accountRoutes = new Hono<{ Variables: { userId: string } }>()
accountRoutes.use('*', authenticate)

const accountSchema = z.object({
  name: z.string().min(1).max(100),
  type: z.enum([
    'CHECKING',
    'SAVINGS',
    'CREDIT_CARD',
    'INVESTMENT',
    'CASH',
    'OTHER',
  ]),
  initialBalance: z.number().default(0),
  color: z.string().optional(),
  icon: z.string().optional(),
})

// GET /api/v1/accounts
accountRoutes.get('/', async c => {
  const userId = c.get('userId')
  const accounts = await db.account.findMany({
    where: { userId, isActive: true },
    include: {
      _count: { select: { transactions: true } },
    },
    orderBy: { createdAt: 'asc' },
  })

  const totalBalance = accounts.reduce((sum, a) => sum + Number(a.balance), 0)

  return c.json({ accounts, totalBalance })
})

// GET /api/v1/accounts/:id
accountRoutes.get('/:id', async c => {
  const userId = c.get('userId')
  const { id } = c.req.param()

  const account = await db.account.findFirst({
    where: { id, userId },
    include: {
      transactions: {
        take: 10,
        orderBy: { date: 'desc' },
        include: { category: true },
      },
    },
  })

  if (!account) return c.json({ error: 'Account not found' }, 404)
  return c.json(account)
})

// POST /api/v1/accounts
accountRoutes.post('/', zValidator('json', accountSchema), async c => {
  const userId = c.get('userId')
  const data = c.req.valid('json')

  const account = await db.account.create({
    data: {
      ...data,
      userId,
      balance: data.initialBalance,
    },
  })

  return c.json(account, 201)
})

// PUT /api/v1/accounts/:id
accountRoutes.put(
  '/:id',
  zValidator('json', accountSchema.partial()),
  async c => {
    const userId = c.get('userId')
    const { id } = c.req.param()
    const data = c.req.valid('json')

    const existing = await db.account.findFirst({ where: { id, userId } })
    if (!existing) return c.json({ error: 'Account not found' }, 404)

    const account = await db.account.update({ where: { id }, data })
    return c.json(account)
  }
)

// DELETE /api/v1/accounts/:id
accountRoutes.delete('/:id', async c => {
  const userId = c.get('userId')
  const { id } = c.req.param()

  const existing = await db.account.findFirst({ where: { id, userId } })
  if (!existing) return c.json({ error: 'Account not found' }, 404)

  // Soft delete
  await db.account.update({ where: { id }, data: { isActive: false } })
  return c.json({ message: 'Account deleted' })
})

// GET /api/v1/accounts/:id/statement
accountRoutes.get('/:id/statement', async c => {
  const userId = c.get('userId')
  const { id } = c.req.param()
  const { from, to } = c.req.query()

  const account = await db.account.findFirst({ where: { id, userId } })
  if (!account) return c.json({ error: 'Account not found' }, 404)

  const where: Record<string, unknown> = { accountId: id }
  if (from || to) {
    where.date = {
      ...(from ? { gte: new Date(from) } : {}),
      ...(to ? { lte: new Date(to) } : {}),
    }
  }

  const transactions = await db.transaction.findMany({
    where,
    include: { category: true },
    orderBy: { date: 'desc' },
  })

  const totalIncome = transactions
    .filter(t => t.type === 'INCOME')
    .reduce((s, t) => s + Number(t.amount), 0)
  const totalExpenses = transactions
    .filter(t => t.type === 'EXPENSE')
    .reduce((s, t) => s + Number(t.amount), 0)

  return c.json({
    account,
    transactions,
    summary: { totalIncome, totalExpenses, net: totalIncome - totalExpenses },
  })
})
