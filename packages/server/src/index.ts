import { serve } from '@hono/node-server'
import { createApp } from './app.ts'
import { AttachmentFiles } from './attachments.ts'
import { fileStore } from './config.ts'
import { openDb } from './db.ts'
import { attachmentsDir, configPath, dbPath } from './paths.ts'

const port = Number(process.env.PORT ?? 3040)

serve({ fetch: createApp(openDb(dbPath), fileStore(configPath), new AttachmentFiles(attachmentsDir)).fetch, port }, (info) => {
  console.log(`Listening on http://localhost:${info.port}`)
})
