// src/routes/categories.ts
import { Hono } from 'hono'
import { zValidator } from '@hono/zod-validator'
import { z } from 'zod'
import { db } from '../utils/db'
import { authenticate } from '../middleware/auth'

export const categoryRoutes = new Hono<{ Variables: { userId: string } }>()
categoryRoutes.use('*', authenticate)

const categorySchema = z.object({
  name: z.string().min(1).max(100),
  type: z.enum(['INCOME', 'EXPENSE']),
  color: z.string().regex(/^#[0-9A-Fa-f]{6}$/),
  icon: z.string().max(10),
})

// GET /api/v1/categories
categoryRoutes.get('/', async c => {
  const userId = c.get('userId')
  const type = c.req.query('type') as 'INCOME' | 'EXPENSE' | undefined

  const categories = await db.category.findMany({
    where: { userId, ...(type ? { type } : {}) },
    include: { _count: { select: { transactions: true } } },
    orderBy: { name: 'asc' },
  })

  return c.json({ categories })
})

// POST /api/v1/categories
categoryRoutes.post('/', zValidator('json', categorySchema), async c => {
  const userId = c.get('userId')
  const data = c.req.valid('json')

  const category = await db.category.create({ data: { ...data, userId } })
  return c.json(category, 201)
})

// PUT /api/v1/categories/:id
categoryRoutes.put(
  '/:id',
  zValidator('json', categorySchema.partial()),
  async c => {
    const userId = c.get('userId')
    const { id } = c.req.param()
    const data = c.req.valid('json')

    const existing = await db.category.findFirst({ where: { id, userId } })
    if (!existing) return c.json({ error: 'Category not found' }, 404)
    if (existing.isSystem)
      return c.json({ error: 'System categories cannot be edited' }, 403)

    const category = await db.category.update({ where: { id }, data })
    return c.json(category)
  }
)

// DELETE /api/v1/categories/:id
categoryRoutes.delete('/:id', async c => {
  const userId = c.get('userId')
  const { id } = c.req.param()

  const existing = await db.category.findFirst({ where: { id, userId } })
  if (!existing) return c.json({ error: 'Category not found' }, 404)
  if (existing.isSystem)
    return c.json({ error: 'System categories cannot be deleted' }, 403)

  const txCount = await db.transaction.count({ where: { categoryId: id } })
  if (txCount > 0)
    return c.json(
      { error: 'Cannot delete category with transactions', txCount },
      422
    )

  await db.category.delete({ where: { id } })
  return c.json({ message: 'Category deleted' })
})
