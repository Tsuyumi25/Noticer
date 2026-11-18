import type { CardConfig } from './config.ts'
import type { DB } from './db.ts'
import type { FactRow } from './facts.ts'

export function checkinTags(card: CardConfig, picked: string[]): string[] {
  const chosen = picked.map((t) => t.trim()).filter((t) => t !== '')
  return [...new Set([card.tag, ...(card.bucket ? [card.bucket] : []), ...chosen])]
}

interface CheckinInput {
  note: string | null
  picked: string[]
  facts: FactRow[]
  now: number
  timeOffset: number
}

export function createCheckin(db: DB, card: CardConfig, { note, picked, facts, now, timeOffset }: CheckinInput): number {
  const insertEvent = db.prepare('INSERT INTO events (card_id, created_at, time_offset, note) VALUES (?, ?, ?, ?)')
  const findTag = db.prepare<[string], { id: number }>('SELECT id FROM tags_dict WHERE name = ? ORDER BY id LIMIT 1')
  const insertTag = db.prepare('INSERT INTO tags_dict (name) VALUES (?)')
  const linkTag = db.prepare('INSERT INTO checkin_tags (checkin_id, tag_id) VALUES (?, ?)')
  const insertFact = db.prepare('INSERT INTO checkin_facts (checkin_id, k, type, value) VALUES (?, ?, ?, ?)')

  return db.transaction(() => {
    const id = Number(insertEvent.run(card.id, now, timeOffset, note).lastInsertRowid)
    for (const name of checkinTags(card, picked)) {
      const tagId = findTag.get(name)?.id ?? Number(insertTag.run(name).lastInsertRowid)
      linkTag.run(id, tagId)
    }
    for (const f of facts) insertFact.run(id, f.k, f.type, f.type === 'integer' ? BigInt(f.value) : f.value)
    return id
  })()
}
