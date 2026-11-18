import { describe, expect, it } from 'vitest'
import { createApp } from './app.ts'
import { emptyConfig, type Config } from './config.ts'
import { openDb, type DB } from './db.ts'
import { listEvents } from './events.ts'

const config: Config = {
  ...emptyConfig,
  cards: [
    { id: 'sunscreen', tag: '防曬', bucket: '護膚', emoji: '🌞', trackerId: null },
    { id: 'water_plants', tag: '澆花', defaultTags: ['350cc', '澆花'], emoji: '🪴', trackerId: null },
    { id: 'weight', tag: '體重', emoji: '⚖️', trackerId: null, inputComponent: 'WeightActivityInput' },
  ],
}

function post(db: DB, body: unknown) {
  return createApp(db, () => config).request('/api/checkin', {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify(body),
  })
}

describe('checkin', () => {
  it('attaches the card tag, its bucket and its preselected tags once each', async () => {
    const db = openDb(':memory:')
    await post(db, { cardId: 'sunscreen', note: '' })
    await post(db, { cardId: 'water_plants', note: '  花茶 ' })

    const [screen, water] = listEvents(db, 0, Number.MAX_SAFE_INTEGER)
    expect(screen).toMatchObject({ cardId: 'sunscreen', tags: ['防曬', '護膚'], note: null, timeOffset: 0 })
    expect(water).toMatchObject({ cardId: 'water_plants', tags: ['澆花', '350cc'], note: '花茶' })
  })

  it('reuses an existing tag instead of creating a duplicate', async () => {
    const db = openDb(':memory:')
    await post(db, { cardId: 'sunscreen', note: '' })
    await post(db, { cardId: 'sunscreen', note: '' })
    expect(db.prepare('SELECT COUNT(*) AS n FROM tags_dict').get()).toEqual({ n: 2 })
  })

  it('refuses unknown cards and cards whose value input is missing', async () => {
    const db = openDb(':memory:')
    expect((await post(db, { cardId: 'nope', note: '' })).status).toBe(404)
    expect((await post(db, { cardId: 'weight', note: '' })).status).toBe(422)
    expect(listEvents(db, 0, Number.MAX_SAFE_INTEGER)).toEqual([])
  })
})
