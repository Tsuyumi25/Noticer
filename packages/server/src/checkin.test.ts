import { describe, expect, it } from 'vitest'
import { createApp } from './app.ts'
import { emptyConfig, memoryStore } from './config.ts'
import { openDb, type DB } from './db.ts'
import { listEvents } from './events.ts'
import type { CardTags } from './tags.ts'

const unjudged = { find: { match: 'all', blocks: [] }, now: { kind: 'off' }, back: null } as const
const config = {
  ...emptyConfig,
  cards: [
    { id: 'skincare', tag: '護膚', emoji: '🧴', rules: unjudged },
    { id: 'sunscreen', tag: '防曬', bucket: '護膚', emoji: '🌞', rules: unjudged, hiddenTags: ['化妝水'] },
    { id: 'weight', tag: '體重', emoji: '⚖️', rules: unjudged, facts: ['weight_kg'] },
    { id: 'practice', tag: '練習', emoji: '🎹', rules: unjudged, facts: ['duration_min', 'mood_emoji'] },
  ],
  tagGroups: {
    護膚: { emoji: '🧴', groups: [{ name: '保養項目', color: '#3b82f6', tags: [{ label: '化妝水', emoji: '🧴' }, { label: '防曬', emoji: '🌞' }] }] },
  },
  factInputs: {
    weight_kg: { kind: 'number', name: '體重', unit: 'kg', decimals: 1, min: 30, max: 200, steps: [0.1], initial: 'last', required: true },
    duration_min: { kind: 'number', name: '時長', unit: '分鐘', decimals: 0, min: 0, max: 600, steps: [5] },
    mood_emoji: { kind: 'choice', name: '心情', options: [{ value: '🙂', label: '不錯' }] },
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

  it('refuses unknown cards and a missing required value', async () => {
    const { db, send } = setup()
    expect((await send('POST', '/api/checkin', { cardId: 'nope', note: '', tags: [] })).status).toBe(404)
    expect((await send('POST', '/api/checkin', { cardId: 'weight', note: '', tags: [] })).status).toBe(422)
    expect(allEvents(db)).toEqual([])
  })
})

describe('facts', () => {
  it('stores decimal inputs as reals even when whole, integer inputs as integers, and choices as text', async () => {
    const { db, send } = setup()
    await send('POST', '/api/checkin', { cardId: 'weight', note: '', tags: [], facts: { weight_kg: 50 } })
    await send('POST', '/api/checkin', { cardId: 'practice', note: '', tags: [], facts: { duration_min: 20, mood_emoji: '🙂' } })
    expect(db.prepare('SELECT k, type, typeof(value) AS stored, value FROM checkin_facts ORDER BY checkin_id, k').all()).toEqual([
      { k: 'weight_kg', type: 'real', stored: 'real', value: 50 },
      { k: 'duration_min', type: 'integer', stored: 'integer', value: 20 },
      { k: 'mood_emoji', type: 'text', stored: 'text', value: '🙂' },
    ])
  })

  it('rejects values outside the range, with extra decimals, off the options, or for another card', async () => {
    const { db, send } = setup()
    const post = (cardId: string, facts: Record<string, unknown>) => send('POST', '/api/checkin', { cardId, note: '', tags: [], facts })
    expect((await post('weight', { weight_kg: 201 })).status).toBe(400)
    expect((await post('weight', { weight_kg: 50.25 })).status).toBe(400)
    expect((await post('practice', { duration_min: 20, mood_emoji: '😵' })).status).toBe(400)
    expect((await post('weight', { weight_kg: 50, duration_min: 20 })).status).toBe(400)
    expect((await post('practice', {})).status).toBe(201)
    expect(allEvents(db)).toHaveLength(1)
  })

  it("offers the value of the latest event by when it happened, not by when it was entered", async () => {
    const { send } = setup()
    await send('POST', '/api/checkin', { cardId: 'weight', note: '', tags: [], facts: { weight_kg: 50.4 } })
    await send('POST', '/api/checkin', { cardId: 'weight', note: '', tags: [], facts: { weight_kg: 53 }, timeOffset: -86400 })
    const inputs = await (await send('GET', '/api/cards/weight/inputs')).json()
    expect(inputs).toEqual([expect.objectContaining({ key: 'weight_kg', kind: 'number', last: 50.4 })])
  })

  it('refuses a config whose card names an undefined fact', () => {
    expect(() => memoryStore({ ...config, cards: [{ id: 'x', tag: 'x', emoji: 'x', rules: unjudged, facts: ['nope'] }] }).read()).toThrow(/unknown fact nope/)
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

