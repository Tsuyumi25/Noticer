import type { CardConfig } from './config.ts'
import type { DB } from './db.ts'
import type { FactRow } from './facts.ts'

/** The tags someone picked, trimmed, without blanks or repeats. */
export function pickedTags(picked: string[]): string[] {
  return [...new Set(picked.map((t) => t.trim()).filter((t) => t !== ''))]
}

export function checkinTags(card: CardConfig, picked: string[]): string[] {
  return [...new Set([card.root, ...pickedTags(picked)])]
}

interface CheckinInput {
  note: string | null
  tags: string[]
  facts: FactRow[]
  timeOffset: number
}

function writeTagsAndFacts(db: DB, id: number, tags: string[], facts: FactRow[]) {
  const findTag = db.prepare<[string], { id: number }>('SELECT id FROM tags_dict WHERE name = ? ORDER BY id LIMIT 1')
  const insertTag = db.prepare('INSERT INTO tags_dict (name) VALUES (?)')
  const linkTag = db.prepare('INSERT INTO checkin_tags (checkin_id, tag_id) VALUES (?, ?)')
  const insertFact = db.prepare('INSERT INTO checkin_facts (checkin_id, k, type, value) VALUES (?, ?, ?, ?)')
  for (const name of tags) {
    const tagId = findTag.get(name)?.id ?? Number(insertTag.run(name).lastInsertRowid)
    linkTag.run(id, tagId)
  }
  for (const f of facts) insertFact.run(id, f.k, f.type, f.type === 'integer' ? BigInt(f.value) : f.value)
}

export function createCheckin(db: DB, cardId: string, { note, tags, facts, timeOffset, now }: CheckinInput & { now: number }): number {
  const insertEvent = db.prepare('INSERT INTO events (card_id, created_at, time_offset, note) VALUES (?, ?, ?, ?)')
  return db.transaction(() => {
    const id = Number(insertEvent.run(cardId, now, timeOffset, note).lastInsertRowid)
    writeTagsAndFacts(db, id, tags, facts)
    return id
  })()
}

export interface StoredEvent {
  cardId: string
  createdAt: number
}

export function findEvent(db: DB, id: number): StoredEvent | undefined {
  return db
    .prepare<[number], StoredEvent>('SELECT card_id AS cardId, created_at AS createdAt FROM events WHERE id = ?')
    .get(id)
}

/**
 * Replaces an event's note, time, tags, values and the given choice facts; created_at stays, so the new time becomes
 * the offset from it. Facts this app does not model (kept from the old app) survive.
 */
export function updateCheckin(db: DB, id: number, choiceKeys: string[], { note, tags, facts, timeOffset }: CheckinInput) {
  db.transaction(() => {
    db.prepare('UPDATE events SET time_offset = ?, note = ? WHERE id = ?').run(timeOffset, note, id)
    db.prepare('DELETE FROM checkin_tags WHERE checkin_id = ?').run(id)
    db.prepare("DELETE FROM checkin_facts WHERE checkin_id = ? AND (instr(k, ':') > 0 OR k IN (SELECT value FROM json_each(?)))").run(
      id,
      JSON.stringify(choiceKeys),
    )
    writeTagsAndFacts(db, id, tags, facts)
  })()
}

export function deleteCheckin(db: DB, id: number): boolean {
  return db.prepare('DELETE FROM events WHERE id = ?').run(id).changes > 0
}
