// src/routes/transfers.ts
import { Hono } from 'hono'
import { zValidator } from '@hono/zod-validator'
import { z } from 'zod'
import { db } from '../utils/db'
import { authenticate } from '../middleware/auth'

export const transferRoutes = new Hono<{ Variables: { userId: string } }>()
transferRoutes.use('*', authenticate)

const transferSchema = z
  .object({
    fromAccountId: z.string().cuid(),
    toAccountId: z.string().cuid(),
    amount: z.number().positive(),
    description: z.string().optional(),
    date: z.string().datetime(),
  })
  .refine(d => d.fromAccountId !== d.toAccountId, {
    message: 'Source and destination accounts must be different',
  })

// GET /api/v1/transfers
transferRoutes.get('/', async c => {
  const userId = c.get('userId')
  const transfers = await db.transfer.findMany({
    where: { userId },
    include: {
      fromAccount: { select: { id: true, name: true, type: true } },
      toAccount: { select: { id: true, name: true, type: true } },
    },
    orderBy: { date: 'desc' },
    take: 50,
  })
  return c.json({ transfers })
})

// POST /api/v1/transfers
transferRoutes.post('/', zValidator('json', transferSchema), async c => {
  const userId = c.get('userId')
  const data = c.req.valid('json')

  const [from, to] = await Promise.all([
    db.account.findFirst({ where: { id: data.fromAccountId, userId } }),
    db.account.findFirst({ where: { id: data.toAccountId, userId } }),
  ])

  if (!from) return c.json({ error: 'Source account not found' }, 404)
  if (!to) return c.json({ error: 'Destination account not found' }, 404)
  if (Number(from.balance) < data.amount) {
    return c.json({ error: 'Insufficient balance' }, 422)
  }

  const transfer = await db.$transaction(async prisma => {
    const t = await prisma.transfer.create({
      data: { ...data, userId, date: new Date(data.date) },
      include: { fromAccount: true, toAccount: true },
    })
    await prisma.account.update({
      where: { id: data.fromAccountId },
      data: { balance: { decrement: data.amount } },
    })
    await prisma.account.update({
      where: { id: data.toAccountId },
      data: { balance: { increment: data.amount } },
    })
    return t
  })

  return c.json(transfer, 201)
})
