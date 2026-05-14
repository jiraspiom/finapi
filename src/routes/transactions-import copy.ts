// src/routes/transactions-import.ts

import { Hono } from 'hono'
import * as ofx from 'ofx-js'
import { z } from 'zod'
import { authenticate } from '../middleware/auth'
import { db } from '../utils/db'

export const transactionImportRoutes = new Hono<{
  Variables: { userId: string }
}>()

transactionImportRoutes.use('*', authenticate)

const importSchema = z.object({
  accountId: z.string().cuid(),
})

transactionImportRoutes.post('/ofx', async c => {
  const userId = c.get('userId')

  const body = await c.req.parseBody()

  const file = body.file

  if (!(file instanceof File)) {
    return c.json({ error: 'Arquivo OFX é obrigatório' }, 400)
  }

  const accountId = body.accountId?.toString()

  const parsed = importSchema.safeParse({
    accountId,
  })

  if (!parsed.success) {
    return c.json(parsed.error, 400)
  }

  // Verifica conta
  const account = await db.account.findFirst({
    where: {
      id: accountId,
      userId,
    },
  })

  if (!account) {
    return c.json({ error: 'Conta não encontrada' }, 404)
  }

  // Lê OFX
  const text = await file.text()

  console.log('Conteúdo do arquivo OFX:', text)

  let data: any

  try {
    data = ofx.parse(text)
  } catch {
    return c.json({ error: 'Arquivo OFX inválido' }, 400)
  }

  const transactions =
    data?.OFX?.BANKMSGSRSV1?.STMTTRNRS?.STMTRS?.BANKTRANLIST?.STMTTRN ?? []

  if (!Array.isArray(transactions)) {
    return c.json({ error: 'Nenhuma transação encontrada' }, 400)
  }

  const createdTransactions = await db.$transaction(
    transactions.map((tx: any) => {
      const amount = Math.abs(Number(tx.TRNAMT))

      return db.transaction.create({
        data: {
          userId,
          accountId,

          type: Number(tx.TRNAMT) > 0 ? 'INCOME' : 'EXPENSE',

          amount,

          description: tx.NAME || tx.MEMO || 'Importado OFX',

          notes: `OFX FITID: ${tx.FITID}`,

          date: new Date(tx.DTPOSTED),

          tags: ['ofx-import'],

          // categoria padrão
          categoryId: 'COLOQUE_CATEGORIA_PADRAO',
        },
      })
    })
  )

  // Atualiza saldo
  const balanceDelta = transactions.reduce((acc: number, tx: any) => {
    return acc + Number(tx.TRNAMT)
  }, 0)

  await db.account.update({
    where: {
      id: accountId,
    },
    data: {
      balance: {
        increment: balanceDelta,
      },
    },
  })

  return c.json({
    imported: createdTransactions.length,
    transactions: createdTransactions,
  })
})
