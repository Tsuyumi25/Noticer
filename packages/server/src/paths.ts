import Database from 'better-sqlite3'
import { existsSync, mkdirSync, rmSync } from 'node:fs'
import { join, resolve } from 'node:path'
import { fileURLToPath } from 'node:url'

const repoRoot = fileURLToPath(new URL('../../../', import.meta.url))
const dataDir = resolve(repoRoot, process.env.DATA_DIR ?? 'data')
mkdirSync(dataDir, { recursive: true })

export const dbPath = join(dataDir, 'app.db')
export const attachmentsDir = join(dataDir, 'attachments')

export function resetDb() {
  rmSync(join(dataDir, 'config.json'), { force: true })
  if (!existsSync(dbPath)) return
  const db = new Database(dbPath)
  db.pragma('foreign_keys = OFF')
  const objects = db
    .prepare<[], { type: string; name: string }>("SELECT type, name FROM sqlite_master WHERE type IN ('table', 'view') AND name NOT LIKE 'sqlite_%'")
    .all()
  db.transaction(() => {
    for (const { type, name } of objects) db.exec(`DROP ${type.toUpperCase()} IF EXISTS "${name.replaceAll('"', '""')}"`)
    if (db.prepare("SELECT 1 FROM sqlite_master WHERE name = 'sqlite_sequence'").get()) db.exec('DELETE FROM sqlite_sequence')
  })()
  db.pragma('user_version = 0')
  db.close()
}
