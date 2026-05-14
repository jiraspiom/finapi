// src/routes/import.ts
import { Hono } from 'hono'
import { zValidator } from '@hono/zod-validator'
import { z } from 'zod'
import { db } from '../utils/db'
import { authenticate } from '../middleware/auth'
import { parseOFX, categorizeTransaction } from '../service/ofx-parser'

export const importRoutes = new Hono<{ Variables: { userId: string } }>()
importRoutes.use('*', authenticate)

// POST /api/v1/import/ofx
importRoutes.post(
  '/ofx',
  zValidator(
    'json',
    z.object({
      fileContent: z.string().min(1),
      accountId: z.string().cuid(),
      autoCategorizе: z.boolean().default(true),
    })
  ),
  async c => {
    const userId = c.get('userId')
    const { fileContent, accountId, autoCategorizе } = c.req.valid('json')

    try {
      // Verify account ownership
      const account = await db.account.findFirst({
        where: { id: accountId, userId },
      })
      if (!account) {
        return c.json({ error: 'Conta não encontrada' }, 404)
      }

      // Parse OFX file
      const ofxData = await parseOFX(fileContent)

      // Get user categories for auto-categorization
      const categories = await db.category.findMany({ where: { userId } })
      const categoryMap = new Map(
        categories.map(c => [c.name.toLowerCase(), c.id])
      )

      // Find or create "Outros" category
      let othersCategory = categories.find(
        c => c.name.toLowerCase() === 'outros (despesa)'
      )
      if (!othersCategory) {
        othersCategory = await db.category.create({
          data: {
            userId,
            name: 'Outros (Despesa)',
            type: 'EXPENSE',
            color: '#64748b',
            icon: '📦',
          },
        })
      }

      // Prepare transactions for bulk insert
      const transactionsToCreate = ofxData.transactions.map(tx => {
        let categoryId = othersCategory!.id

        // Auto-categorize if enabled
        if (autoCategorizе) {
          const suggestedCategory = categorizeTransaction(tx.description)
          const found = categoryMap.get(suggestedCategory)
          if (found) categoryId = found
        }

        return {
          userId,
          accountId,
          categoryId,
          type:
            tx.type === 'CREDIT' ? ('INCOME' as const) : ('EXPENSE' as const),
          amount: tx.amount,
          description: tx.description,
          notes: tx.memo,
          date: tx.date,
          tags: ['importado-ofx'],
        }
      })

      // Bulk create transactions
      const created = await db.$transaction(
        transactionsToCreate.map(tx => db.transaction.create({ data: tx }))
      )

      // Update account balance
      const balanceChange = transactionsToCreate.reduce(
        (sum, tx) => sum + (tx.type === 'INCOME' ? tx.amount : -tx.amount),
        0
      )

      await db.account.update({
        where: { id: accountId },
        data: { balance: { increment: balanceChange } },
      })

      return c.json(
        {
          success: true,
          imported: created.length,
          transactions: created,
          message: `${created.length} transações importadas com sucesso`,
        },
        201
      )
    } catch (error: any) {
      console.error('Import error:', error)
      return c.json(
        {
          error: 'Erro ao importar OFX',
          message: error.message,
        },
        400
      )
    }
  }
)

// POST /api/v1/import/ofx/preview
importRoutes.post(
  '/ofx/preview',
  zValidator(
    'json',
    z.object({
      fileContent: z.string().min(1),
    })
  ),
  async c => {
    try {
      const { fileContent } = c.req.valid('json')
      const ofxData = await parseOFX(fileContent)

      return c.json({
        accountInfo: {
          accountId: ofxData.accountId,
          accountType: ofxData.accountType,
          currency: ofxData.currency,
          balance: ofxData.balance,
        },
        transactionCount: ofxData.transactions.length,
        dateRange: {
          from: ofxData.transactions[ofxData.transactions.length - 1]?.date,
          to: ofxData.transactions[0]?.date,
        },
        preview: ofxData.transactions.slice(0, 5).map(tx => ({
          date: tx.date,
          description: tx.description,
          amount: tx.amount,
          type: tx.type,
        })),
      })
    } catch (error: any) {
      return c.json(
        {
          error: 'Erro ao processar arquivo OFX',
          message: error.message,
        },
        400
      )
    }
  }
)
