// src/routes/recurring.ts
import { Hono } from 'hono'
import { zValidator } from '@hono/zod-validator'
import { z } from 'zod'
import dayjs from 'dayjs'
import { db } from '../utils/db'
import { authenticate } from '../middleware/auth'

export const recurringRoutes = new Hono<{ Variables: { userId: string } }>()
recurringRoutes.use('*', authenticate)

const recurringSchema = z.object({
  categoryId: z.string().cuid(),
  type: z.enum(['INCOME', 'EXPENSE']),
  amount: z.number().positive(),
  description: z.string().min(1).max(255),
  frequency: z.enum([
    'DAILY',
    'WEEKLY',
    'BIWEEKLY',
    'MONTHLY',
    'QUARTERLY',
    'YEARLY',
  ]),
  startDate: z.string().datetime(),
  endDate: z.string().datetime().optional(),
})

function getNextDueDate(from: Date, frequency: string): Date {
  const d = dayjs(from)
  switch (frequency) {
    case 'DAILY':
      return d.add(1, 'day').toDate()
    case 'WEEKLY':
      return d.add(1, 'week').toDate()
    case 'BIWEEKLY':
      return d.add(2, 'week').toDate()
    case 'MONTHLY':
      return d.add(1, 'month').toDate()
    case 'QUARTERLY':
      return d.add(3, 'month').toDate()
    case 'YEARLY':
      return d.add(1, 'year').toDate()
    default:
      return d.add(1, 'month').toDate()
  }
}

// GET /api/v1/recurring
recurringRoutes.get('/', async c => {
  const userId = c.get('userId')
  const recurring = await db.recurringTransaction.findMany({
    where: { userId },
    include: { category: true },
    orderBy: { nextDueDate: 'asc' },
  })
  return c.json({ recurring })
})

// POST /api/v1/recurring
recurringRoutes.post('/', zValidator('json', recurringSchema), async c => {
  const userId = c.get('userId')
  const data = c.req.valid('json')

  const startDate = new Date(data.startDate)
  const recurring = await db.recurringTransaction.create({
    data: {
      ...data,
      userId,
      startDate,
      nextDueDate: startDate,
      ...(data.endDate ? { endDate: new Date(data.endDate) } : {}),
    },
    include: { category: true },
  })

  return c.json(recurring, 201)
})

// POST /api/v1/recurring/:id/process — manually trigger processing
recurringRoutes.post('/:id/process', async c => {
  const userId = c.get('userId')
  const { id } = c.req.param()

  const recurring = await db.recurringTransaction.findFirst({
    where: { id, userId, isActive: true },
  })
  if (!recurring)
    return c.json({ error: 'Recurring transaction not found' }, 404)

  const accounts = await db.account.findMany({
    where: { userId, isActive: true },
    take: 1,
  })
  if (!accounts.length)
    return c.json({ error: 'No active accounts found' }, 422)

  const tx = await db.$transaction(async prisma => {
    const transaction = await prisma.transaction.create({
      data: {
        userId,
        accountId: accounts[0].id,
        categoryId: recurring.categoryId,
        type: recurring.type,
        amount: recurring.amount,
        description: recurring.description,
        date: recurring.nextDueDate,
        isRecurring: true,
        recurringId: recurring.id,
      },
    })

    const balanceDelta =
      recurring.type === 'INCOME'
        ? Number(recurring.amount)
        : -Number(recurring.amount)
    await prisma.account.update({
      where: { id: accounts[0].id },
      data: { balance: { increment: balanceDelta } },
    })

    const nextDue = getNextDueDate(recurring.nextDueDate, recurring.frequency)
    const shouldDeactivate = recurring.endDate && nextDue > recurring.endDate

    await prisma.recurringTransaction.update({
      where: { id },
      data: { nextDueDate: nextDue, isActive: !shouldDeactivate },
    })

    return transaction
  })

  return c.json({ transaction: tx, message: 'Recurring transaction processed' })
})

// DELETE /api/v1/recurring/:id
recurringRoutes.delete('/:id', async c => {
  const userId = c.get('userId')
  const { id } = c.req.param()

  const existing = await db.recurringTransaction.findFirst({
    where: { id, userId },
  })
  if (!existing) return c.json({ error: 'Not found' }, 404)

  await db.recurringTransaction.update({
    where: { id },
    data: { isActive: false },
  })
  return c.json({ message: 'Recurring transaction deactivated' })
})
