// src/routes/transactions.ts
import { Hono } from 'hono'
import { zValidator } from '@hono/zod-validator'
import { z } from 'zod'
import { db } from '../utils/db'
import { authenticate } from '../middleware/auth'
import { parsePagination, buildMeta } from '../utils/pagination'

export const transactionRoutes = new Hono<{ Variables: { userId: string } }>()
transactionRoutes.use('*', authenticate)

const transactionSchema = z.object({
  accountId: z.string().cuid(),
  categoryId: z.string().cuid(),
  type: z.enum(['INCOME', 'EXPENSE']),
  amount: z.number().positive(),
  description: z.string().min(1).max(255),
  notes: z.string().max(1000).optional(),
  date: z.string().datetime(),
  tags: z.array(z.string()).default([]),
})

const filterSchema = z.object({
  page: z.string().optional(),
  limit: z.string().optional(),
  type: z.enum(['INCOME', 'EXPENSE']).optional(),
  categoryId: z.string().optional(),
  accountId: z.string().optional(),
  from: z.string().optional(),
  to: z.string().optional(),
  search: z.string().optional(),
  tags: z.string().optional(),
  minAmount: z.string().optional(),
  maxAmount: z.string().optional(),
})

// GET /api/v1/transactions
transactionRoutes.get('/', zValidator('query', filterSchema), async c => {
  const userId = c.get('userId')
  const query = c.req.valid('query')
  const { page, limit, skip } = parsePagination(query)

  const where: Record<string, unknown> = { userId }
  if (query.type) where.type = query.type
  if (query.categoryId) where.categoryId = query.categoryId
  if (query.accountId) where.accountId = query.accountId
  if (query.search)
    where.description = { contains: query.search, mode: 'insensitive' }
  if (query.tags) where.tags = { hasSome: query.tags.split(',') }
  if (query.from || query.to) {
    where.date = {
      ...(query.from ? { gte: new Date(query.from) } : {}),
      ...(query.to ? { lte: new Date(query.to) } : {}),
    }
  }
  if (query.minAmount || query.maxAmount) {
    where.amount = {
      ...(query.minAmount ? { gte: Number(query.minAmount) } : {}),
      ...(query.maxAmount ? { lte: Number(query.maxAmount) } : {}),
    }
  }

  const [transactions, total] = await Promise.all([
    db.transaction.findMany({
      where,
      include: {
        category: true,
        account: { select: { id: true, name: true, type: true } },
      },
      orderBy: { date: 'desc' },
      take: limit,
      skip,
    }),
    db.transaction.count({ where }),
  ])

  return c.json({ data: transactions, meta: buildMeta(page, limit, total) })
})

// GET /api/v1/transactions/:id
transactionRoutes.get('/:id', async c => {
  const userId = c.get('userId')
  const { id } = c.req.param()

  const tx = await db.transaction.findFirst({
    where: { id, userId },
    include: { category: true, account: true },
  })

  if (!tx) return c.json({ error: 'Transaction not found' }, 404)
  return c.json(tx)
})

// POST /api/v1/transactions
transactionRoutes.post('/', zValidator('json', transactionSchema), async c => {
  const userId = c.get('userId')
  const data = c.req.valid('json')

  // Verify account belongs to user
  const account = await db.account.findFirst({
    where: { id: data.accountId, userId },
  })
  if (!account) return c.json({ error: 'Account not found' }, 404)

  const tx = await db.$transaction(async prisma => {
    const transaction = await prisma.transaction.create({
      data: { ...data, userId, date: new Date(data.date) },
      include: { category: true, account: true },
    })

    // Update account balance
    const balanceDelta = data.type === 'INCOME' ? data.amount : -data.amount
    await prisma.account.update({
      where: { id: data.accountId },
      data: { balance: { increment: balanceDelta } },
    })

    // Update budget if expense
    if (data.type === 'EXPENSE') {
      const date = new Date(data.date)
      await prisma.budget.updateMany({
        where: {
          userId,
          categoryId: data.categoryId,
          month: date.getMonth() + 1,
          year: date.getFullYear(),
        },
        data: { spent: { increment: data.amount } },
      })
    }

    return transaction
  })

  return c.json(tx, 201)
})

// PUT /api/v1/transactions/:id
transactionRoutes.put(
  '/:id',
  zValidator('json', transactionSchema.partial()),
  async c => {
    const userId = c.get('userId')
    const { id } = c.req.param()
    const data = c.req.valid('json')

    const existing = await db.transaction.findFirst({ where: { id, userId } })
    if (!existing) return c.json({ error: 'Transaction not found' }, 404)

    const tx = await db.$transaction(async prisma => {
      // Reverse old balance effect
      const oldDelta =
        existing.type === 'INCOME'
          ? -Number(existing.amount)
          : Number(existing.amount)
      await prisma.account.update({
        where: { id: existing.accountId },
        data: { balance: { increment: oldDelta } },
      })

      // Apply new balance effect
      const newAmount = data.amount ?? Number(existing.amount)
      const newType = data.type ?? existing.type
      const newDelta = newType === 'INCOME' ? newAmount : -newAmount
      await prisma.account.update({
        where: { id: data.accountId ?? existing.accountId },
        data: { balance: { increment: newDelta } },
      })

      return prisma.transaction.update({
        where: { id },
        data: { ...data, ...(data.date ? { date: new Date(data.date) } : {}) },
        include: { category: true, account: true },
      })
    })

    return c.json(tx)
  }
)

// DELETE /api/v1/transactions/:id
transactionRoutes.delete('/:id', async c => {
  const userId = c.get('userId')
  const { id } = c.req.param()

  const existing = await db.transaction.findFirst({ where: { id, userId } })
  if (!existing) return c.json({ error: 'Transaction not found' }, 404)

  await db.$transaction(async prisma => {
    await prisma.transaction.delete({ where: { id } })

    const balanceDelta =
      existing.type === 'INCOME'
        ? -Number(existing.amount)
        : Number(existing.amount)
    await prisma.account.update({
      where: { id: existing.accountId },
      data: { balance: { increment: balanceDelta } },
    })
  })

  return c.json({ message: 'Transaction deleted' })
})

// POST /api/v1/transactions/bulk
transactionRoutes.post(
  '/bulk',
  zValidator(
    'json',
    z.object({
      transactions: z.array(transactionSchema).min(1).max(100),
    })
  ),
  async c => {
    const userId = c.get('userId')
    const { transactions } = c.req.valid('json')

    const created = await db.$transaction(
      transactions.map(t =>
        db.transaction.create({
          data: { ...t, userId, date: new Date(t.date) },
        })
      )
    )

    return c.json({ created: created.length, transactions: created }, 201)
  }
)
