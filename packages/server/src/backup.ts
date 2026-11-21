import { z } from 'zod'
import type { DB } from './db.ts'

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

function factToSql(fact: Fact): string | number | bigint {
  switch (fact.type) {
    case 'integer':
      return BigInt(fact.value)
    case 'boolean':
      return fact.value ? 1n : 0n
    default:
      return fact.value
  }
}

export function importRecords(db: DB, records: BackupRecord[]): number {
  const insertEvent = db.prepare(
    'INSERT INTO events (id, card_id, created_at, time_offset, note) VALUES (?, ?, ?, ?, ?)',
  )
  const insertTag = db.prepare('INSERT INTO tags_dict (name) VALUES (?)')
  const linkTag = db.prepare('INSERT INTO checkin_tags (checkin_id, tag_id) VALUES (?, ?)')
  const insertFact = db.prepare('INSERT INTO checkin_facts (checkin_id, k, type, value) VALUES (?, ?, ?, ?)')

  const run = db.transaction(() => {
    db.exec(`
      DELETE FROM checkin_attachments;
      DELETE FROM checkin_facts;
      DELETE FROM checkin_tags;
      DELETE FROM events;
      DELETE FROM tags_dict;
    `)
    const tagIds = new Map<string, number>()
    for (const r of records) {
      const createdAt = Date.parse(r.created_at) / 1000
      if (createdAt + r.time_offset !== Date.parse(r.event_at) / 1000) {
        throw new Error(`event ${r.id}: created_at + time_offset does not match event_at`)
      }
      insertEvent.run(r.id, r.card_id, createdAt, r.time_offset, r.note)
      for (const name of new Set(r.tags)) {
        let tagId = tagIds.get(name)
        if (tagId === undefined) {
          tagId = Number(insertTag.run(name).lastInsertRowid)
          tagIds.set(name, tagId)
        }
        linkTag.run(r.id, tagId)
      }
      for (const [k, fact] of Object.entries(r.facts)) {
        insertFact.run(r.id, k, fact.type, factToSql(fact))
      }
    }
    return records.length
  })

  return run()
}
