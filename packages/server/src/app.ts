import { zValidator } from '@hono/zod-validator'
import { Hono } from 'hono'
import { bodyLimit } from 'hono/body-limit'
import { z } from 'zod'
import { AttachmentFiles, findAttachment, MAX_ATTACHMENT_BYTES, MAX_THUMB_BYTES, saveUpload, sendFile, thumbType, unknownAttachments } from './attachments.ts'
import { checkinTags, createCheckin, deleteCheckin, findEvent, pickedTags, updateCheckin } from './checkin.ts'
import { layoutSchema, rootUnits, rulesSchema, stripSchema, tagGroupsSchema, valueSpecSchema, type Config, type ConfigStore } from './config.ts'
import { PURE_CARD } from './pure.ts'
import { buildDashboard } from './dashboard.ts'
import type { DB } from './db.ts'
import { dayCounts, listConflicts, listEvents, listMedia, searchEvents } from './events.ts'
import { cardInputs, readFacts, type FactRow } from './facts.ts'
import { cardCalendar, reportCounts } from './review.ts'
import { analyzeSleep } from './sleep-analysis.ts'
import { blocksOf, sleepEvents, SLEEP_CARD, WAKE_CARD } from './sleep.ts'
import { allTags, cardTags, rootTags } from './tags.ts'

type Env = { Variables: { db: DB; store: ConfigStore; files: AttachmentFiles } }

const rangeQuery = z
  .object({
    from: z.coerce.number().int(),
    to: z.coerce.number().int(),
  })
  .refine((q) => q.from < q.to, { message: 'from must be before to' })

const dashboardQuery = z.object({ at: z.coerce.number().int().optional() })

const searchQuery = z.object({
  q: z.string().trim().min(1),
  limit: z.coerce.number().int().min(1).max(200).default(50),
  /** The `next` of the page before: `eventAt:id`. */
  after: z
    .string()
    .regex(/^-?\d+:\d+$/)
    .transform((s) => {
      const [eventAt, id] = s.split(':').map(Number)
      return { eventAt: eventAt!, id: id! }
    })
    .optional(),
})

const sleepAnalysisQuery = z.object({
  days: z.coerce.number().int().min(30).max(730).default(365),
  at: z.coerce.number().int().optional(),
})

// A backdated checkin keeps created_at at submit time and moves event_at by a non-positive offset.
const checkinBody = z.object({
  cardId: z.string(),
  note: z.string(),
  tags: z.array(z.string()),
  timeOffset: z.number().int().max(0).optional(),
  facts: z.record(z.string(), z.union([z.number(), z.string()])).optional(),
  /** Uploaded attachment ids, in the order shown. */
  attachments: z.array(z.string()).default([]),
})

// An edited event keeps its created_at; the new time can be anywhere up to now.
const eventBody = z.object({
  note: z.string(),
  tags: z.array(z.string()),
  eventAt: z.number().int(),
  facts: z.record(z.string(), z.union([z.number(), z.string()])).optional(),
  /** The event's attachments after the edit, in order; ones left out are deleted. */
  attachments: z.array(z.string()).default([]),
})

const uploadForm = z.object({
  file: z.instanceof(File).refine((f) => f.size <= MAX_ATTACHMENT_BYTES, { message: 'file too large' }),
  thumb: z
    .instanceof(File)
    .refine((f) => f.type.startsWith('image/') && f.size <= MAX_THUMB_BYTES, { message: 'thumbnail must be a small image' })
    .optional(),
  width: z.coerce.number().int().positive().optional(),
  height: z.coerce.number().int().positive().optional(),
})

const eventParam = z.object({ id: z.coerce.number().int() })

const tagGroupsBody = z.object({ groups: tagGroupsSchema })

const tagValuesBody = z.object({ values: z.record(z.string(), valueSpecSchema) })

/** A card from a chosen root and the tags it starts with picked; `copyOf` names a card with that root whose hidden tags, choices and rules it takes. */
const newCardBody = z.object({
  name: z.string().trim().min(1),
  emoji: z.string().trim().min(1),
  root: z.string().trim().min(1),
  defaultTags: z.array(z.string()),
  copyOf: z.string().optional(),
})

const cardIdentityBody = z.object({ name: z.string().trim().min(1), emoji: z.string().trim().min(1) })

const tagSettingsBody = z.object({ hiddenTags: z.array(z.string()), defaultTags: z.array(z.string()) })

const tagNoteBody = z.object({ note: z.string() })

type Write = { ok: true; tags: string[]; rows: FactRow[]; choiceKeys: string[] } | { ok: false; status: 400 | 404 | 422; error: string }

/** What a checkin through this card writes; a quick note writes only the tags picked and takes no values. */
function resolveWrite(config: Config, cardId: string, tags: string[], facts: Record<string, number | string>): Write {
  if (cardId === PURE_CARD) {
    if (Object.keys(facts).length > 0) return { ok: false, status: 400, error: 'a quick note takes no values' }
    return { ok: true, tags: pickedTags(tags), rows: [], choiceKeys: [] }
  }
  const card = config.cards.find((k) => k.id === cardId)
  if (!card) return { ok: false, status: 404, error: `unknown card ${cardId}` }
  const written = checkinTags(card, tags)
  const read = readFacts(config, card, facts, written)
  if (!read.ok) return read
  return { ok: true, tags: written, rows: read.rows, choiceKeys: card.facts ?? [] }
}

const api = new Hono<Env>()
  .basePath('/api')
  .get('/events', zValidator('query', rangeQuery), (c) => {
    const { from, to } = c.req.valid('query')
    return c.json(listEvents(c.var.db, from, to))
  })
  .get('/search', zValidator('query', searchQuery), (c) => {
    const { q, limit, after } = c.req.valid('query')
    return c.json(searchEvents(c.var.db, q, limit, after ?? null))
  })
  .get('/media', (c) => c.json(listMedia(c.var.db)))
  .get('/days', (c) => c.json(dayCounts(c.var.db)))
  .get('/conflicts', (c) => c.json(listConflicts(c.var.db)))
  .get('/dashboard', zValidator('query', dashboardQuery), (c) => {
    const now = c.req.valid('query').at ?? Math.floor(Date.now() / 1000)
    return c.json(buildDashboard(c.var.store.read(), listEvents(c.var.db, 0, now + 1), now))
  })
  .get('/sleep/analysis', zValidator('query', sleepAnalysisQuery), (c) => {
    const { days, at } = c.req.valid('query')
    const now = at ?? Math.floor(Date.now() / 1000)
    const events = listEvents(c.var.db, now - days * 86400, now + 1)
    return c.json(analyzeSleep(blocksOf(sleepEvents(events, now)), now))
  })
  .post('/checkin', zValidator('json', checkinBody), (c) => {
    const { cardId, note, tags, timeOffset = 0, facts = {}, attachments } = c.req.valid('json')
    const write = resolveWrite(c.var.store.read(), cardId, tags, facts)
    if (!write.ok) return c.json({ error: write.error }, write.status)
    const unknown = unknownAttachments(c.var.db, attachments, null)
    if (unknown.length) return c.json({ error: `unknown attachments ${unknown.join(', ')}` }, 400)
    const trimmed = note.trim()
    const now = Math.floor(Date.now() / 1000)
    const id = createCheckin(c.var.db, c.var.files, cardId, {
      note: trimmed === '' ? null : trimmed,
      tags: write.tags,
      facts: write.rows,
      now,
      timeOffset,
      attachments,
    })
    return c.json({ id }, 201)
  })
  .put('/events/:id', zValidator('param', eventParam), zValidator('json', eventBody), (c) => {
    const { id } = c.req.valid('param')
    const { note, tags, eventAt, facts = {}, attachments } = c.req.valid('json')
    const stored = findEvent(c.var.db, id)
    if (!stored) return c.json({ error: `unknown event ${id}` }, 404)
    if (eventAt > Math.floor(Date.now() / 1000)) return c.json({ error: 'eventAt is in the future' }, 400)
    const write = resolveWrite(c.var.store.read(), stored.cardId, tags, facts)
    if (!write.ok) return c.json({ error: write.error }, write.status)
    const unknown = unknownAttachments(c.var.db, attachments, id)
    if (unknown.length) return c.json({ error: `unknown attachments ${unknown.join(', ')}` }, 400)
    const trimmed = note.trim()
    updateCheckin(c.var.db, c.var.files, id, write.choiceKeys, {
      note: trimmed === '' ? null : trimmed,
      tags: write.tags,
      facts: write.rows,
      timeOffset: eventAt - stored.createdAt,
      attachments,
    })
    return c.body(null, 204)
  })
  .delete('/events/:id', zValidator('param', eventParam), (c) => {
    if (!deleteCheckin(c.var.db, c.var.files, c.req.valid('param').id)) return c.json({ error: 'unknown event' }, 404)
    return c.body(null, 204)
  })
  .post(
    '/attachments',
    bodyLimit({ maxSize: MAX_ATTACHMENT_BYTES + MAX_THUMB_BYTES + 64 * 1024, onError: (c) => c.json({ error: 'file too large' }, 413) }),
    zValidator('form', uploadForm),
    async (c) => {
      const { file, thumb, width, height } = c.req.valid('form')
      const attachment = saveUpload(c.var.db, c.var.files, {
        name: file.name,
        type: file.type,
        bytes: new Uint8Array(await file.arrayBuffer()),
        ...(thumb ? { thumb: new Uint8Array(await thumb.arrayBuffer()) } : {}),
        ...(width && height ? { width, height } : {}),
        now: Math.floor(Date.now() / 1000),
      })
      return c.json(attachment, 201)
    },
  )
  .get('/attachments/:id', (c) => {
    const attachment = findAttachment(c.var.db, c.req.param('id'))
    if (!attachment) return c.json({ error: 'unknown attachment' }, 404)
    return sendFile(c, c.var.files.file(attachment.id), attachment.type, attachment.name)
  })
  .get('/attachments/:id/thumb', (c) => {
    const attachment = findAttachment(c.var.db, c.req.param('id'))
    if (!attachment?.thumb) return c.json({ error: 'no thumbnail' }, 404)
    const path = c.var.files.thumb(attachment.id)
    return sendFile(c, path, thumbType(path))
  })
  .get('/pure', (c) => {
    const config = c.var.store.read()
    const roots = [...new Map(config.cards.map((k) => [k.root, config.tagGroups[k.root]?.emoji || k.emoji])).entries()]
    return c.json({ roots: roots.map(([tag, emoji]) => ({ tag, emoji })), tags: allTags(c.var.db) })
  })
  .get('/roots/:tag/tags', (c) => c.json(rootTags(c.var.db, c.var.store.read(), c.req.param('tag'))))
  .get('/config', (c) => c.json(c.var.store.read()))
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
      c.var.store
        .read()
        .cards.map((k) => ({ id: k.id, name: k.name, emoji: k.emoji, root: k.root, defaultTags: k.defaultTags ?? [], builtin: k.id === SLEEP_CARD || k.id === WAKE_CARD })),
    ),
  )
  .post('/cards', zValidator('json', newCardBody), (c) => {
    const { name, emoji, root, defaultTags, copyOf } = c.req.valid('json')
    const config = c.var.store.read()
    const source = copyOf === undefined ? undefined : config.cards.find((k) => k.id === copyOf)
    if (copyOf !== undefined && !source) return c.json({ error: `unknown card ${copyOf}` }, 404)
    if (source && source.root !== root) return c.json({ error: 'a copy keeps the root of the card it copies' }, 400)
    const taken = new Set([PURE_CARD, ...config.cards.map((k) => k.id)])
    const base = `card-${Date.now().toString(36)}`
    let id = base
    for (let n = 2; taken.has(id); n++) id = `${base}-${n}`
    const defaults = pickedTags(defaultTags).filter((t) => t !== root)
    c.var.store.update((raw) => {
      raw.cards.push({
        id,
        name,
        root,
        emoji,
        ...(defaults.length ? { defaultTags: defaults } : {}),
        ...(source?.hiddenTags?.length ? { hiddenTags: source.hiddenTags } : {}),
        ...(source?.facts ? { facts: source.facts } : {}),
        rules: source ? structuredClone(source.rules) : { find: { match: 'all', blocks: [] }, now: {}, back: null },
      })
    })
    return c.json({ id }, 201)
  })
  .put('/cards/:cardId', zValidator('json', cardIdentityBody), (c) => {
    const cardId = c.req.param('cardId')
    const { name, emoji } = c.req.valid('json')
    if (!c.var.store.read().cards.some((k) => k.id === cardId)) return c.json({ error: 'unknown card' }, 404)
    c.var.store.update((raw) => {
      Object.assign(raw.cards.find((k) => k.id === cardId)!, { name, emoji })
    })
    return c.body(null, 204)
  })
  .delete('/cards/:cardId', (c) => {
    const cardId = c.req.param('cardId')
    if (cardId === SLEEP_CARD || cardId === WAKE_CARD) return c.json({ error: 'the sleep cards stay' }, 400)
    const config = c.var.store.read()
    if (!config.cards.some((k) => k.id === cardId)) return c.json({ error: 'unknown card' }, 404)
    const { [cardId]: pinned, ...pins } = config.layout.pins
    const moved = c.var.db.transaction(() => {
      const changes = c.var.db.prepare('UPDATE events SET card_id = ? WHERE card_id = ?').run(PURE_CARD, cardId).changes
      c.var.store.update((raw) => {
        raw.cards = raw.cards.filter((k) => k.id !== cardId)
        if (pinned) raw.layout = { ...config.layout, pins }
      })
      return changes
    })()
    return c.json({ moved })
  })
  .get('/cards/:cardId/rules', (c) => {
    const config = c.var.store.read()
    const card = config.cards.find((k) => k.id === c.req.param('cardId'))
    if (!card) return c.json({ error: 'unknown card' }, 404)
    const root = card.root
    const tags = cardTags(c.var.db, config, card)
    const specs = config.tagGroups[root]?.values ?? {}
    const units = rootUnits(config, root).map((unit) => ({ unit, decimals: Math.max(...Object.values(specs).filter((s) => s.unit === unit).map((s) => s.decimals)) }))
    const now = Math.floor(Date.now() / 1000)
    return c.json({
      card: { id: card.id, name: card.name, emoji: card.emoji, root },
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
    if (measure && 'unit' in measure && !rootUnits(config, card.root).includes(measure.unit)) {
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
  .put('/tag-notes/:tag', zValidator('json', tagNoteBody), (c) => {
    const tag = c.req.param('tag')
    const note = c.req.valid('json').note.trim()
    const notes = { ...c.var.store.read().tagNotes }
    if (note === '') delete notes[tag]
    else notes[tag] = note
    c.var.store.update((raw) => {
      raw.tagNotes = notes
    })
    return c.body(null, 204)
  })
  .put('/tag-groups/:root', zValidator('json', tagGroupsBody), (c) => {
    const root = c.req.param('root')
    const { groups } = c.req.valid('json')
    if (!c.var.store.read().cards.some((k) => k.root === root)) return c.json({ error: 'no card uses this root' }, 404)
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
    if (!config.cards.some((k) => k.root === root)) return c.json({ error: 'no card uses this root' }, 404)
    const units = new Set(Object.values(values).map((v) => v.unit))
    const measuring = config.cards.find((k) => {
      const m = k.rules.back?.measure
      return k.root === root && m !== undefined && 'unit' in m && !units.has(m.unit)
    })
    if (measuring) return c.json({ error: `card ${measuring.id} still measures a unit these values drop` }, 422)
    c.var.store.update((raw) => {
      raw.tagGroups ??= {}
      raw.tagGroups[root] = { ...raw.tagGroups[root], groups: raw.tagGroups[root]?.groups ?? [], values }
    })
    return c.body(null, 204)
  })
  .put('/layout', zValidator('json', layoutSchema), (c) => {
    const layout = c.req.valid('json')
    c.var.store.update((raw) => {
      raw.layout = layout
    })
    return c.body(null, 204)
  })
  .put('/strip', zValidator('json', stripSchema), (c) => {
    const strip = c.req.valid('json')
    c.var.store.update((raw) => {
      raw.strip = strip
    })
    return c.body(null, 204)
  })

export type AppType = typeof api

export function createApp(db: DB, store: ConfigStore, files: AttachmentFiles): Hono<Env> {
  return new Hono<Env>()
    .use(async (c, next) => {
      c.set('db', db)
      c.set('store', store)
      c.set('files', files)
      await next()
    })
    .route('/', api)
}
