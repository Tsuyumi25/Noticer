import { serve } from '@hono/node-server'
import { createApp } from './app.ts'
import { openDb } from './db.ts'
import { dbPath } from './paths.ts'

const port = Number(process.env.PORT ?? 3040)

serve({ fetch: createApp(openDb(dbPath)).fetch, port }, (info) => {
  console.log(`Listening on http://localhost:${info.port}`)
})
