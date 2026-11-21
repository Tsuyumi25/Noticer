import { randomUUID } from 'node:crypto'
import { closeSync, createReadStream, mkdirSync, openSync, readSync, rmSync, statSync, writeFileSync } from 'node:fs'
import { join } from 'node:path'
import { Readable } from 'node:stream'
import type { Context } from 'hono'
import type { DB } from './db.ts'

/** The largest file one attachment can be. */
export const MAX_ATTACHMENT_BYTES = 100 * 1024 * 1024
/** The largest thumbnail the browser may send along. */
export const MAX_THUMB_BYTES = 1024 * 1024
/** Uploads no saved event took up within this long are dropped. */
const STALE_UPLOAD_SECONDS = 24 * 3600

export interface Attachment {
  id: string
  name: string
  type: string
  size: number
  thumb: boolean
  /** Pixels of a picture or video, when known; a viewer lays the slide out from them before it loads. */
  width: number | null
  height: number | null
}

/** Where attachment bytes live: the file under its id, the thumbnail beside it. */
export class AttachmentFiles {
  constructor(readonly dir: string) {
    mkdirSync(dir, { recursive: true })
  }

  file(id: string): string {
    return join(this.dir, id)
  }

  thumb(id: string): string {
    return join(this.dir, `${id}.thumb`)
  }

  /** Empties the folder, for an import that replaces every event. */
  clear() {
    rmSync(this.dir, { recursive: true, force: true })
    mkdirSync(this.dir, { recursive: true })
  }

  remove(id: string) {
    rmSync(this.file(id), { force: true })
    rmSync(this.thumb(id), { force: true })
  }
}

interface Upload {
  name: string
  type: string
  bytes: Uint8Array
  thumb?: Uint8Array
  width?: number
  height?: number
  now: number
}

/** Keeps an upload unattached; a checkin or edit that lists its id takes it up. */
export function saveUpload(db: DB, files: AttachmentFiles, { name, type, bytes, thumb, width, height, now }: Upload): Attachment {
  dropStaleUploads(db, files, now)
  const id = randomUUID()
  writeFileSync(files.file(id), bytes)
  if (thumb) writeFileSync(files.thumb(id), thumb)
  const attachment: Attachment = {
    id,
    name,
    type: type || 'application/octet-stream',
    size: bytes.byteLength,
    thumb: thumb !== undefined,
    width: width ?? null,
    height: height ?? null,
  }
  db.prepare('INSERT INTO checkin_attachments (id, name, type, size, thumb, width, height, created_at) VALUES (?, ?, ?, ?, ?, ?, ?, ?)').run(
    id,
    attachment.name,
    attachment.type,
    attachment.size,
    attachment.thumb ? 1 : 0,
    attachment.width,
    attachment.height,
    now,
  )
  return attachment
}

function dropStaleUploads(db: DB, files: AttachmentFiles, now: number) {
  const stale = db
    .prepare<[number], { id: string }>('SELECT id FROM checkin_attachments WHERE checkin_id IS NULL AND created_at < ?')
    .all(now - STALE_UPLOAD_SECONDS)
  for (const { id } of stale) files.remove(id)
  db.prepare('DELETE FROM checkin_attachments WHERE checkin_id IS NULL AND created_at < ?').run(now - STALE_UPLOAD_SECONDS)
}

/** Ids among `ids` that are neither unattached uploads nor already this event's; null for a new event. */
export function unknownAttachments(db: DB, ids: string[], checkinId: number | null): string[] {
  const usable = db.prepare<[string, number], { id: string }>(
    'SELECT id FROM checkin_attachments WHERE id = ? AND (checkin_id IS NULL OR checkin_id = ?)',
  )
  return ids.filter((id) => !usable.get(id, checkinId ?? -1))
}

/** Makes `ids` the event's attachments in that order; ones it no longer lists are deleted with their files. */
export function setAttachments(db: DB, files: AttachmentFiles, checkinId: number, ids: string[]): string[] {
  const dropped = db
    .prepare<[number, string], { id: string }>(
      'SELECT id FROM checkin_attachments WHERE checkin_id = ? AND id NOT IN (SELECT value FROM json_each(?))',
    )
    .all(checkinId, JSON.stringify(ids))
    .map((r) => r.id)
  db.prepare('DELETE FROM checkin_attachments WHERE checkin_id = ? AND id NOT IN (SELECT value FROM json_each(?))').run(
    checkinId,
    JSON.stringify(ids),
  )
  const link = db.prepare('UPDATE checkin_attachments SET checkin_id = ?, sort_order = ? WHERE id = ?')
  ids.forEach((id, i) => link.run(checkinId, i, id))
  return dropped
}

/** The ids of an event's attachments, to remove their files once the event is gone. */
export function attachmentIdsOf(db: DB, checkinId: number): string[] {
  return db
    .prepare<[number], { id: string }>('SELECT id FROM checkin_attachments WHERE checkin_id = ?')
    .all(checkinId)
    .map((r) => r.id)
}

export function findAttachment(db: DB, id: string): Attachment | undefined {
  const row = db
    .prepare<[string], Omit<Attachment, 'thumb'> & { thumb: number }>(
      'SELECT id, name, type, size, thumb, width, height FROM checkin_attachments WHERE id = ?',
    )
    .get(id)
  return row && { ...row, thumb: row.thumb === 1 }
}

/** Thumbnails the browser draws are JPEG; ones carried over from the old app are WebP. */
export function thumbType(path: string): string {
  const head = Buffer.alloc(12)
  try {
    const fd = openSync(path, 'r')
    readSync(fd, head, 0, 12, 0)
    closeSync(fd)
  } catch {
    return 'image/jpeg'
  }
  return head.toString('latin1', 0, 4) === 'RIFF' && head.toString('latin1', 8, 12) === 'WEBP' ? 'image/webp' : 'image/jpeg'
}

// Shown in place only when the browser cannot run it as a page; anything else is offered as a download.
const INLINE = /^(image\/(?!svg)|video\/|audio\/|application\/pdf$)/

/** Sends a stored file, honouring a byte range so a video can be scrubbed. */
export function sendFile(c: Context, path: string, type: string, name?: string): Response {
  let size: number
  try {
    size = statSync(path).size
  } catch {
    return c.json({ error: 'file missing' }, 404)
  }
  c.header('Content-Type', type)
  c.header('X-Content-Type-Options', 'nosniff')
  c.header('Cache-Control', 'private, max-age=31536000, immutable')
  c.header('Accept-Ranges', 'bytes')
  if (name !== undefined) {
    c.header('Content-Disposition', `${INLINE.test(type) ? 'inline' : 'attachment'}; filename*=UTF-8''${encodeURIComponent(name)}`)
  }
  const range = /^bytes=(\d*)-(\d*)$/.exec(c.req.header('range') ?? '')
  let start = 0
  let end = size - 1
  if (range) {
    const [, from = '', to = ''] = range
    if (from === '') start = Math.max(0, size - Number(to))
    else {
      start = Number(from)
      if (to !== '') end = Math.min(end, Number(to))
    }
    if (start > end || start >= size) {
      c.header('Content-Range', `bytes */${size}`)
      return c.body(null, 416)
    }
    c.header('Content-Range', `bytes ${start}-${end}/${size}`)
  }
  c.header('Content-Length', String(end - start + 1))
  // Node's web stream is the same object as the one Hono takes; only the type declarations differ.
  const stream = Readable.toWeb(createReadStream(path, { start, end })) as ReadableStream
  return c.body(stream, range ? 206 : 200)
}
