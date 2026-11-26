import { attachmentIdsOf, setAttachments, type AttachmentFiles } from './attachments.ts'
import type { CardConfig } from './config.ts'
import type { DB } from './db.ts'
import type { FactRow } from './facts.ts'
import { parseValueKey } from './values.ts'

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
  /** Attachment ids in display order; checked beforehand to be uploads this event may take. */
  attachments: string[]
}

export function dictionaryIds(db: DB) {
  const findTag = db.prepare<[string], { id: number }>('SELECT id FROM tags_dict WHERE name = ?')
  const insertTag = db.prepare('INSERT INTO tags_dict (name) VALUES (?)')
  const findUnit = db.prepare<[string], { id: number }>('SELECT id FROM unit_dict WHERE name = ?')
  const insertUnit = db.prepare('INSERT INTO unit_dict (name) VALUES (?)')
  return {
    tag: (name: string) => findTag.get(name)?.id ?? Number(insertTag.run(name).lastInsertRowid),
    unit: (name: string) => findUnit.get(name)?.id ?? Number(insertUnit.run(name).lastInsertRowid),
  }
}

export function writeTagsAndFacts(db: DB, id: number, tags: string[], facts: FactRow[]) {
  const ids = dictionaryIds(db)
  const linkTag = db.prepare('INSERT INTO checkin_tags (checkin_id, tag_id) VALUES (?, ?)')
  const insertValue = db.prepare('INSERT INTO tag_values (link, unit_id, value) VALUES (?, ?, ?)')
  const links = new Map<string, number>()
  const link = (name: string) => {
    let linkId = links.get(name)
    if (linkId === undefined) {
      linkId = Number(linkTag.run(id, ids.tag(name)).lastInsertRowid)
      links.set(name, linkId)
    }
    return linkId
  }
  for (const name of tags) link(name)
  for (const f of facts) {
    const key = parseValueKey(f.k)
    const value = f.type === 'integer' ? BigInt(f.value) : f.value
    if (key) insertValue.run(link(key.tag), ids.unit(key.unit), value)
    else insertValue.run(link(f.k), null, value)
  }
}

export function createCheckin(
  db: DB,
  files: AttachmentFiles,
  cardId: string,
  { note, tags, facts, timeOffset, attachments, now }: CheckinInput & { now: number },
): number {
  const insertEvent = db.prepare('INSERT INTO events (card_id, created_at, time_offset, note) VALUES (?, ?, ?, ?)')
  return db.transaction(() => {
    const id = Number(insertEvent.run(cardId, now, timeOffset, note).lastInsertRowid)
    writeTagsAndFacts(db, id, tags, facts)
    setAttachments(db, files, id, attachments)
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

/** Replaces an event's note, time, tags and values; created_at stays, so the new time becomes the offset from it. */
export function updateCheckin(db: DB, files: AttachmentFiles, id: number, { note, tags, facts, timeOffset, attachments }: CheckinInput) {
  const dropped = db.transaction(() => {
    db.prepare('UPDATE events SET time_offset = ?, note = ? WHERE id = ?').run(timeOffset, note, id)
    db.prepare('DELETE FROM checkin_tags WHERE checkin_id = ?').run(id)
    writeTagsAndFacts(db, id, tags, facts)
    db.prepare('DELETE FROM event_versions WHERE event_id = ?').run(id)
    return setAttachments(db, files, id, attachments)
  })()
  for (const attachment of dropped) files.remove(attachment)
}

export function deleteCheckin(db: DB, files: AttachmentFiles, id: number): boolean {
  const attachments = attachmentIdsOf(db, id)
  const deleted = db.prepare('DELETE FROM events WHERE id = ?').run(id).changes > 0
  for (const attachment of attachments) files.remove(attachment)
  return deleted
}
