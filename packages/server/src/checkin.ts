import type { CardConfig } from './config.ts'
import type { DB } from './db.ts'

// Every recorded weight and exercise event carries a value; saving one without it would break their reports.
const VALUE_INPUTS = new Set(['WeightActivityInput', 'ExerciseActivityInput'])

export function needsValue(card: CardConfig): boolean {
  return VALUE_INPUTS.has(card.inputComponent ?? '')
}

export function checkinTags(card: CardConfig, picked: string[]): string[] {
  const chosen = picked.map((t) => t.trim()).filter((t) => t !== '')
  return [...new Set([card.tag, ...(card.bucket ? [card.bucket] : []), ...chosen])]
}

interface CheckinInput {
  note: string | null
  picked: string[]
  now: number
  timeOffset: number
}

export function createCheckin(db: DB, card: CardConfig, { note, picked, now, timeOffset }: CheckinInput): number {
  const insertEvent = db.prepare('INSERT INTO events (card_id, created_at, time_offset, note) VALUES (?, ?, ?, ?)')
  const findTag = db.prepare<[string], { id: number }>('SELECT id FROM tags_dict WHERE name = ? ORDER BY id LIMIT 1')
  const insertTag = db.prepare('INSERT INTO tags_dict (name) VALUES (?)')
  const linkTag = db.prepare('INSERT INTO checkin_tags (checkin_id, tag_id) VALUES (?, ?)')

  return db.transaction(() => {
    const id = Number(insertEvent.run(card.id, now, timeOffset, note).lastInsertRowid)
    for (const name of checkinTags(card, picked)) {
      const tagId = findTag.get(name)?.id ?? Number(insertTag.run(name).lastInsertRowid)
      linkTag.run(id, tagId)
    }
    return id
  })()
}
