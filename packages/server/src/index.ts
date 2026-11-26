import { serve } from '@hono/node-server'
import { createApp } from './app.ts'
import { AttachmentFiles } from './attachments.ts'
import { dbStore } from './configDb.ts'
import { openDb } from './db.ts'
import { attachmentsDir, dbPath } from './paths.ts'

const port = Number(process.env.PORT ?? 3040)

const db = openDb(dbPath)

serve({ fetch: createApp(db, dbStore(db), new AttachmentFiles(attachmentsDir), { mcpToken: process.env.NOTICER_MCP_TOKEN }).fetch, port }, (info) => {
  console.log(`Listening on http://localhost:${info.port}`)
})
