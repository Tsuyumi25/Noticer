import { mkdirSync } from 'node:fs'
import { join, resolve } from 'node:path'
import { fileURLToPath } from 'node:url'

const repoRoot = fileURLToPath(new URL('../../../', import.meta.url))
const dataDir = resolve(repoRoot, process.env.DATA_DIR ?? 'data')
mkdirSync(dataDir, { recursive: true })

export const dbPath = join(dataDir, 'app.db')
export const configPath = join(dataDir, 'config.json')
