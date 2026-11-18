import { zValidator } from '@hono/zod-validator'
import { Hono } from 'hono'
import { z } from 'zod'
import { createCheckin, needsValue } from './checkin.ts'
import type { Config } from './config.ts'
import { buildDashboard } from './dashboard.ts'
import type { DB } from './db.ts'
import { listEvents } from './events.ts'

type Env = { Variables: { db: DB; config: () => Config } }

const rangeQuery = z
  .object({
    from: z.coerce.number().int(),
    to: z.coerce.number().int(),
  })
  .refine((q) => q.from < q.to, { message: 'from must be before to' })

const dashboardQuery = z.object({ at: z.coerce.number().int().optional() })

const checkinBody = z.object({ cardId: z.string(), note: z.string() })

const api = new Hono<Env>()
  .basePath('/api')
  .get('/events', zValidator('query', rangeQuery), (c) => {
    const { from, to } = c.req.valid('query')
    return c.json(listEvents(c.var.db, from, to))
  })
  .get('/dashboard', zValidator('query', dashboardQuery), (c) => {
    const now = c.req.valid('query').at ?? Math.floor(Date.now() / 1000)
    return c.json(buildDashboard(c.var.config(), listEvents(c.var.db, 0, now + 1), now))
  })
  .post('/checkin', zValidator('json', checkinBody), (c) => {
    const { cardId, note } = c.req.valid('json')
    const card = c.var.config().cards.find((k) => k.id === cardId)
    if (!card) return c.json({ error: `unknown card ${cardId}` }, 404)
    if (needsValue(card)) return c.json({ error: `card ${cardId} needs a value input` }, 422)
    const trimmed = note.trim()
    const id = createCheckin(c.var.db, card, trimmed === '' ? null : trimmed, Math.floor(Date.now() / 1000))
    return c.json({ id }, 201)
  })

export type AppType = typeof api

export function createApp(db: DB, config: () => Config): Hono<Env> {
  return new Hono<Env>()
    .use(async (c, next) => {
      c.set('db', db)
      c.set('config', config)
      await next()
    })
    .route('/', api)
}
