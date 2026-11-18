import { zValidator } from '@hono/zod-validator'
import { Hono } from 'hono'
import { z } from 'zod'
import { createCheckin, needsValue } from './checkin.ts'
import { tagGroupsSchema, type ConfigStore } from './config.ts'
import { buildDashboard } from './dashboard.ts'
import type { DB } from './db.ts'
import { listEvents } from './events.ts'
import { cardRoot, cardTags } from './tags.ts'

type Env = { Variables: { db: DB; store: ConfigStore } }

const rangeQuery = z
  .object({
    from: z.coerce.number().int(),
    to: z.coerce.number().int(),
  })
  .refine((q) => q.from < q.to, { message: 'from must be before to' })

const dashboardQuery = z.object({ at: z.coerce.number().int().optional() })

// A backdated checkin keeps created_at at submit time and moves event_at by a non-positive offset.
const checkinBody = z.object({
  cardId: z.string(),
  note: z.string(),
  tags: z.array(z.string()),
  timeOffset: z.number().int().max(0).optional(),
})

const tagGroupsBody = z.object({ groups: tagGroupsSchema })

const tagSettingsBody = z.object({ hiddenTags: z.array(z.string()), defaultTags: z.array(z.string()) })

const api = new Hono<Env>()
  .basePath('/api')
  .get('/events', zValidator('query', rangeQuery), (c) => {
    const { from, to } = c.req.valid('query')
    return c.json(listEvents(c.var.db, from, to))
  })
  .get('/dashboard', zValidator('query', dashboardQuery), (c) => {
    const now = c.req.valid('query').at ?? Math.floor(Date.now() / 1000)
    return c.json(buildDashboard(c.var.store.read(), listEvents(c.var.db, 0, now + 1), now))
  })
  .post('/checkin', zValidator('json', checkinBody), (c) => {
    const { cardId, note, tags, timeOffset = 0 } = c.req.valid('json')
    const card = c.var.store.read().cards.find((k) => k.id === cardId)
    if (!card) return c.json({ error: `unknown card ${cardId}` }, 404)
    if (needsValue(card)) return c.json({ error: `card ${cardId} needs a value input` }, 422)
    const trimmed = note.trim()
    const now = Math.floor(Date.now() / 1000)
    const id = createCheckin(c.var.db, card, { note: trimmed === '' ? null : trimmed, picked: tags, now, timeOffset })
    return c.json({ id }, 201)
  })
  .get('/cards/:cardId/tags', (c) => {
    const config = c.var.store.read()
    const card = config.cards.find((k) => k.id === c.req.param('cardId'))
    if (!card) return c.json({ error: 'unknown card' }, 404)
    return c.json(cardTags(c.var.db, config, card))
  })
  .put('/cards/:cardId/tag-settings', zValidator('json', tagSettingsBody), (c) => {
    const cardId = c.req.param('cardId')
    const { hiddenTags, defaultTags } = c.req.valid('json')
    if (!c.var.store.read().cards.some((k) => k.id === cardId)) return c.json({ error: 'unknown card' }, 404)
    c.var.store.update((raw) => {
      const card = raw.cards.find((k) => k.id === cardId)!
      card.hiddenTags = hiddenTags
      card.defaultTags = defaultTags
    })
    return c.body(null, 204)
  })
  .put('/tag-groups/:root', zValidator('json', tagGroupsBody), (c) => {
    const root = c.req.param('root')
    const { groups } = c.req.valid('json')
    if (!c.var.store.read().cards.some((k) => cardRoot(k) === root)) return c.json({ error: 'no card uses this root' }, 404)
    c.var.store.update((raw) => {
      raw.tagGroups ??= {}
      raw.tagGroups[root] = { ...raw.tagGroups[root], groups }
    })
    return c.body(null, 204)
  })

export type AppType = typeof api

export function createApp(db: DB, store: ConfigStore): Hono<Env> {
  return new Hono<Env>()
    .use(async (c, next) => {
      c.set('db', db)
      c.set('store', store)
      await next()
    })
    .route('/', api)
}
