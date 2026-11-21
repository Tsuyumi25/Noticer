import type { Attachment } from './attachments.ts'
import type { DB } from './db.ts'

export type FactValue = string | number | boolean

export interface EventRecord {
  id: number
  cardId: string
  eventAt: number
  timeOffset: number
  note: string | null
  tags: string[]
  facts: Record<string, FactValue>
  attachments: Attachment[]
}

interface EventRow {
  id: number
  card_id: string
  event_at: number
  time_offset: number
  note: string | null
  tags: string
  facts: string
  attachments: string
}

type FactPair = ['text' | 'integer' | 'real' | 'boolean', string | number]

const listInRange = `
  SELECT e.id, e.card_id, e.event_at, e.time_offset, e.note,
    (SELECT json_group_array(name) FROM (
       SELECT t.name FROM checkin_tags ct JOIN tags_dict t ON t.id = ct.tag_id
       WHERE ct.checkin_id = e.id ORDER BY t.id
    )) AS tags,
    (SELECT json_group_object(f.k, json_array(f.type, f.value))
       FROM checkin_facts f WHERE f.checkin_id = e.id) AS facts,
    (SELECT json_group_array(json_object('id', id, 'name', name, 'type', type, 'size', size, 'thumb', json(iif(thumb, 'true', 'false')), 'width', width, 'height', height))
       FROM (SELECT * FROM checkin_attachments a WHERE a.checkin_id = e.id ORDER BY a.sort_order)) AS attachments
  FROM events e
  WHERE e.event_at >= ? AND e.event_at < ?
  ORDER BY e.event_at, e.id
`

export function listEvents(db: DB, from: number, to: number): EventRecord[] {
  const rows = db.prepare<[number, number], EventRow>(listInRange).all(from, to)
  return rows.map((row) => ({
    id: row.id,
    cardId: row.card_id,
    eventAt: row.event_at,
    timeOffset: row.time_offset,
    note: row.note,
    tags: JSON.parse(row.tags) as string[],
    facts: Object.fromEntries(
      Object.entries(JSON.parse(row.facts) as Record<string, FactPair>).map(([k, [type, value]]) => [
        k,
        type === 'boolean' ? value === 1 : value,
      ]),
    ),
    attachments: JSON.parse(row.attachments) as Attachment[],
  }))
}
