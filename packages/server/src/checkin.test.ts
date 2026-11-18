import { describe, expect, it } from 'vitest'
import { createApp } from './app.ts'
import { emptyConfig, memoryStore } from './config.ts'
import { openDb, type DB } from './db.ts'
import { listEvents } from './events.ts'
import type { CardTags } from './tags.ts'

const config = {
  ...emptyConfig,
  cards: [
    { id: 'skincare', tag: '護膚', emoji: '🧴', trackerId: null },
    { id: 'sunscreen', tag: '防曬', bucket: '護膚', emoji: '🌞', trackerId: null, hiddenTags: ['化妝水'] },
    { id: 'weight', tag: '體重', emoji: '⚖️', trackerId: null, inputComponent: 'WeightActivityInput' },
  ],
  tagGroups: {
    護膚: { emoji: '🧴', groups: [{ name: '保養項目', color: '#3b82f6', tags: [{ label: '化妝水', emoji: '🧴' }, { label: '防曬', emoji: '🌞' }] }] },
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

  it('reuses an existing tag instead of creating a duplicate', async () => {
    const { db, send } = setup()
    await send('POST', '/api/checkin', { cardId: 'skincare', note: '', tags: [] })
    await send('POST', '/api/checkin', { cardId: 'skincare', note: '', tags: [] })
    expect(db.prepare('SELECT COUNT(*) AS n FROM tags_dict').get()).toEqual({ n: 1 })
  })

  it('refuses unknown cards and cards whose value input is missing', async () => {
    const { db, send } = setup()
    expect((await send('POST', '/api/checkin', { cardId: 'nope', note: '', tags: [] })).status).toBe(404)
    expect((await send('POST', '/api/checkin', { cardId: 'weight', note: '', tags: [] })).status).toBe(422)
    expect(allEvents(db)).toEqual([])
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

