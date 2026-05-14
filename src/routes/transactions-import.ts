import { Hono } from 'hono'
import { authenticate } from '../middleware/auth'
import { parseOfxFile } from '../service/ofx-parser'
import { db } from '../utils/db'

export const transactionImportRoutes = new Hono<{
  Variables: { userId: string }
}>()

transactionImportRoutes.use('*', authenticate)

transactionImportRoutes.post('/ofx', async c => {
  const userId = c.get('userId')

  const body = await c.req.parseBody()

  const file = body.file

  const accountId = body.accountId?.toString()

  const categoryId = body.categoryId?.toString()

  if (!(file instanceof File)) {
    return c.json(
      {
        error: 'Arquivo OFX obrigatório',
      },
      400
    )
  }

  if (!accountId) {
    return c.json(
      {
        error: 'accountId obrigatório',
      },
      400
    )
  }

  const account = await db.account.findFirst({
    where: {
      id: accountId,
      userId,
    },
  })

  if (!account) {
    return c.json(
      {
        error: 'Conta não encontrada',
      },
      404
    )
  }

  const transactions = await parseOfxFile(file)

  let imported = 0

  await db.$transaction(async prisma => {
    for (const tx of transactions) {
      // evita duplicidade
      const exists = await prisma.transaction.findFirst({
        where: {
          userId,
          notes: `OFX:${tx.fitId}`,
        },
      })

      if (exists) {
        continue
      }

      const data: any = {
        user: { connect: { id: userId } },
        account: { connect: { id: accountId } },
        type: tx.type,
        amount: tx.amount,
        description: tx.memo,
        notes: `OFX:${tx.fitId}`,
        date: tx.date,
        tags: ['ofx-import'],
      }
      if (categoryId) {
        data.category = { connect: { id: categoryId } }
      }
      await prisma.transaction.create({ data })

      imported++
      await prisma.account.update({
        where: {
          id: accountId,
        },
        data: {
          balance: {
            increment: tx.rawAmount,
          },
        },
      })
    }
  })

  return c.json({
    imported,
    total: transactions.length,
  })
})
