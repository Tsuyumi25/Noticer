import { zValidator } from '@hono/zod-validator'
import { Hono } from 'hono'
import { z } from 'zod'
import { checkinTags, createCheckin } from './checkin.ts'
import { rootUnits, rulesSchema, tagGroupsSchema, valueSpecSchema, type ConfigStore } from './config.ts'
import { buildDashboard } from './dashboard.ts'
import type { DB } from './db.ts'
import { listEvents } from './events.ts'
import { cardInputs, readFacts } from './facts.ts'
import { cardCalendar, reportCounts } from './review.ts'
import { SLEEP_CARD, WAKE_CARD } from './sleep.ts'
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
  facts: z.record(z.string(), z.union([z.number(), z.string()])).optional(),
})

const tagGroupsBody = z.object({ groups: tagGroupsSchema })

const tagValuesBody = z.object({ values: z.record(z.string(), valueSpecSchema) })

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
    const { cardId, note, tags, timeOffset = 0, facts = {} } = c.req.valid('json')
    const config = c.var.store.read()
    const card = config.cards.find((k) => k.id === cardId)
    if (!card) return c.json({ error: `unknown card ${cardId}` }, 404)
    const read = readFacts(config, card, facts, checkinTags(card, tags))
    if (!read.ok) return c.json({ error: read.error }, read.status)
    const trimmed = note.trim()
    const now = Math.floor(Date.now() / 1000)
    const id = createCheckin(c.var.db, card, { note: trimmed === '' ? null : trimmed, picked: tags, facts: read.rows, now, timeOffset })
    return c.json({ id }, 201)
  })
  .get('/cards/:cardId/tags', (c) => {
    const config = c.var.store.read()
    const card = config.cards.find((k) => k.id === c.req.param('cardId'))
    if (!card) return c.json({ error: 'unknown card' }, 404)
    return c.json(cardTags(c.var.db, config, card))
  })
  .get('/cards/:cardId/inputs', (c) => {
    const config = c.var.store.read()
    const card = config.cards.find((k) => k.id === c.req.param('cardId'))
    if (!card) return c.json({ error: 'unknown card' }, 404)
    return c.json(cardInputs(c.var.db, config, card))
  })
  .get('/cards/:cardId/calendar', (c) => {
    const config = c.var.store.read()
    const card = config.cards.find((k) => k.id === c.req.param('cardId'))
    if (!card) return c.json({ error: 'unknown card' }, 404)
    const now = Math.floor(Date.now() / 1000)
    return c.json(cardCalendar(config, card, listEvents(c.var.db, 0, now + 1), now))
  })
  .get('/cards/:cardId/events', zValidator('query', rangeQuery), (c) => {
    const config = c.var.store.read()
    const card = config.cards.find((k) => k.id === c.req.param('cardId'))
    if (!card) return c.json({ error: 'unknown card' }, 404)
    const { from, to } = c.req.valid('query')
    return c.json(listEvents(c.var.db, from, to).filter((e) => reportCounts(card, e)))
  })
  .get('/cards', (c) =>
    c.json(
      c.var.store.read().cards.map((k) => ({ id: k.id, name: k.tag, emoji: k.emoji, builtin: k.id === SLEEP_CARD || k.id === WAKE_CARD })),
    ),
  )
  .get('/cards/:cardId/rules', (c) => {
    const config = c.var.store.read()
    const card = config.cards.find((k) => k.id === c.req.param('cardId'))
    if (!card) return c.json({ error: 'unknown card' }, 404)
    const root = cardRoot(card)
    const tags = cardTags(c.var.db, config, card)
    const specs = config.tagGroups[root]?.values ?? {}
    const units = rootUnits(config, root).map((unit) => ({ unit, decimals: Math.max(...Object.values(specs).filter((s) => s.unit === unit).map((s) => s.decimals)) }))
    const now = Math.floor(Date.now() / 1000)
    return c.json({
      card: { id: card.id, name: card.tag, emoji: card.emoji, tag: card.tag, bucket: card.bucket },
      root,
      rules: card.rules,
      units,
      tags: { groups: tags.groups.map((g) => ({ name: g.name, color: g.color, tags: g.tags.map((t) => t.label) })), ungrouped: tags.ungrouped },
      events: listEvents(c.var.db, 0, now + 1).filter((e) => e.tags.includes(root)),
      now,
    })
  })
  .put('/cards/:cardId/rules', zValidator('json', rulesSchema), (c) => {
    const cardId = c.req.param('cardId')
    const rules = c.req.valid('json')
    const config = c.var.store.read()
    const card = config.cards.find((k) => k.id === cardId)
    if (!card) return c.json({ error: 'unknown card' }, 404)
    const measure = rules.back?.measure
    if (measure && 'unit' in measure && !rootUnits(config, cardRoot(card)).includes(measure.unit)) {
      return c.json({ error: `no tag under card ${cardId}'s root carries ${measure.unit}` }, 422)
    }
    c.var.store.update((raw) => {
      raw.cards.find((k) => k.id === cardId)!.rules = rules
    })
    return c.body(null, 204)
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
  .put('/tag-values/:root', zValidator('json', tagValuesBody), (c) => {
    const root = c.req.param('root')
    const { values } = c.req.valid('json')
    const config = c.var.store.read()
    if (!config.cards.some((k) => cardRoot(k) === root)) return c.json({ error: 'no card uses this root' }, 404)
    const units = new Set(Object.values(values).map((v) => v.unit))
    const measuring = config.cards.find((k) => {
      const m = k.rules.back?.measure
      return cardRoot(k) === root && m !== undefined && 'unit' in m && !units.has(m.unit)
    })
    if (measuring) return c.json({ error: `card ${measuring.id} still measures a unit these values drop` }, 422)
    c.var.store.update((raw) => {
      raw.tagGroups ??= {}
      raw.tagGroups[root] = { ...raw.tagGroups[root], groups: raw.tagGroups[root]?.groups ?? [], values }
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
