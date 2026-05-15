// src/routes/reports.ts
import dayjs from 'dayjs'
import { Hono } from 'hono'
import { authenticate } from '../middleware/auth'
import { db } from '../utils/db'

export const reportRoutes = new Hono<{ Variables: { userId: string } }>()
reportRoutes.use('*', authenticate)

// GET /api/v1/reports/monthly?year=2024
reportRoutes.get('/monthly', async c => {
  const userId = c.get('userId')
  const year = Number(c.req.query('year')) || new Date().getFullYear()

  const transactions = await db.transaction.findMany({
    where: {
      userId,
      date: {
        gte: new Date(year, 0, 1),
        lte: new Date(year, 11, 31, 23, 59, 59),
      },
    },
  })

  const monthly = Array.from({ length: 12 }, (_, i) => {
    const monthTx = transactions.filter(t => dayjs(t.date).month() === i)
    const income = monthTx
      .filter(t => t.type === 'INCOME')
      .reduce((s, t) => s + Number(t.amount), 0)
    const expenses = monthTx
      .filter(t => t.type === 'EXPENSE')
      .reduce((s, t) => s + Number(t.amount), 0)
    return {
      month: i + 1,
      monthName: dayjs().month(i).format('MMMM'),
      income,
      expenses,
      net: income - expenses,
      savingsRate:
        income > 0 ? Math.round(((income - expenses) / income) * 100) : 0,
    }
  })

  const totals = monthly.reduce(
    (acc, m) => ({
      income: acc.income + m.income,
      expenses: acc.expenses + m.expenses,
    }),
    { income: 0, expenses: 0 }
  )

  return c.json({
    year,
    monthly,
    totals: { ...totals, net: totals.income - totals.expenses },
  })
})

// GET /api/v1/reports/by-category?from=&to=&type=EXPENSE
reportRoutes.get('/by-category', async c => {
  const userId = c.get('userId')
  const { from, to, type } = c.req.query()

  const where: Record<string, unknown> = { userId }
  if (type) where.type = type
  if (from || to) {
    where.date = {
      ...(from ? { gte: new Date(from) } : {}),
      ...(to ? { lte: new Date(to) } : {}),
    }
  }

  const transactions = await db.transaction.findMany({
    where,
    include: { category: true },
  })

  const byCategory = transactions.reduce<
    Record<string, { category: unknown; total: number; count: number }>
  >((acc, t) => {
    const key = t.categoryId ?? 'uncategorized'
    if (!acc[key]) {
      acc[key] = {
        category: t.category ?? { name: 'Uncategorized' },
        total: 0,
        count: 0,
      }
    }
    acc[key].total += Number(t.amount)
    acc[key].count++
    return acc
  }, {})

  const grandTotal = Object.values(byCategory).reduce((s, c) => s + c.total, 0)

  const result = Object.values(byCategory)
    .map(item => ({
      ...item,
      percentage:
        grandTotal > 0 ? Math.round((item.total / grandTotal) * 100) : 0,
    }))
    .sort((a, b) => b.total - a.total)

  return c.json({ categories: result, total: grandTotal })
})

// GET /api/v1/reports/cash-flow?months=6
reportRoutes.get('/cash-flow', async c => {
  const userId = c.get('userId')
  const months = Math.min(24, Number(c.req.query('months')) || 6)

  const from = dayjs()
    .subtract(months - 1, 'month')
    .startOf('month')
    .toDate()
  const transactions = await db.transaction.findMany({
    where: { userId, date: { gte: from } },
  })

  const cashFlow = []
  let runningBalance = 0

  for (let i = months - 1; i >= 0; i--) {
    const d = dayjs().subtract(i, 'month')
    const monthTx = transactions.filter(
      t =>
        dayjs(t.date).month() === d.month() && dayjs(t.date).year() === d.year()
    )
    const income = monthTx
      .filter(t => t.type === 'INCOME')
      .reduce((s, t) => s + Number(t.amount), 0)
    const expenses = monthTx
      .filter(t => t.type === 'EXPENSE')
      .reduce((s, t) => s + Number(t.amount), 0)
    runningBalance += income - expenses

    cashFlow.push({
      month: d.format('YYYY-MM'),
      label: d.format('MMM YYYY'),
      income,
      expenses,
      net: income - expenses,
      cumulativeNet: runningBalance,
    })
  }

  return c.json({ cashFlow })
})

// GET /api/v1/reports/net-worth
reportRoutes.get('/net-worth', async c => {
  const userId = c.get('userId')

  const accounts = await db.account.findMany({
    where: { userId, isActive: true },
  })

  const assets = accounts.filter(a =>
    ['CHECKING', 'SAVINGS', 'INVESTMENT', 'CASH'].includes(a.type)
  )
  const liabilities = accounts.filter(
    a => a.type === 'CREDIT_CARD' && Number(a.balance) < 0
  )

  const totalAssets = assets.reduce(
    (s, a) => s + Math.max(0, Number(a.balance)),
    0
  )
  const totalLiabilities = Math.abs(
    liabilities.reduce((s, a) => s + Math.min(0, Number(a.balance)), 0)
  )

  return c.json({
    netWorth: totalAssets - totalLiabilities,
    totalAssets,
    totalLiabilities,
    accounts: accounts.map(a => ({ ...a, balance: Number(a.balance) })),
  })
})
