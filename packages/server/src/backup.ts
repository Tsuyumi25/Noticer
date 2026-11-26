import { z } from 'zod'
import { writeTagsAndFacts } from './checkin.ts'
import type { DB } from './db.ts'
import type { FactRow } from './facts.ts'

const factSchema = z.discriminatedUnion('type', [
  z.object({ type: z.literal('text'), value: z.string() }),
  z.object({ type: z.literal('integer'), value: z.number().int() }),
  z.object({ type: z.literal('real'), value: z.number() }),
  z.object({ type: z.literal('boolean'), value: z.boolean() }),
])

export const recordSchema = z.object({
  id: z.number().int(),
  card_id: z.string(),
  created_at: z.iso.datetime({ offset: true }),
  event_at: z.iso.datetime({ offset: true }),
  time_offset: z.number().int(),
  note: z.string().nullable(),
  tags: z.array(z.string()),
  facts: z.record(z.string(), factSchema),
})

export const monthFileSchema = z.object({
  version: z.literal(3),
  month: z.string(),
  records: z.array(recordSchema),
})

export type BackupRecord = z.infer<typeof recordSchema>
export type MonthFile = z.infer<typeof monthFileSchema>
type Fact = z.infer<typeof factSchema>

function toRow(k: string, fact: Fact): FactRow {
  switch (fact.type) {
    case 'boolean':
      return { k, type: 'integer', value: fact.value ? 1 : 0 }
    default:
      return { k, ...fact }
  }
}

export function importRecords(db: DB, records: BackupRecord[]): number {
  const insertEvent = db.prepare(
    'INSERT INTO events (id, card_id, created_at, time_offset, note) VALUES (?, ?, ?, ?, ?)',
  )

  const run = db.transaction(() => {
    db.exec(`
      DELETE FROM checkin_attachments;
      DELETE FROM tag_values;
      DELETE FROM checkin_tags;
      DELETE FROM events;
      DELETE FROM cards;
      DELETE FROM settings;
      DELETE FROM unit_dict;
      DELETE FROM tags_dict;
    `)
    for (const r of records) {
      const createdAt = Date.parse(r.created_at) / 1000
      if (createdAt + r.time_offset !== Date.parse(r.event_at) / 1000) {
        throw new Error(`event ${r.id}: created_at + time_offset does not match event_at`)
      }
      insertEvent.run(r.id, r.card_id, createdAt, r.time_offset, r.note)
      writeTagsAndFacts(db, r.id, [...new Set(r.tags)], Object.entries(r.facts).map(([k, fact]) => toRow(k, fact)))
    }
    return records.length
  })

  return run()
}
