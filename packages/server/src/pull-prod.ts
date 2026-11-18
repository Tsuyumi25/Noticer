import { z } from 'zod'
import { importRecords, recordSchema, type BackupRecord } from './backup.ts'
import { writeConfig, type FactInput, type RawConfig } from './config.ts'
import { openDb } from './db.ts'
import { configPath, dbPath } from './paths.ts'

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

// The old app hard-wired one input component per value; here each becomes a fact the card declares.
const FACT_INPUTS: Record<string, FactInput> = {
  weight_kg: { kind: 'number', name: '體重', unit: 'kg', decimals: 1, min: 30, max: 200, steps: [0.1, 1], initial: 'last', required: true },
  duration_min: { kind: 'number', name: '時長', unit: '分鐘', decimals: 0, min: 0, max: 600, steps: [1, 5], presets: [10, 15, 20, 30], initial: 20, required: true },
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
writeConfig(configPath, { cards: mapped, trackersStatus, trackersPeriodic, tagGroups, factInputs: FACT_INPUTS })
console.log(`Wrote config to ${configPath}`)

const historyPage = z.object({ data: z.array(recordSchema.passthrough()) })
const WEEK = 7 * 86400
const PAGE_LIMIT = 500
const byId = new Map<number, BackupRecord>()
const end = Math.floor(Date.now() / 1000) + 86400
for (let from = Date.UTC(2024, 0, 1) / 1000; from < end; from += WEEK) {
  const to = from + WEEK
  const page = historyPage.parse(await getJson(`/api/history?limit=${PAGE_LIMIT}&start_time=${from}&end_time=${to}`))
  if (page.data.length >= PAGE_LIMIT) throw new Error(`window ${from}–${to} hit the ${PAGE_LIMIT} row limit`)
  for (const r of page.data) byId.set(r.id, r)
}

const records = [...byId.values()].sort((a, b) => Date.parse(a.event_at) - Date.parse(b.event_at) || a.id - b.id)
const count = importRecords(openDb(dbPath), records)
console.log(`Imported ${count} events into ${dbPath}`)
