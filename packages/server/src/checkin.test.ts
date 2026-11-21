import { describe, expect, it } from 'vitest'
import { createApp } from './app.ts'
import { emptyConfig, memoryStore } from './config.ts'
import { openDb, type DB } from './db.ts'
import { listEvents } from './events.ts'
import type { CardTags } from './tags.ts'

const unjudged = { find: { match: 'all', blocks: [] }, now: {}, back: null } as const
const config = {
  ...emptyConfig,
  cards: [
    { id: 'skincare', tag: '護膚', emoji: '🧴', rules: unjudged },
    { id: 'sunscreen', tag: '防曬', bucket: '護膚', emoji: '🌞', rules: unjudged, hiddenTags: ['化妝水'] },
    { id: 'weight', tag: '體重', emoji: '⚖️', rules: unjudged },
    { id: 'practice', tag: '練習', emoji: '🎹', rules: unjudged, facts: ['mood_emoji'] },
  ],
  tagGroups: {
    護膚: { emoji: '🧴', groups: [{ name: '保養項目', color: '#3b82f6', tags: [{ label: '化妝水', emoji: '🧴' }, { label: '防曬', emoji: '🌞' }] }] },
    體重: { groups: [], values: { 體重: { unit: 'kg', decimals: 1, keep: 'latest' } } },
    練習: {
      groups: [{ name: '樂器', color: '#3b82f6', tags: [{ label: '鋼琴', emoji: '' }, { label: '吉他', emoji: '' }] }],
      values: { 鋼琴: { unit: '分鐘', decimals: 0, keep: 'sum' }, 吉他: { unit: '分鐘', decimals: 0, keep: 'sum' } },
    },
  },
  factInputs: {
    mood_emoji: { kind: 'choice', name: '心情', options: [{ value: '🙂', label: '不錯' }], required: true },
  },
}

function setup() {
  const db = openDb(':memory:')
  const store = memoryStore(config)
  const app = createApp(db, store)
  const send = (method: string, path: string, body?: unknown) =>
    app.request(path, { method, headers: { 'content-type': 'application/json' }, body: body === undefined ? undefined : JSON.stringify(body) })
  return { db, store, send }
}

const allEvents = (db: DB) => listEvents(db, 0, Number.MAX_SAFE_INTEGER)

describe('checkin', () => {
  it('saves the picked tags plus the card tag and bucket, once each', async () => {
    const { db, send } = setup()
    await send('POST', '/api/checkin', { cardId: 'sunscreen', note: '  早上 ', tags: ['乳液', '護膚', ' '] })
    expect(allEvents(db)[0]).toMatchObject({ cardId: 'sunscreen', tags: ['防曬', '護膚', '乳液'], note: '早上', timeOffset: 0 })
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

describe('editing an event', () => {
  async function recorded() {
    const ctx = setup()
    await ctx.send('POST', '/api/checkin', { cardId: 'practice', note: '早上', tags: ['鋼琴'], facts: { '鋼琴:分鐘': 20, mood_emoji: '🙂' } })
    return { ...ctx, event: allEvents(ctx.db)[0]! }
  }

  it('replaces note, time, tags, values and choices, keeping the card tag and facts the app does not model', async () => {
    const { db, send, event } = await recorded()
    db.prepare("INSERT INTO checkin_facts (checkin_id, k, type, value) VALUES (?, 'mood_text', 'text', '有點睏')").run(event.id)
    const eventAt = event.eventAt - 5 * 3600
    const res = await send('PUT', `/api/events/${event.id}`, { note: ' ', tags: ['吉他'], eventAt, facts: { '吉他:分鐘': 15, mood_emoji: '🙂' } })
    expect(res.status).toBe(204)
    expect(allEvents(db)).toEqual([
      expect.objectContaining({
        id: event.id,
        eventAt,
        timeOffset: -5 * 3600,
        note: null,
        tags: ['練習', '吉他'],
        facts: { '吉他:分鐘': 15, mood_emoji: '🙂', mood_text: '有點睏' },
      }),
    ])
  })

  it('refuses a future time, values of tags the event lacks, and unknown events, leaving the event as it was', async () => {
    const { db, send, event } = await recorded()
    const body = { note: '', tags: ['鋼琴'], eventAt: event.eventAt, facts: { mood_emoji: '🙂' } }
    expect((await send('PUT', `/api/events/${event.id}`, { ...body, eventAt: event.eventAt + 3600 })).status).toBe(400)
    expect((await send('PUT', `/api/events/${event.id}`, { ...body, facts: { '吉他:分鐘': 5, mood_emoji: '🙂' } })).status).toBe(400)
    expect((await send('PUT', `/api/events/${event.id + 1}`, body)).status).toBe(404)
    expect(allEvents(db)).toEqual([event])
  })

  it('deletes an event with its tags and values, once', async () => {
    const { db, send, event } = await recorded()
    expect((await send('DELETE', `/api/events/${event.id}`)).status).toBe(204)
    expect((await send('DELETE', `/api/events/${event.id}`)).status).toBe(404)
    expect(allEvents(db)).toEqual([])
    expect(db.prepare('SELECT COUNT(*) AS n FROM checkin_facts').get()).toEqual({ n: 0 })
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
    expect(() => memoryStore({ ...config, cards: [...config.cards, { id: 'pure', tag: '隨手記', emoji: '📝', rules: unjudged }] }).read()).toThrow(/kept for quick notes/)
  })
})

describe('values', () => {
  const post = (send: ReturnType<typeof setup>['send'], cardId: string, tags: string[], facts: Record<string, unknown>) =>
    send('POST', '/api/checkin', { cardId, note: '', tags, facts })

  it('stores a value under tag:unit, as a real when the tag takes decimals, and choices as text', async () => {
    const { db, send } = setup()
    await post(send, 'weight', [], { '體重:kg': 50 })
    await post(send, 'practice', ['鋼琴', '吉他'], { '鋼琴:分鐘': 20, '吉他:分鐘': 10, mood_emoji: '🙂' })
    expect(db.prepare('SELECT k, type, typeof(value) AS stored, value FROM checkin_facts ORDER BY checkin_id, k').all()).toEqual([
      { k: '體重:kg', type: 'real', stored: 'real', value: 50 },
      { k: 'mood_emoji', type: 'text', stored: 'text', value: '🙂' },
      { k: '吉他:分鐘', type: 'integer', stored: 'integer', value: 10 },
      { k: '鋼琴:分鐘', type: 'integer', stored: 'integer', value: 20 },
    ])
  })

  it('rejects extra decimals, negatives, other units, tags the event lacks, and other cards’ values', async () => {
    const { db, send } = setup()
    expect((await post(send, 'weight', [], { '體重:kg': 50.25 })).status).toBe(400)
    expect((await post(send, 'weight', [], { '體重:kg': -1 })).status).toBe(400)
    expect((await post(send, 'practice', ['鋼琴'], { '鋼琴:首': 3, mood_emoji: '🙂' })).status).toBe(400)
    expect((await post(send, 'practice', [], { '鋼琴:分鐘': 20, mood_emoji: '🙂' })).status).toBe(400)
    expect((await post(send, 'weight', ['鋼琴'], { '鋼琴:分鐘': 20 })).status).toBe(400)
    expect((await post(send, 'practice', ['鋼琴'], { mood_emoji: '🙂' })).status).toBe(201)
    expect(allEvents(db)).toHaveLength(1)
  })

  it('defaults a replacing value to the latest by when it happened, and opens the keypad when it seldom stays the same', async () => {
    const { send } = setup()
    await post(send, 'weight', [], { '體重:kg': 50.4 })
    await send('POST', '/api/checkin', { cardId: 'weight', note: '', tags: [], facts: { '體重:kg': 53 }, timeOffset: -86400 })
    const { values } = await (await send('GET', '/api/cards/weight/inputs')).json()
    expect(values).toEqual([expect.objectContaining({ tag: '體重', unit: 'kg', auto: true, default: 50.4, candidates: [], open: true })])
  })

  it('defaults an adding value to its most frequent one, lends a tag without history the same unit’s values, and opens no keypad for tags the card does not attach', async () => {
    const { send } = setup()
    for (const v of [20, 20, 10, 20]) await post(send, 'practice', ['鋼琴'], { '鋼琴:分鐘': v, mood_emoji: '🙂' })
    const { values } = await (await send('GET', '/api/cards/practice/inputs')).json()
    expect(values).toEqual([
      expect.objectContaining({ tag: '鋼琴', auto: false, default: 20, candidates: [20, 10], open: false }),
      expect.objectContaining({ tag: '吉他', default: 20, candidates: [20, 10], open: false }),
    ])
  })

  it('refuses a config whose card names an undefined fact or measures a unit no tag carries', () => {
    expect(() => memoryStore({ ...config, cards: [{ id: 'x', tag: 'x', emoji: 'x', rules: unjudged, facts: ['nope'] }] }).read()).toThrow(/unknown fact nope/)
    const measuring = { ...unjudged, back: { span: 'day', measure: { kind: 'total', unit: '首' }, want: { kind: 'atLeast', n: 1 } } }
    expect(() => memoryStore({ ...config, cards: [{ id: 'x', tag: '練習', emoji: 'x', rules: measuring }] }).read()).toThrow(/measures 首/)
  })
})

describe('card tags', () => {
  it("lists the shared root's groups, this card's settings, and history tags outside any group", async () => {
    const { send } = setup()
    await send('POST', '/api/checkin', { cardId: 'skincare', note: '', tags: ['乳液', '面膜'] })
    await send('POST', '/api/checkin', { cardId: 'sunscreen', note: '', tags: ['乳液', '化妝水'] })
    const tags = (await (await send('GET', '/api/cards/sunscreen/tags')).json()) as CardTags
    expect(tags).toMatchObject({ root: '護膚', auto: ['防曬', '護膚'], hidden: ['化妝水'], defaults: [], ungrouped: ['乳液', '面膜'] })
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
    expect(sunscreen).toMatchObject({ hiddenTags: ['化妝水'] })
    expect(sunscreen?.defaultTags).toBeUndefined()
  })
})

