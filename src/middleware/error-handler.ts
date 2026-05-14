// src/middleware/error-handler.ts
import { Prisma } from '@prisma/client'
import type { Context } from 'hono'
import { ZodError } from 'zod'

export function errorHandler(err: Error, c: Context) {
  console.error(err)

  if (err instanceof ZodError) {
    return c.json(
      {
        error: 'Validation Error',
        issues: err.flatten().fieldErrors,
      },
      422
    )
  }

  if (err instanceof Prisma.PrismaClientKnownRequestError) {
    if (err.code === 'P2002') {
      return c.json(
        { error: 'Conflict', message: 'Resource already exists' },
        409
      )
    }
    if (err.code === 'P2025') {
      return c.json({ error: 'Not Found', message: 'Resource not found' }, 404)
    }
  }

  return c.json(
    {
      error: 'Internal Server Error',
      message:
        process.env.NODE_ENV === 'development'
          ? err.message
          : 'An unexpected error occurred',
    },
    500
  )
}
