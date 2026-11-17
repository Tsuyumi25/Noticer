import { describe, expect, it } from 'vitest'
import { createApp } from './app.ts'
import { importMonths, type MonthFile } from './backup.ts'
import { openDb, type DB } from './db.ts'
import type { EventRecord } from './events.ts'

const month: MonthFile = {
  version: 3,
  month: '2026-06',
  records: [
    {
      id: 10,
      card_id: 'sleep_end',
      created_at: '2026-06-01T03:33:33+08:00',
      event_at: '2026-06-01T03:33:33+08:00',
      time_offset: 0,
      note: null,
      tags: ['作息', '起床', '起床'],
      facts: { mood_label: { type: 'text', value: '不錯' } },
    },
    {
      id: 11,
      card_id: 'weight',
      created_at: '2026-06-01T09:00:00+08:00',
      event_at: '2026-06-01T08:30:00+08:00',
      time_offset: -1800,
      note: '早上',
      tags: ['體重'],
      facts: {
        weight_kg: { type: 'real', value: 53 },
        reps: { type: 'integer', value: 12 },
        fasted: { type: 'boolean', value: true },
      },
    },
    {
      id: 12,
      card_id: 'coffee',
      created_at: '2026-06-02T00:00:00+08:00',
      event_at: '2026-06-02T00:00:00+08:00',
      time_offset: 0,
      note: '深夜',
      tags: ['喝咖啡'],
      facts: {},
    },
  ],
}

const dayStart = Date.parse('2026-06-01T00:00:00+08:00') / 1000
const dayEnd = Date.parse('2026-06-02T00:00:00+08:00') / 1000

async function fetchEvents(db: DB, from: number, to: number) {
  const res = await createApp(db).request(`/api/events?from=${from}&to=${to}`)
  return { status: res.status, body: (await res.json()) as EventRecord[] }
}

describe('backup import', () => {
  it('round-trips records into the half-open day range with offsets, tags and typed facts', async () => {
    const db = openDb(':memory:')
    expect(importMonths(db, [month])).toBe(3)

    const { body } = await fetchEvents(db, dayStart, dayEnd)

    expect(body.map((e) => e.id)).toEqual([10, 11])
    expect(body[0]?.tags).toEqual(['作息', '起床'])
    expect(body[1]).toMatchObject({
      eventAt: Date.parse('2026-06-01T08:30:00+08:00') / 1000,
      timeOffset: -1800,
      note: '早上',
      facts: { weight_kg: 53, reps: 12, fasted: true },
    })
  })

  it('replaces previous data instead of appending', async () => {
    const db = openDb(':memory:')
    importMonths(db, [month])
    importMonths(db, [month])

    const { body } = await fetchEvents(db, dayStart, dayEnd + 86400)
    expect(body).toHaveLength(3)
  })

  it('rejects a record whose event_at disagrees with created_at + time_offset', () => {
    const db = openDb(':memory:')
    const broken: MonthFile = {
      ...month,
      records: [{ ...month.records[1]!, time_offset: 0 }],
    }
    expect(() => importMonths(db, [broken])).toThrow(/event 11/)
  })

  it('rejects an empty or inverted range', async () => {
    const { status } = await fetchEvents(openDb(':memory:'), dayEnd, dayStart)
    expect(status).toBe(400)
  })
})
