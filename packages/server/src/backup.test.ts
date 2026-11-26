import { mkdtempSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { describe, expect, it } from 'vitest'
import { createApp } from './app.ts'
import { AttachmentFiles } from './attachments.ts'
import { importRecords, type BackupRecord } from './backup.ts'
import { emptyConfig, memoryStore } from './config.ts'
import { openDb, type DB } from './db.ts'
import type { EventRecord } from './events.ts'

const records: BackupRecord[] = [
  {
    id: 10,
    card_id: 'sleep_end',
    created_at: '2026-06-01T03:33:33+08:00',
    event_at: '2026-06-01T03:33:33+08:00',
    time_offset: 0,
    note: null,
    tags: ['作息', '起床', '起床'],
    facts: { 心情: { type: 'text', value: '🙂' } },
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
      '體重:kg': { type: 'real', value: 53 },
      '體重:次': { type: 'integer', value: 12 },
      空腹: { type: 'boolean', value: true },
    },
  },
  {
    id: 12,
    card_id: 'coffee',
    created_at: '2026-06-01T16:00:00.000Z',
    event_at: '2026-06-01T16:00:00.000Z',
    time_offset: 0,
    note: '深夜',
    tags: ['喝咖啡'],
    facts: {},
  },
]

const dayStart = Date.parse('2026-06-01T00:00:00+08:00') / 1000
const dayEnd = Date.parse('2026-06-02T00:00:00+08:00') / 1000

async function fetchEvents(db: DB, from: number, to: number) {
  const res = await createApp(db, memoryStore(emptyConfig), new AttachmentFiles(mkdtempSync(join(tmpdir(), 'noticer-')))).request(`/api/events?from=${from}&to=${to}`)
  return { status: res.status, body: (await res.json()) as EventRecord[] }
}

describe('record import', () => {
  it('round-trips records into the half-open day range with offsets, and puts each value on its tag, adding the tag a unitless one names', async () => {
    const db = openDb(':memory:')
    expect(importRecords(db, records)).toBe(3)

    const { body } = await fetchEvents(db, dayStart, dayEnd)

    expect(body.map((e) => e.id)).toEqual([10, 11])
    expect(body[0]).toMatchObject({ tags: ['作息', '起床', '心情'], facts: { 心情: '🙂' } })
    expect(body[1]).toMatchObject({
      eventAt: Date.parse('2026-06-01T08:30:00+08:00') / 1000,
      timeOffset: -1800,
      note: '早上',
      tags: ['體重', '空腹'],
      facts: { '體重:kg': 53, '體重:次': 12, 空腹: 1 },
    })
  })

  it('replaces previous data instead of appending', async () => {
    const db = openDb(':memory:')
    importRecords(db, records)
    importRecords(db, records)

    const { body } = await fetchEvents(db, dayStart, dayEnd + 86400)
    expect(body).toHaveLength(3)
  })

  it('rejects a record whose event_at disagrees with created_at + time_offset', () => {
    const db = openDb(':memory:')
    expect(() => importRecords(db, [{ ...records[1]!, time_offset: 0 }])).toThrow(/event 11/)
  })

  it('rejects an empty or inverted range', async () => {
    const { status } = await fetchEvents(openDb(':memory:'), dayEnd, dayStart)
    expect(status).toBe(400)
  })
})
