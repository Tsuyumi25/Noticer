import { existsSync, mkdtempSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { describe, expect, it } from 'vitest'
import { z } from 'zod'
import { createApp } from './app.ts'
import { AttachmentFiles } from './attachments.ts'
import { emptyConfig, memoryStore } from './config.ts'
import { openDb, type DB } from './db.ts'
import { listEvents } from './events.ts'
import type { CardTags } from './tags.ts'

const unjudged = { find: { match: 'all', blocks: [] }, now: {}, back: null } as const
const config = {
  ...emptyConfig,
  cards: [
    { id: 'skincare', name: '護膚', root: '護膚', emoji: '🧴', rules: unjudged },
    { id: 'sunscreen', name: '防曬', root: '護膚', emoji: '🌞', rules: unjudged, defaultTags: ['防曬'], hiddenTags: ['化妝水'] },
    { id: 'weight', name: '體重', root: '體重', emoji: '⚖️', rules: unjudged },
    { id: 'practice', name: '練習', root: '練習', emoji: '🎹', rules: unjudged, facts: ['心情'] },
  ],
  tagGroups: {
    護膚: { emoji: '🧴', groups: [{ name: '保養項目', color: '#3b82f6', tags: [{ label: '化妝水', emoji: '🧴' }, { label: '防曬', emoji: '🌞' }] }] },
    體重: { groups: [], values: { 體重: { unit: 'kg', decimals: 1 } } },
    練習: {
      groups: [{ name: '樂器', color: '#3b82f6', tags: [{ label: '鋼琴', emoji: '' }, { label: '吉他', emoji: '' }] }],
      values: { 鋼琴: { unit: '分鐘', decimals: 0 }, 吉他: { unit: '分鐘', decimals: 0 } },
    },
  },
  factInputs: {
    心情: { kind: 'choice', name: '心情', options: [{ value: '🙂', label: '不錯' }], required: true },
  },
}

function setup() {
  const db = openDb(':memory:')
  const store = memoryStore(config)
  const files = new AttachmentFiles(mkdtempSync(join(tmpdir(), 'noticer-')))
  const app = createApp(db, store, files)
  const send = (method: string, path: string, body?: unknown) =>
    app.request(path, { method, headers: { 'content-type': 'application/json' }, body: body === undefined ? undefined : JSON.stringify(body) })
  return { db, store, files, send, app }
}

const allEvents = (db: DB) => listEvents(db, 0, Number.MAX_SAFE_INTEGER)

describe('checkin', () => {
  it("saves the card's root plus the picked tags, once each, leaving out a default taken off", async () => {
    const { db, send } = setup()
    await send('POST', '/api/checkin', { cardId: 'sunscreen', note: '  早上 ', tags: ['乳液', '護膚', ' '] })
    expect(allEvents(db)[0]).toMatchObject({ cardId: 'sunscreen', tags: ['護膚', '乳液'], note: '早上', timeOffset: 0 })
  })

  it('backdates event_at by the offset and refuses times in the future', async () => {
    const { db, send } = setup()
    const before = Math.floor(Date.now() / 1000)
    await send('POST', '/api/checkin', { cardId: 'skincare', note: '', tags: [], timeOffset: -3 * 3600 })
    const [event] = allEvents(db)
    expect(event?.timeOffset).toBe(-3 * 3600)
    expect(event!.eventAt - (before - 3 * 3600)).toBeLessThanOrEqual(1)
    expect((await send('POST', '/api/checkin', { cardId: 'skincare', note: '', tags: [], timeOffset: 60 })).status).toBe(400)
    expect(allEvents(db)).toHaveLength(1)
  })

  it('reuses an existing tag instead of creating a duplicate', async () => {
    const { db, send } = setup()
    await send('POST', '/api/checkin', { cardId: 'skincare', note: '', tags: [] })
    await send('POST', '/api/checkin', { cardId: 'skincare', note: '', tags: [] })
    expect(db.prepare('SELECT COUNT(*) AS n FROM tags_dict').get()).toEqual({ n: 1 })
  })

  it('refuses unknown cards and a missing required choice', async () => {
    const { db, send } = setup()
    expect((await send('POST', '/api/checkin', { cardId: 'nope', note: '', tags: [] })).status).toBe(404)
    expect((await send('POST', '/api/checkin', { cardId: 'practice', note: '', tags: [] })).status).toBe(422)
    expect(allEvents(db)).toEqual([])
  })
})

describe('new cards', () => {
  const createdId = async (res: Response) => z.object({ id: z.string() }).parse(await res.json()).id

  it('lock in the chosen root and start with the other tags picked, judging nothing yet', async () => {
    const { db, store, send } = setup()
    const res = await send('POST', '/api/cards', { name: '陶藝', emoji: '🏺', root: '陶藝', defaultTags: ['陶藝', ' 拉坯', '拉坯', ''] })
    expect(res.status).toBe(201)
    const id = await createdId(res)
    expect(store.read().cards.at(-1)).toEqual({ id, name: '陶藝', emoji: '🏺', root: '陶藝', defaultTags: ['拉坯'], rules: unjudged })
    await send('POST', '/api/checkin', { cardId: id, note: '', tags: [] })
    expect(allEvents(db)[0]).toMatchObject({ cardId: id, tags: ['陶藝'] })
  })

  it("copy a card with the same root: its hidden tags, choices and rules come along, and a root's list stays shared", async () => {
    const { store, send } = setup()
    const judged = { ...unjudged, now: { late: { warn: 3600, danger: 7200 } } }
    await send('PUT', '/api/cards/practice/rules', judged)
    const id = await createdId(await send('POST', '/api/cards', { name: '練吉他', emoji: '🎸', root: '練習', defaultTags: ['吉他'], copyOf: 'practice' }))
    expect(store.read().cards.find((k) => k.id === id)).toMatchObject({ facts: ['心情'], rules: judged, defaultTags: ['吉他'] })
    const nightId = await createdId(await send('POST', '/api/cards', { name: '晚上防曬', emoji: '🌙', root: '護膚', defaultTags: [], copyOf: 'sunscreen' }))
    const night = store.read().cards.find((k) => k.id === nightId)
    expect(night).toMatchObject({ hiddenTags: ['化妝水'] })
    expect(night).not.toHaveProperty('defaultTags')
    expect(store.read().tagGroups['護膚']?.groups).toHaveLength(1)
  })

  it('refuse a copy under another root, an unknown card to copy, and a blank name or root', async () => {
    const { store, send } = setup()
    expect((await send('POST', '/api/cards', { name: 'x', emoji: '🙂', root: '體重', defaultTags: [], copyOf: 'practice' })).status).toBe(400)
    expect((await send('POST', '/api/cards', { name: 'x', emoji: '🙂', root: '體重', defaultTags: [], copyOf: 'nope' })).status).toBe(404)
    expect((await send('POST', '/api/cards', { name: ' ', emoji: '🙂', root: '體重', defaultTags: [] })).status).toBe(400)
    expect((await send('POST', '/api/cards', { name: 'x', emoji: '🙂', root: '', defaultTags: [] })).status).toBe(400)
    expect(store.read().cards).toHaveLength(4)
  })
})

describe('changing a card', () => {
  it('renames and re-emojis a card without touching its root or rules, and refuses a blank name or an unknown card', async () => {
    const { store, send } = setup()
    expect((await send('PUT', '/api/cards/sunscreen', { name: ' 早晚防曬 ', emoji: '🧴' })).status).toBe(204)
    expect(store.read().cards.find((k) => k.id === 'sunscreen')).toMatchObject({ name: '早晚防曬', emoji: '🧴', root: '護膚', defaultTags: ['防曬'] })
    expect((await send('PUT', '/api/cards/sunscreen', { name: ' ', emoji: '🧴' })).status).toBe(400)
    expect((await send('PUT', '/api/cards/nope', { name: 'x', emoji: '🙂' })).status).toBe(404)
    expect(store.read().cards.find((k) => k.id === 'sunscreen')?.name).toBe('早晚防曬')
  })

  it("deletes a card but keeps its records as quick notes with their tags, so another card on the same root still counts them", async () => {
    const { db, store, send } = setup()
    await send('POST', '/api/checkin', { cardId: 'sunscreen', note: '早上', tags: ['防曬'] })
    await send('POST', '/api/checkin', { cardId: 'skincare', note: '', tags: [] })
    await send('PUT', '/api/layout', { ...store.read().layout, pins: { sunscreen: { side: 'left', fx: 0, fy: 0 }, skincare: { side: 'left', fx: 1, fy: 0 } } })
    const res = await send('DELETE', '/api/cards/sunscreen')
    expect(await res.json()).toEqual({ moved: 1 })
    expect(store.read().cards.map((k) => k.id)).toEqual(['skincare', 'weight', 'practice'])
    expect(Object.keys(store.read().layout.pins)).toEqual(['skincare'])
    expect(allEvents(db).map((e) => [e.cardId, e.tags, e.note])).toEqual([
      ['pure', ['護膚', '防曬'], '早上'],
      ['skincare', ['護膚'], null],
    ])
    const calendar = await (await send('GET', '/api/cards/skincare/calendar')).json()
    expect(calendar.days.at(-1)).toMatchObject({ value: 2, state: 'logged' })
    expect((await send('DELETE', '/api/cards/sunscreen')).status).toBe(404)
  })
})

describe('editing an event', () => {
  async function recorded() {
    const ctx = setup()
    await ctx.send('POST', '/api/checkin', { cardId: 'practice', note: '早上', tags: ['鋼琴'], facts: { '鋼琴:分鐘': 20, 心情: '🙂' } })
    return { ...ctx, event: allEvents(ctx.db)[0]! }
  }

  it('replaces note, time, tags, values and choices, keeping the card tag', async () => {
    const { db, send, event } = await recorded()
    const eventAt = event.eventAt - 5 * 3600
    const res = await send('PUT', `/api/events/${event.id}`, { note: ' ', tags: ['吉他'], eventAt, facts: { '吉他:分鐘': 15, 心情: '🙂' } })
    expect(res.status).toBe(204)
    expect(allEvents(db)).toEqual([
      expect.objectContaining({
        id: event.id,
        eventAt,
        timeOffset: -5 * 3600,
        note: null,
        tags: ['練習', '心情', '吉他'],
        facts: { '吉他:分鐘': 15, 心情: '🙂' },
      }),
    ])
  })

  it('refuses a future time, values of tags the event lacks, and unknown events, leaving the event as it was', async () => {
    const { db, send, event } = await recorded()
    const body = { note: '', tags: ['鋼琴'], eventAt: event.eventAt, facts: { 心情: '🙂' } }
    expect((await send('PUT', `/api/events/${event.id}`, { ...body, eventAt: event.eventAt + 3600 })).status).toBe(400)
    expect((await send('PUT', `/api/events/${event.id}`, { ...body, facts: { '吉他:分鐘': 5, 心情: '🙂' } })).status).toBe(400)
    expect((await send('PUT', `/api/events/${event.id + 1}`, body)).status).toBe(404)
    expect(allEvents(db)).toEqual([event])
  })

  it('deletes an event with its tags and values, once', async () => {
    const { db, send, event } = await recorded()
    expect((await send('DELETE', `/api/events/${event.id}`)).status).toBe(204)
    expect((await send('DELETE', `/api/events/${event.id}`)).status).toBe(404)
    expect(allEvents(db)).toEqual([])
    expect(db.prepare('SELECT (SELECT COUNT(*) FROM checkin_tags) + (SELECT COUNT(*) FROM tag_values) AS n').get()).toEqual({ n: 0 })
  })
})

describe('events in conflict', () => {
  async function conflicted() {
    const ctx = setup()
    await ctx.send('POST', '/api/checkin', { cardId: 'practice', note: '早上', tags: ['鋼琴'], facts: { '鋼琴:分鐘': 20, 心情: '🙂' } })
    const event = allEvents(ctx.db)[0]!
    const insert = ctx.db.prepare(
      'INSERT INTO event_versions (event_id, device, edited_at, shown, deleted, event_at, note, tags, facts) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)',
    )
    insert.run(event.id, '平板', 200, 0, 1, null, null, '[]', '{}')
    insert.run(event.id, '手機', 100, 1, 0, event.eventAt, '早上', '["練習","鋼琴"]', '{"鋼琴:分鐘":20,"心情":"🙂"}')
    return { ...ctx, event }
  }
  const conflicts = async (send: ReturnType<typeof setup>['send']) => (await send('GET', '/api/conflicts')).json() as Promise<{ id: number; versions: unknown[] }[]>

  it('carry every version, the shown one first, and are listed until a save settles them', async () => {
    const { db, send, event } = await conflicted()
    expect((await conflicts(send)).map((e) => e.id)).toEqual([event.id])
    expect(allEvents(db)[0]!.versions).toEqual([
      expect.objectContaining({ device: '手機', shown: true, deleted: false, note: '早上', tags: ['練習', '鋼琴'], facts: { '鋼琴:分鐘': 20, 心情: '🙂' } }),
      expect.objectContaining({ device: '平板', shown: false, deleted: true, eventAt: null }),
    ])
    await send('PUT', `/api/events/${event.id}`, { note: '早上', tags: ['鋼琴'], eventAt: event.eventAt, facts: { '鋼琴:分鐘': 25, 心情: '🙂' } })
    expect(await conflicts(send)).toEqual([])
    expect(allEvents(db)[0]!.versions).toEqual([])
  })

  it('go away with the event when it is deleted', async () => {
    const { db, send, event } = await conflicted()
    await send('DELETE', `/api/events/${event.id}`)
    expect(await conflicts(send)).toEqual([])
    expect(db.prepare('SELECT COUNT(*) AS n FROM event_versions').get()).toEqual({ n: 0 })
  })
})

describe('attachments', () => {
  const attachmentSchema = z.object({ id: z.string(), name: z.string(), type: z.string(), size: z.number(), thumb: z.boolean(), width: z.number().nullable(), height: z.number().nullable() })
  async function upload(app: ReturnType<typeof setup>['app'], name: string, type: string, body: string, thumb?: string, size?: { width: number; height: number }) {
    const form = new FormData()
    form.set('file', new File([body], name, { type }))
    if (thumb !== undefined) form.set('thumb', new File([thumb], 'thumb.jpg', { type: 'image/jpeg' }))
    if (size) {
      form.set('width', String(size.width))
      form.set('height', String(size.height))
    }
    const res = await app.request('/api/attachments', { method: 'POST', body: form })
    expect(res.status).toBe(201)
    return attachmentSchema.parse(await res.json())
  }

  it('keep any file with a checkin, in order, and send it back whole or by byte range', async () => {
    const { db, send, app } = setup()
    const photo = await upload(app, '午餐.jpg', 'image/jpeg', 'jpeg-bytes', 'small', { width: 1200, height: 900 })
    const archive = await upload(app, '收據.zip', 'application/zip', '0123456789')
    await send('POST', '/api/checkin', { cardId: 'skincare', note: '', tags: [], attachments: [archive.id, photo.id] })
    expect(allEvents(db)[0]?.attachments).toEqual([
      { id: archive.id, name: '收據.zip', type: 'application/zip', size: 10, thumb: false, width: null, height: null },
      { id: photo.id, name: '午餐.jpg', type: 'image/jpeg', size: 10, thumb: true, width: 1200, height: 900 },
    ])
    const whole = await app.request(`/api/attachments/${photo.id}`)
    expect(whole.headers.get('content-type')).toBe('image/jpeg')
    expect(whole.headers.get('content-disposition')).toMatch(/^inline/)
    expect(await whole.text()).toBe('jpeg-bytes')
    expect(await (await app.request(`/api/attachments/${photo.id}/thumb`)).text()).toBe('small')
    const part = await app.request(`/api/attachments/${archive.id}`, { headers: { range: 'bytes=2-5' } })
    expect(part.status).toBe(206)
    expect(part.headers.get('content-range')).toBe('bytes 2-5/10')
    expect(part.headers.get('content-disposition')).toMatch(/^attachment/)
    expect(await part.text()).toBe('2345')
  })

  it('offer a page the browser could run as a download, never in place', async () => {
    const { app } = setup()
    const page = await upload(app, 'x.html', 'text/html', '<script>1</script>')
    const res = await app.request(`/api/attachments/${page.id}`)
    expect(res.headers.get('content-disposition')).toMatch(/^attachment/)
    expect(res.headers.get('x-content-type-options')).toBe('nosniff')
  })

  it('delete the files an edit leaves out or a deleted event carried', async () => {
    const { db, files, send, app } = setup()
    const kept = await upload(app, 'a.txt', 'text/plain', 'a')
    const dropped = await upload(app, 'b.txt', 'text/plain', 'b')
    await send('POST', '/api/checkin', { cardId: 'skincare', note: '', tags: [], attachments: [kept.id, dropped.id] })
    const [event] = allEvents(db)
    await send('PUT', `/api/events/${event!.id}`, { note: '', tags: [], eventAt: event!.eventAt, attachments: [kept.id] })
    expect(allEvents(db)[0]?.attachments.map((a) => a.id)).toEqual([kept.id])
    expect((await app.request(`/api/attachments/${dropped.id}`)).status).toBe(404)
    expect(existsSync(files.file(dropped.id))).toBe(false)
    await send('DELETE', `/api/events/${event!.id}`)
    expect(existsSync(files.file(kept.id))).toBe(false)
  })

  it("refuse ids that are no upload or already another event's", async () => {
    const { db, send, app } = setup()
    const taken = await upload(app, 'a.txt', 'text/plain', 'a')
    await send('POST', '/api/checkin', { cardId: 'skincare', note: '', tags: [], attachments: [taken.id] })
    expect((await send('POST', '/api/checkin', { cardId: 'skincare', note: '', tags: [], attachments: [taken.id] })).status).toBe(400)
    expect((await send('POST', '/api/checkin', { cardId: 'skincare', note: '', tags: [], attachments: ['nope'] })).status).toBe(400)
    expect(allEvents(db)).toHaveLength(1)
  })

  it('list every picture and video, newest event first, leaving other files out', async () => {
    const { send, app } = setup()
    const older = await upload(app, 'a.jpg', 'image/jpeg', 'a', 't')
    const zip = await upload(app, 'b.zip', 'application/zip', 'b')
    await send('POST', '/api/checkin', { cardId: 'skincare', note: '', tags: [], timeOffset: -3600, attachments: [older.id, zip.id] })
    const clip = await upload(app, 'c.webm', 'video/webm', 'c')
    const photo = await upload(app, 'd.png', 'image/png', 'd')
    await send('POST', '/api/checkin', { cardId: 'skincare', note: '', tags: [], attachments: [clip.id, photo.id] })
    const media = z.array(attachmentSchema.extend({ eventId: z.number(), eventAt: z.number() })).parse(await (await send('GET', '/api/media')).json())
    expect(media.map((m) => m.name)).toEqual(['c.webm', 'd.png', 'a.jpg'])
  })
})

describe('search', () => {
  const pageSchema = z.object({
    events: z.array(z.object({ note: z.string().nullable(), tags: z.array(z.string()) })),
    total: z.number().nullable(),
    next: z.object({ eventAt: z.number(), id: z.number() }).nullable(),
  })
  const page = async (send: ReturnType<typeof setup>['send'], query: string) => pageSchema.parse(await (await send('GET', `/api/search?${query}`)).json())

  it('finds a word in notes or tags, newest first, taking % and _ literally', async () => {
    const { send } = setup()
    await send('POST', '/api/checkin', { cardId: 'skincare', note: '試用新的乳液', tags: [], timeOffset: -7200 })
    await send('POST', '/api/checkin', { cardId: 'skincare', note: '', tags: ['乳液'], timeOffset: -3600 })
    await send('POST', '/api/checkin', { cardId: 'skincare', note: '100% 天然', tags: [] })
    await send('POST', '/api/checkin', { cardId: 'weight', note: '一般', tags: [] })
    const find = async (q: string) => (await page(send, `q=${encodeURIComponent(q)}`)).events
    expect((await find('乳液')).map((e) => e.note)).toEqual([null, '試用新的乳液'])
    expect((await find('%')).map((e) => e.note)).toEqual(['100% 天然'])
    expect(await find('_')).toEqual([])
    expect((await send('GET', '/api/search?q=%20')).status).toBe(400)
  })

  it('hands every match out page by page, each page picking up just older than the last, with the count up front', async () => {
    const { send } = setup()
    for (const hours of [5, 4, 3, 2, 1]) await send('POST', '/api/checkin', { cardId: 'skincare', note: `第${hours}次乳液`, tags: [], timeOffset: -hours * 3600 })
    const first = await page(send, 'q=乳液&limit=2')
    expect(first).toMatchObject({ total: 5, events: [{ note: '第1次乳液' }, { note: '第2次乳液' }] })
    const second = await page(send, `q=乳液&limit=2&after=${first.next!.eventAt}:${first.next!.id}`)
    expect(second).toMatchObject({ total: null, events: [{ note: '第3次乳液' }, { note: '第4次乳液' }] })
    const last = await page(send, `q=乳液&limit=2&after=${second.next!.eventAt}:${second.next!.id}`)
    expect(last).toMatchObject({ events: [{ note: '第5次乳液' }], next: null })
  })
})

describe('day counts', () => {
  it('count entries per local day, the same days the journal shows them on, oldest first', async () => {
    const { db, send } = setup()
    for (const offset of [-3 * 86400, -3 * 86400 + 60, -86400, 0]) await send('POST', '/api/checkin', { cardId: 'skincare', note: '', tags: [], timeOffset: offset })
    const perDay = new Map<string, number>()
    for (const e of allEvents(db)) {
      const key = new Date(e.eventAt * 1000).toLocaleDateString('sv-SE')
      perDay.set(key, (perDay.get(key) ?? 0) + 1)
    }
    const counts = z.array(z.object({ date: z.string(), count: z.number() })).parse(await (await send('GET', '/api/days')).json())
    expect(counts).toEqual([...perDay].sort(([a], [b]) => a.localeCompare(b)).map(([date, count]) => ({ date, count })))
  })
})

describe('quick notes', () => {
  it('write only the tags picked, under the reserved id, and take no values', async () => {
    const { db, send } = setup()
    expect((await send('POST', '/api/checkin', { cardId: 'pure', note: ' 試了陶藝 ', tags: [' 陶藝', '護膚', '陶藝', ''] })).status).toBe(201)
    expect((await send('POST', '/api/checkin', { cardId: 'pure', note: '', tags: ['體重'], facts: { '體重:kg': 50 } })).status).toBe(400)
    expect(allEvents(db)).toEqual([expect.objectContaining({ cardId: 'pure', tags: ['陶藝', '護膚'], note: '試了陶藝', facts: {} })])
  })

  it('stay quick notes when edited, gaining no card tag', async () => {
    const { db, send } = setup()
    await send('POST', '/api/checkin', { cardId: 'pure', note: '', tags: ['陶藝'] })
    const [event] = allEvents(db)
    expect((await send('PUT', `/api/events/${event!.id}`, { note: '', tags: ['陶藝', '拉坯'], eventAt: event!.eventAt })).status).toBe(204)
    expect(allEvents(db)[0]).toMatchObject({ cardId: 'pure', tags: ['陶藝', '拉坯'] })
  })

  it('offer every root to start from, and a root its pinned groups and the tags seen with it', async () => {
    const { send } = setup()
    await send('POST', '/api/checkin', { cardId: 'skincare', note: '', tags: ['乳液'] })
    await send('POST', '/api/checkin', { cardId: 'pure', note: '', tags: ['陶藝'] })
    const pure = await (await send('GET', '/api/pure')).json()
    expect(pure.roots.map((r: { tag: string }) => r.tag)).toEqual(['護膚', '體重', '練習'])
    expect(pure.tags).toEqual(expect.arrayContaining(['護膚', '乳液', '陶藝']))
    const root = await (await send('GET', `/api/roots/${encodeURIComponent('護膚')}/tags`)).json()
    expect(root).toMatchObject({ groups: [{ name: '保養項目' }], ungrouped: ['乳液'] })
  })

  it('refuse a config that gives a card the reserved id', () => {
    expect(() => memoryStore({ ...config, cards: [...config.cards, { id: 'pure', name: '隨手記', root: '隨手記', emoji: '📝', rules: unjudged }] }).read()).toThrow(/kept for quick notes/)
  })
})

describe('values', () => {
  const post = (send: ReturnType<typeof setup>['send'], cardId: string, tags: string[], facts: Record<string, unknown>) =>
    send('POST', '/api/checkin', { cardId, note: '', tags, facts })

  it('stores each value on its tag on the event with a unit from the dictionary, a real when the tag takes decimals, and a choice on a tag of its own without a unit', async () => {
    const { db, send } = setup()
    await post(send, 'weight', [], { '體重:kg': 50 })
    await post(send, 'practice', ['鋼琴', '吉他'], { '鋼琴:分鐘': 20, '吉他:分鐘': 10, 心情: '🙂' })
    expect(
      db
        .prepare(
          `SELECT ct.checkin_id AS event, t.name AS tag, u.name AS unit, typeof(v.value) AS stored, v.value
           FROM tag_values v JOIN checkin_tags ct ON ct.id = v.link JOIN tags_dict t ON t.id = ct.tag_id LEFT JOIN unit_dict u ON u.id = v.unit_id
           ORDER BY v.id`,
        )
        .all(),
    ).toEqual([
      { event: 1, tag: '體重', unit: 'kg', stored: 'real', value: 50 },
      { event: 2, tag: '鋼琴', unit: '分鐘', stored: 'integer', value: 20 },
      { event: 2, tag: '吉他', unit: '分鐘', stored: 'integer', value: 10 },
      { event: 2, tag: '心情', unit: null, stored: 'text', value: '🙂' },
    ])
    expect(allEvents(db)[1]?.tags).toEqual(['練習', '鋼琴', '吉他', '心情'])
  })

  it('rejects extra decimals, negatives, other units, tags the event lacks, and other cards’ values', async () => {
    const { db, send } = setup()
    expect((await post(send, 'weight', [], { '體重:kg': 50.25 })).status).toBe(400)
    expect((await post(send, 'weight', [], { '體重:kg': -1 })).status).toBe(400)
    expect((await post(send, 'practice', ['鋼琴'], { '鋼琴:首': 3, 心情: '🙂' })).status).toBe(400)
    expect((await post(send, 'practice', [], { '鋼琴:分鐘': 20, 心情: '🙂' })).status).toBe(400)
    expect((await post(send, 'weight', ['鋼琴'], { '鋼琴:分鐘': 20 })).status).toBe(400)
    expect((await post(send, 'practice', ['鋼琴'], { 心情: '🙂' })).status).toBe(201)
    expect(allEvents(db)).toHaveLength(1)
  })

  it('defaults a value that keeps changing to the latest by when it happened, offers no usual amounts, and opens the keypad', async () => {
    const { send } = setup()
    await post(send, 'weight', [], { '體重:kg': 50.4 })
    for (const [i, kg] of [50.6, 50.1, 50.9, 51].entries()) {
      await send('POST', '/api/checkin', { cardId: 'weight', note: '', tags: [], facts: { '體重:kg': kg }, timeOffset: -86400 * (i + 1) })
    }
    const { values } = await (await send('GET', '/api/cards/weight/inputs')).json()
    expect(values).toEqual([expect.objectContaining({ tag: '體重', unit: 'kg', auto: true, default: 50.4, candidates: [], open: true })])
  })

  it('defaults an adding value to its most frequent one, lends a tag without history the same unit’s values, and opens no keypad for tags the card does not attach', async () => {
    const { send } = setup()
    for (const v of [20, 20, 10, 20]) await post(send, 'practice', ['鋼琴'], { '鋼琴:分鐘': v, 心情: '🙂' })
    const { values } = await (await send('GET', '/api/cards/practice/inputs')).json()
    expect(values).toEqual([
      expect.objectContaining({ tag: '鋼琴', auto: false, default: 20, candidates: [20, 10], open: false }),
      expect.objectContaining({ tag: '吉他', default: 20, candidates: [20, 10], open: false }),
    ])
  })

  it('refuses a config whose card names an undefined fact or measures a unit no tag carries', () => {
    expect(() => memoryStore({ ...config, cards: [{ id: 'x', name: 'x', root: 'x', emoji: 'x', rules: unjudged, facts: ['nope'] }] }).read()).toThrow(/unknown fact nope/)
    const measuring = { ...unjudged, back: { span: 'day', measure: { kind: 'total', unit: '首' }, want: { kind: 'atLeast', n: 1 } } }
    expect(() => memoryStore({ ...config, cards: [{ id: 'x', name: 'x', root: '練習', emoji: 'x', rules: measuring }] }).read()).toThrow(/measures 首/)
  })
})

describe('card tags', () => {
  it("lists the shared root's groups, this card's settings, and history tags outside any group", async () => {
    const { send } = setup()
    await send('POST', '/api/checkin', { cardId: 'skincare', note: '', tags: ['乳液', '面膜'] })
    await send('POST', '/api/checkin', { cardId: 'sunscreen', note: '', tags: ['乳液', '化妝水'] })
    const tags = (await (await send('GET', '/api/cards/sunscreen/tags')).json()) as CardTags
    expect(tags).toMatchObject({ root: '護膚', hidden: ['化妝水'], defaults: ['防曬'], ungrouped: ['乳液', '面膜'] })
    expect(tags.groups[0]?.name).toBe('保養項目')
  })

  it('persists group edits for every card sharing the root', async () => {
    const { store, send } = setup()
    const groups = [
      { name: '早上', color: '#000', tags: [{ label: '防曬', emoji: '🌞' }] },
      { name: '保養項目', color: '#3b82f6', tags: [{ label: '化妝水', emoji: '' }] },
    ]
    expect((await send('PUT', `/api/tag-groups/${encodeURIComponent('護膚')}`, { groups })).status).toBe(204)
    expect(store.read().tagGroups['護膚']).toEqual({ emoji: '🧴', groups })
    const skincare = (await (await send('GET', '/api/cards/skincare/tags')).json()) as CardTags
    expect(skincare.groups.map((g) => g.name)).toEqual(['早上', '保養項目'])
  })

  it('rejects a tag placed in two groups and roots no card uses', async () => {
    const { store, send } = setup()
    const dup = [
      { name: 'a', color: '', tags: [{ label: '化妝水', emoji: '' }] },
      { name: 'b', color: '', tags: [{ label: '化妝水', emoji: '' }] },
    ]
    expect((await send('PUT', `/api/tag-groups/${encodeURIComponent('護膚')}`, { groups: dup })).status).toBe(400)
    expect((await send('PUT', '/api/tag-groups/nowhere', { groups: [] })).status).toBe(404)
    expect(store.read().tagGroups['護膚']?.groups[0]?.name).toBe('保養項目')
  })

  it('saves hidden and default tags on that card only', async () => {
    const { store, send } = setup()
    await send('PUT', '/api/cards/skincare/tag-settings', { hiddenTags: ['防曬'], defaultTags: ['化妝水'] })
    const [skincare, sunscreen] = store.read().cards
    expect(skincare).toMatchObject({ hiddenTags: ['防曬'], defaultTags: ['化妝水'] })
    expect(sunscreen).toMatchObject({ hiddenTags: ['化妝水'], defaultTags: ['防曬'] })
  })

  it('keeps a note on the tag itself, shown to every card that can show the tag, and drops it when emptied', async () => {
    const { store, send } = setup()
    const note = (tag: string, text: string) => send('PUT', `/api/tag-notes/${encodeURIComponent(tag)}`, { note: text })
    expect((await note('化妝水', '  早晚各一次\n洗完臉 ')).status).toBe(204)
    const notesOf = async (cardId: string) => {
      const tags = (await (await send('GET', `/api/cards/${cardId}/tags`)).json()) as CardTags
      return tags.notes
    }
    expect(await notesOf('skincare')).toEqual({ 化妝水: '早晚各一次\n洗完臉' })
    expect(await notesOf('sunscreen')).toEqual({ 化妝水: '早晚各一次\n洗完臉' })
    expect(await notesOf('practice')).toEqual({})
    await note('化妝水', '   ')
    expect(store.read().tagNotes).toEqual({})
  })
})

describe('layout', () => {
  it('starts as a centred stack at normal size with nothing pinned, and keeps the arrangement, sizes, alignment and pins it is given', async () => {
    const { store, send } = setup()
    expect(store.read().layout).toEqual({ arrangement: 'stack', cardScale: 1, maxScale: 1.35, align: 'center', pins: {} })
    const layout = { arrangement: 'sections', cardScale: 1.2, maxScale: 1.5, align: 'left', pins: { practice: { side: 'right', fx: 0.25, fy: 0 } } }
    expect((await send('PUT', '/api/layout', layout)).status).toBe(204)
    expect(store.read().layout).toEqual(layout)
  })

  it('refuses an out-of-range size, an unknown alignment or a pin off the board, and leaves the saved layout alone', async () => {
    const { store, send } = setup()
    const saved = { arrangement: 'stack', cardScale: 1, maxScale: 1.2, align: 'right', pins: {} }
    await send('PUT', '/api/layout', saved)
    const bad = [{ cardScale: 0.7 }, { cardScale: 1.7 }, { maxScale: 2 }, { maxScale: 0.9 }, { align: 'top' }, { pins: { practice: { side: 'left', fx: 0, fy: 1.5 } } }]
    for (const change of bad) {
      expect((await send('PUT', '/api/layout', { ...saved, ...change })).status).toBe(400)
    }
    expect(store.read().layout).toEqual(saved)
  })
})

describe('strip style', () => {
  it('starts as thick colour blocks with today on the right and keeps the look, border and side it is given', async () => {
    const { store, send } = setup()
    expect(store.read().strip).toEqual({ look: 'blend', weight: 'thick', side: 'right' })
    const strip = { look: 'cells', weight: 'thin', side: 'left' }
    expect((await send('PUT', '/api/strip', strip)).status).toBe(204)
    expect(store.read().strip).toEqual(strip)
  })

  it('refuses an unknown look, border or side, and leaves the saved style alone', async () => {
    const { store, send } = setup()
    const saved = { look: 'thin', weight: 'thick', side: 'left' }
    await send('PUT', '/api/strip', saved)
    for (const bad of [{ look: 'gradient' }, { weight: 'mixed' }, { side: 'center' }]) {
      expect((await send('PUT', '/api/strip', { ...saved, ...bad })).status).toBe(400)
    }
    expect(store.read().strip).toEqual(saved)
  })
})
