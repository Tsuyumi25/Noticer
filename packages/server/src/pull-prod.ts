import { z } from 'zod'
import { AttachmentFiles, saveUpload, setAttachments } from './attachments.ts'
import { importRecords, recordSchema, type BackupRecord } from './backup.ts'
import { writeConfig, type FactInput, type RawConfig } from './config.ts'
import { convertLegacyConfig, convertLegacyValues } from './legacy.ts'
import { openDb } from './db.ts'
import { attachmentsDir, configPath, dbPath } from './paths.ts'

const base = process.argv[2]?.replace(/\/$/, '')
if (!base) {
  console.error('usage: pull-prod <old-app-base-url>')
  process.exit(1)
}

async function getJson(path: string): Promise<unknown> {
  const res = await fetch(`${base}${path}`)
  if (!res.ok) throw new Error(`${path}: HTTP ${res.status}`)
  return res.json()
}

// The old app hard-wired one input component per value; numbers become tag values, choices stay facts.
const FACT_INPUTS: Record<string, FactInput> = {
  mood_emoji: {
    kind: 'choice',
    name: '心情',
    options: [
      { value: '😊', label: '很好' },
      { value: '🙂', label: '不錯' },
      { value: '😐', label: '普通' },
      { value: '😔', label: '不好' },
      { value: '😵', label: '很差' },
    ],
  },
}
const COMPONENT_FACTS: Record<string, string> = {
  WeightActivityInput: 'weight_kg',
  ExerciseActivityInput: 'duration_min',
  WakeActivityInput: 'mood_emoji',
}

const [cards, trackersStatus, trackersPeriodic, tagGroups] = (await Promise.all([
  getJson('/api/config/cards'),
  getJson('/api/config/trackers/status'),
  getJson('/api/config/trackers/periodic'),
  getJson('/api/config/tags/roots'),
])) as [RawConfig['cards'], unknown, unknown, unknown]
const mapped = cards.map(({ inputComponent, showMoodPicker, ...card }) => {
  const fact = COMPONENT_FACTS[String(inputComponent)] ?? (showMoodPicker === true ? 'mood_emoji' : undefined)
  return fact ? { ...card, facts: [fact] } : card
})

const historyPage = z.object({ data: z.array(recordSchema.extend({ images: z.array(z.string()).default([]) })) })
const WEEK = 7 * 86400
const PAGE_LIMIT = 500
const byId = new Map<number, BackupRecord>()
const imagesOf = new Map<number, string[]>()
const end = Math.floor(Date.now() / 1000) + 86400
for (let from = Date.UTC(2024, 0, 1) / 1000; from < end; from += WEEK) {
  const to = from + WEEK
  const page = historyPage.parse(await getJson(`/api/history?limit=${PAGE_LIMIT}&start_time=${from}&end_time=${to}`))
  if (page.data.length >= PAGE_LIMIT) throw new Error(`window ${from}–${to} hit the ${PAGE_LIMIT} row limit`)
  for (const { images, ...r } of page.data) {
    byId.set(r.id, r)
    if (images.length) imagesOf.set(r.id, images)
  }
}

const sorted = [...byId.values()].sort((a, b) => Date.parse(a.event_at) - Date.parse(b.event_at) || a.id - b.id)
const legacy = convertLegacyConfig({ cards: mapped, trackersStatus, trackersPeriodic, tagGroups, factInputs: FACT_INPUTS })
const { config, records } = convertLegacyValues(legacy, sorted)
writeConfig(configPath, config)
console.log(`Wrote config to ${configPath}`)
const db = openDb(dbPath)
const count = importRecords(db, records)
console.log(`Imported ${count} events into ${dbPath}`)

async function download(path: string): Promise<{ bytes: Uint8Array; type: string }> {
  const res = await fetch(`${base}${path}`)
  if (!res.ok) throw new Error(`${path}: HTTP ${res.status}`)
  return { bytes: new Uint8Array(await res.arrayBuffer()), type: res.headers.get('content-type') ?? 'application/octet-stream' }
}

/** A WebP's pixel size from its header (lossy, lossless or extended), or nothing for anything else. */
function webpSize(bytes: Uint8Array): { width: number; height: number } | Record<string, never> {
  const text = (from: number, to: number) => String.fromCharCode(...bytes.subarray(from, to))
  if (bytes.length < 30 || text(0, 4) !== 'RIFF' || text(8, 12) !== 'WEBP') return {}
  const u16 = (at: number) => bytes[at]! | (bytes[at + 1]! << 8)
  const u24 = (at: number) => u16(at) | (bytes[at + 2]! << 16)
  switch (text(12, 16)) {
    case 'VP8X':
      return { width: u24(24) + 1, height: u24(27) + 1 }
    case 'VP8 ':
      return { width: u16(26) & 0x3fff, height: u16(28) & 0x3fff }
    case 'VP8L': {
      const bits = (bytes[21]! | (bytes[22]! << 8) | (bytes[23]! << 16) | (bytes[24]! << 24)) >>> 0
      return { width: (bits & 0x3fff) + 1, height: ((bits >>> 14) & 0x3fff) + 1 }
    }
    default:
      return {}
  }
}

// The old app kept each image as a 2560px WebP plus a 300px thumbnail, under one file name per image.
const files = new AttachmentFiles(attachmentsDir)
files.clear()
let images = 0
for (const [eventId, names] of imagesOf) {
  const ids: string[] = []
  for (const name of names) {
    const original = await download(`/uploads/original/${encodeURIComponent(name)}`)
    const thumb = await download(`/uploads/${encodeURIComponent(name)}`)
    ids.push(
      saveUpload(db, files, {
        name,
        type: original.type,
        bytes: original.bytes,
        thumb: thumb.bytes,
        ...webpSize(original.bytes),
        now: Math.floor(Date.now() / 1000),
      }).id,
    )
    images++
  }
  setAttachments(db, files, eventId, ids)
}
console.log(`Copied ${images} images into ${attachmentsDir}`)
