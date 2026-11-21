import { existsSync, readdirSync, readFileSync } from 'node:fs'
import { join } from 'node:path'
import { z } from 'zod'
import { AttachmentFiles } from './attachments.ts'
import { importRecords, monthFileSchema, type BackupRecord } from './backup.ts'
import { writeConfig } from './config.ts'
import { convertLegacyConfig, convertLegacyValues } from './legacy.ts'
import { openDb } from './db.ts'
import { attachmentsDir, configPath, dbPath } from './paths.ts'

const dir = process.argv[2]
if (!dir) {
  console.error('usage: import-backup <backup-dir>')
  process.exit(1)
}

const records = readdirSync(dir)
  .filter((name) => /^\d{4}-\d{2}\.json$/.test(name))
  .sort()
  .flatMap((name) => monthFileSchema.parse(JSON.parse(readFileSync(join(dir, name), 'utf8'))).records)

const row = z.object({ id: z.string(), position: z.number(), config: z.string() }).passthrough()
const snapshotSchema = z.object({
  cards: z.array(row.extend({ tag: z.string(), tracker_id: z.string().nullable() })),
  trackers_status: z.array(row.extend({ type: z.string() })),
  trackers_periodic: z.array(row.extend({ type: z.string() })),
})

let imported: BackupRecord[] = records
const snapshotPath = join(dir, 'config.json')
if (existsSync(snapshotPath)) {
  const snapshot = snapshotSchema.parse(JSON.parse(readFileSync(snapshotPath, 'utf8')))
  const byPosition = <T extends { position: number }>(rows: T[]) => [...rows].sort((a, b) => a.position - b.position)
  const legacy = convertLegacyConfig({
    cards: byPosition(snapshot.cards).map((c) => ({ id: c.id, tag: c.tag, trackerId: c.tracker_id, ...JSON.parse(c.config) })),
    trackersStatus: byPosition(snapshot.trackers_status).map((t) => ({ id: t.id, type: t.type, ...JSON.parse(t.config) })),
    trackersPeriodic: byPosition(snapshot.trackers_periodic).map((t) => ({ id: t.id, type: t.type, ...JSON.parse(t.config) })),
  })
  const converted = convertLegacyValues(legacy, records)
  imported = converted.records
  writeConfig(configPath, converted.config)
  console.log(`Wrote config to ${configPath}`)
}

const count = importRecords(openDb(dbPath), imported)
// Backup files carry no attachment bytes, so the events they replace take theirs along.
new AttachmentFiles(attachmentsDir).clear()
console.log(`Imported ${count} events into ${dbPath}`)
