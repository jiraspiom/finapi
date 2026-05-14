// src/routes/dashboard.ts
import { Hono } from 'hono'
import { db } from '../utils/db'
import { authenticate } from '../middleware/auth'
import dayjs from 'dayjs'

export const dashboardRoutes = new Hono<{ Variables: { userId: string } }>()
dashboardRoutes.use('*', authenticate)

// GET /api/v1/dashboard
dashboardRoutes.get('/', async c => {
  const userId = c.get('userId')
  const now = dayjs()
  const startOfMonth = now.startOf('month').toDate()
  const endOfMonth = now.endOf('month').toDate()
  const startOfLastMonth = now.subtract(1, 'month').startOf('month').toDate()
  const endOfLastMonth = now.subtract(1, 'month').endOf('month').toDate()

  const [
    accounts,
    currentMonthTx,
    lastMonthTx,
    recentTransactions,
    budgets,
    goals,
    upcomingRecurring,
  ] = await Promise.all([
    db.account.findMany({ where: { userId, isActive: true } }),
    db.transaction.findMany({
      where: { userId, date: { gte: startOfMonth, lte: endOfMonth } },
    }),
    db.transaction.findMany({
      where: { userId, date: { gte: startOfLastMonth, lte: endOfLastMonth } },
    }),
    db.transaction.findMany({
      where: { userId },
      include: {
        category: true,
        account: { select: { id: true, name: true } },
      },
      orderBy: { date: 'desc' },
      take: 10,
    }),
    db.budget.findMany({
      where: { userId, month: now.month() + 1, year: now.year() },
      include: { category: true },
    }),
    db.goal.findMany({ where: { userId, status: 'ACTIVE' } }),
    db.recurringTransaction.findMany({
      where: {
        userId,
        isActive: true,
        nextDueDate: { lte: now.add(7, 'day').toDate() },
      },
      include: { category: true },
      orderBy: { nextDueDate: 'asc' },
    }),
  ])

  // Current month summary
  const income = currentMonthTx
    .filter(t => t.type === 'INCOME')
    .reduce((s, t) => s + Number(t.amount), 0)
  const expenses = currentMonthTx
    .filter(t => t.type === 'EXPENSE')
    .reduce((s, t) => s + Number(t.amount), 0)

  // Last month comparison
  const lastIncome = lastMonthTx
    .filter(t => t.type === 'INCOME')
    .reduce((s, t) => s + Number(t.amount), 0)
  const lastExpenses = lastMonthTx
    .filter(t => t.type === 'EXPENSE')
    .reduce((s, t) => s + Number(t.amount), 0)

  const totalBalance = accounts.reduce((s, a) => s + Number(a.balance), 0)

  // Budget alerts
  const budgetAlerts = budgets
    .filter(b => Number(b.spent) >= Number(b.amount) * 0.8)
    .map(b => ({
      ...b,
      percentage: Math.round((Number(b.spent) / Number(b.amount)) * 100),
    }))

  // Goal progress
  const goalProgress = goals.map(g => ({
    ...g,
    percentage: Math.min(
      100,
      Math.round((Number(g.currentAmount) / Number(g.targetAmount)) * 100)
    ),
    remaining: Math.max(0, Number(g.targetAmount) - Number(g.currentAmount)),
  }))

  return c.json({
    summary: {
      totalBalance,
      currentMonth: {
        income,
        expenses,
        net: income - expenses,
        savingsRate:
          income > 0 ? Math.round(((income - expenses) / income) * 100) : 0,
      },
      vsLastMonth: {
        incomeDelta:
          lastIncome > 0
            ? Math.round(((income - lastIncome) / lastIncome) * 100)
            : 0,
        expensesDelta:
          lastExpenses > 0
            ? Math.round(((expenses - lastExpenses) / lastExpenses) * 100)
            : 0,
      },
    },
    accounts: accounts.map(a => ({ ...a, balance: Number(a.balance) })),
    recentTransactions,
    budgetAlerts,
    goalProgress,
    upcomingRecurring,
  })
})
