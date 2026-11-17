import { zValidator } from '@hono/zod-validator'
import { Hono } from 'hono'
import { z } from 'zod'
import type { DB } from './db.ts'
import { listEvents } from './events.ts'

type Env = { Variables: { db: DB } }

const rangeQuery = z
  .object({
    from: z.coerce.number().int(),
    to: z.coerce.number().int(),
  })
  .refine((q) => q.from < q.to, { message: 'from must be before to' })

const api = new Hono<Env>().basePath('/api').get('/events', zValidator('query', rangeQuery), (c) => {
  const { from, to } = c.req.valid('query')
  return c.json(listEvents(c.var.db, from, to))
})

export type AppType = typeof api

export function createApp(db: DB): Hono<Env> {
  return new Hono<Env>()
    .use(async (c, next) => {
      c.set('db', db)
      await next()
    })
    .route('/', api)
}
