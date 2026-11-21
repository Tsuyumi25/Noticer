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

const eventColumns = `
  SELECT e.id, e.card_id, e.event_at, e.time_offset, e.note,
    (SELECT json_group_array(name) FROM (
       SELECT t.name FROM checkin_tags ct JOIN tags_dict t ON t.id = ct.tag_id
       WHERE ct.checkin_id = e.id ORDER BY t.id
    )) AS tags,
    (SELECT json_group_object(f.k, json_array(f.type, f.value))
       FROM checkin_facts f WHERE f.checkin_id = e.id) AS facts,
    (SELECT json_group_array(json_object('id', id, 'name', name, 'type', type, 'size', size, 'thumb', json(iif(thumb, 'true', 'false')), 'width', width, 'height', height))
       FROM (SELECT * FROM checkin_attachments a WHERE a.checkin_id = e.id ORDER BY a.sort_order)) AS attachments
  FROM events e`

export function listEvents(db: DB, from: number, to: number): EventRecord[] {
  return db
    .prepare<[number, number], EventRow>(`${eventColumns} WHERE e.event_at >= ? AND e.event_at < ? ORDER BY e.event_at, e.id`)
    .all(from, to)
    .map(toRecord)
}

/** Where a page of results stopped: the last event shown, so the next page starts just older than it. */
export interface SearchCursor {
  eventAt: number
  id: number
}

export interface SearchPage {
  events: EventRecord[]
  /** Every match, counted on the first page only. */
  total: number | null
  next: SearchCursor | null
}

const matches = `(e.note LIKE @pattern ESCAPE '\\'
  OR EXISTS (SELECT 1 FROM checkin_tags ct JOIN tags_dict t ON t.id = ct.tag_id WHERE ct.checkin_id = e.id AND t.name LIKE @pattern ESCAPE '\\'))`

/** Events whose note or any tag contains `text`, newest first, one page at a time. */
export function searchEvents(db: DB, text: string, limit: number, after: SearchCursor | null): SearchPage {
  const pattern = `%${text.replace(/[\\%_]/g, (ch) => `\\${ch}`)}%`
  const rows = db
    .prepare<{ pattern: string; at: number; id: number; take: number }, EventRow>(
      `${eventColumns}
       WHERE ${matches} AND (e.event_at < @at OR (e.event_at = @at AND e.id < @id))
       ORDER BY e.event_at DESC, e.id DESC LIMIT @take`,
    )
    .all({ pattern, at: after?.eventAt ?? Number.MAX_SAFE_INTEGER, id: after?.id ?? Number.MAX_SAFE_INTEGER, take: limit + 1 })
  const events = rows.slice(0, limit).map(toRecord)
  const last = events.at(-1)
  return {
    events,
    total: after ? null : db.prepare<{ pattern: string }, { n: number }>(`SELECT COUNT(*) AS n FROM events e WHERE ${matches}`).get({ pattern })!.n,
    next: rows.length > limit && last ? { eventAt: last.eventAt, id: last.id } : null,
  }
}

/** How many entries each local day holds, oldest day first; days without any are left out. */
export function dayCounts(db: DB): { date: string; count: number }[] {
  return db
    .prepare<[], { date: string; count: number }>(
      `SELECT date(event_at, 'unixepoch', 'localtime') AS date, COUNT(*) AS count FROM events GROUP BY 1 ORDER BY 1`,
    )
    .all()
}

/** A picture or video someone attached, with the event it sits on. */
export interface MediaItem extends Attachment {
  eventId: number
  eventAt: number
}

/** Every attached picture and video, newest event first and in each event's own order. */
export function listMedia(db: DB): MediaItem[] {
  return db
    .prepare<[], Omit<MediaItem, 'thumb'> & { thumb: number }>(
      `SELECT a.id, a.name, a.type, a.size, a.thumb, a.width, a.height, e.id AS eventId, e.event_at AS eventAt
       FROM checkin_attachments a JOIN events e ON e.id = a.checkin_id
       WHERE a.type LIKE 'image/%' OR a.type LIKE 'video/%'
       ORDER BY e.event_at DESC, e.id DESC, a.sort_order`,
    )
    .all()
    .map((row) => ({ ...row, thumb: row.thumb === 1 }))
}

function toRecord(row: EventRow): EventRecord {
  return {
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
  }
}
