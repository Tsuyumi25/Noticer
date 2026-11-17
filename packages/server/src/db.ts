import Database from 'better-sqlite3'
import { readFileSync } from 'node:fs'

const schema = readFileSync(new URL('./schema.sql', import.meta.url), 'utf8')

export type DB = Database.Database

export function openDb(path: string): DB {
  const db = new Database(path)
  db.pragma('journal_mode = WAL')
  db.exec(schema)
  return db
}
