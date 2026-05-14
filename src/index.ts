// src/index.ts
import { Hono } from 'hono'
import { cors } from 'hono/cors'
import { logger } from 'hono/logger'
import { prettyJSON } from 'hono/pretty-json'
import { secureHeaders } from 'hono/secure-headers'
import { errorHandler } from './middleware/error-handler'
import { rateLimiter } from './middleware/rate-limiter'
import { accountRoutes } from './routes/accounts'
import { authRoutes } from './routes/auth'
import { budgetRoutes } from './routes/budgets'
import { categoryRoutes } from './routes/categories'
import { dashboardRoutes } from './routes/dashboard'
import { goalRoutes } from './routes/goals'
import { recurringRoutes } from './routes/recurring'
import { reportRoutes } from './routes/reports'
import { transactionRoutes } from './routes/transactions'
import { transactionImportRoutes } from './routes/transactions-import'
import { transferRoutes } from './routes/transfers'
import { env } from './utils/env'

const app = new Hono()

// Global middleware
app.use('*', logger())
app.use('*', secureHeaders())
app.use('*', prettyJSON())
app.use(
  '*',
  cors({
    origin: env.ALLOWED_ORIGINS.split(','),
    credentials: true,
    allowMethods: ['GET', 'POST', 'PUT', 'PATCH', 'DELETE'],
    allowHeaders: ['Content-Type', 'Authorization'],
  })
)
app.use('*', rateLimiter({ limit: 100, window: 60 }))

// Health check
app.get('/health', c =>
  c.json({
    status: 'ok',
    version: '1.0.0',
    timestamp: new Date().toISOString(),
  })
)

// API v1
const v1 = new Hono()
v1.route('/auth', authRoutes)
v1.route('/accounts', accountRoutes)
v1.route('/transactions', transactionRoutes)
v1.route('/categories', categoryRoutes)
v1.route('/budgets', budgetRoutes)
v1.route('/goals', goalRoutes)
v1.route('/transfers', transferRoutes)
v1.route('/recurring', recurringRoutes)
v1.route('/dashboard', dashboardRoutes)
v1.route('/reports', reportRoutes)
v1.route('/transaction-import', transactionImportRoutes)

app.route('/api/v1', v1)

// 404 handler
app.notFound(c => c.json({ error: 'Route not found' }, 404))

// Error handler
app.onError(errorHandler)

const port = Number(env.PORT) || 3000
console.log(`🚀 FinAPI running on http://localhost:${port}`)

export default {
  port,
  fetch: app.fetch,
}
