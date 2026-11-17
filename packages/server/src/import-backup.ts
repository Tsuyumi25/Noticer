import { readdirSync, readFileSync } from 'node:fs'
import { join } from 'node:path'
import { importMonths, monthFileSchema } from './backup.ts'
import { openDb } from './db.ts'
import { dbPath } from './paths.ts'

const dir = process.argv[2]
if (!dir) {
  console.error('usage: import-backup <backup-dir>')
  process.exit(1)
}

const months = readdirSync(dir)
  .filter((name) => /^\d{4}-\d{2}\.json$/.test(name))
  .sort()
  .map((name) => monthFileSchema.parse(JSON.parse(readFileSync(join(dir, name), 'utf8'))))

const count = importMonths(openDb(dbPath), months)
console.log(`Imported ${count} events from ${months.length} months into ${dbPath}`)
