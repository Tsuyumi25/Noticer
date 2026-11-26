import Database from 'better-sqlite3'
import { readFileSync } from 'node:fs'

const schema = readFileSync(new URL('./schema.sql', import.meta.url), 'utf8')
const VERSION = 2

export type DB = Database.Database

export function openDb(path: string): DB {
  const db = new Database(path)
  db.pragma('journal_mode = WAL')
  const tables = db.prepare("SELECT COUNT(*) AS n FROM sqlite_master WHERE type = 'table' AND name NOT LIKE 'sqlite_%'").get() as { n: number }
  const version = db.pragma('user_version', { simple: true })
  if (tables.n > 0 && version !== VERSION) {
    db.close()
    throw new Error(`${path} is in an older format (user_version ${version}); pull the data again with pnpm pull-prod`)
  }
  db.exec(schema)
  return db
}
