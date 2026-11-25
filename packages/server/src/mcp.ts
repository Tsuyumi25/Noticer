import { spawn } from 'node:child_process'
import { timingSafeEqual } from 'node:crypto'
import { once } from 'node:events'
import { fileURLToPath } from 'node:url'
import { createMcpHandler, localhostAllowedOrigins, McpServer, originValidationResponse } from '@modelcontextprotocol/server'
import { z } from 'zod'
import type { Config, ConfigStore } from './config.ts'
import { buildDashboard, type CardModel } from './dashboard.ts'
import type { DB } from './db.ts'
import { listEvents, searchEvents, type EventRecord } from './events.ts'
import { PURE_CARD } from './pure.ts'
import { cardCalendar } from './review.ts'
import { analyzeSleep } from './sleep-analysis.ts'
import { blocksOf, sleepEvents } from './sleep.ts'
import { parseValueKey } from './values.ts'

const READ_ONLY = { readOnlyHint: true, destructiveHint: false, idempotentHint: true, openWorldHint: false } as const
const ENTRIES_DEFAULT = 100
const ENTRIES_MAX = 500
const SQL_SCRIPT = fileURLToPath(new URL('./sql.py', import.meta.url))
const SQL_KILL_MS = 3000
const SQL_MAX_CHARS = 4_000_000

const pad = (n: number) => String(n).padStart(2, '0')
const localDay = (d: Date) => `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}`
const localTime = (seconds: number) => {
  const d = new Date(seconds * 1000)
  return `${localDay(d)} ${pad(d.getHours())}:${pad(d.getMinutes())}`
}
const dayStart = (day: string) => new Date(`${day}T00:00`).getTime() / 1000
const nextDayStart = (day: string) => {
  const d = new Date(`${day}T00:00`)
  return new Date(d.getFullYear(), d.getMonth(), d.getDate() + 1).getTime() / 1000
}
const lastDays = (now: number, n: number) => {
  const d = new Date(now * 1000)
  return Array.from({ length: n }, (_, i) => localDay(new Date(d.getFullYear(), d.getMonth(), d.getDate() - (n - 1) + i)))
}
const day = z
  .string()
  .regex(/^\d{4}-\d{2}-\d{2}$/)
  .refine((s) => localDay(new Date(`${s}T00:00`)) === s, 'not a date')
const json = (value: unknown) => ({ content: [{ type: 'text' as const, text: JSON.stringify(value) }] })
const fail = (text: string) => ({ content: [{ type: 'text' as const, text }], isError: true })
const hours = (h: number | null) => (h === null ? null : Math.round(h * 10) / 10)

function describeEntry(config: Config, event: EventRecord) {
  const card = config.cards.find((k) => k.id === event.cardId)
  const values: Record<string, string> = {}
  const choices: Record<string, string> = {}
  for (const [key, value] of Object.entries(event.facts)) {
    const parsed = parseValueKey(key)
    if (parsed && typeof value === 'number') values[parsed.tag] = `${value}${parsed.unit ? ` ${parsed.unit}` : ''}`
    const input = config.factInputs[key]
    if (input) {
      const label = input.options.find((o) => o.value === value)?.label
      choices[input.name] = label ? `${value} ${label}` : String(value)
    }
  }
  return {
    id: event.id,
    time: localTime(event.eventAt),
    ...(event.timeOffset < 0 ? { backdated: true } : {}),
    card: event.cardId === PURE_CARD ? 'quick note' : (card?.name ?? event.cardId),
    tags: event.tags.filter((t) => t !== card?.root),
    ...(Object.keys(values).length ? { values } : {}),
    ...(Object.keys(choices).length ? { choices } : {}),
    ...(event.note ? { note: event.note } : {}),
    ...(event.attachments.length ? { attachments: event.attachments.length } : {}),
  }
}

function describeCard(card: CardModel, days: string[]) {
  return {
    id: card.id,
    name: card.name,
    emoji: card.emoji,
    status: card.status,
    ...(card.mode ? { limitMeans: card.mode === 'late' ? 'overdue once hoursSinceLast passes limitHours' : 'too soon until hoursSinceLast reaches limitHours' } : {}),
    hoursSinceLast: hours(card.nowHours),
    limitHours: hours(card.maxHours),
    ...(card.strip ? { lastSixDays: card.strip.shown.map((shown, i) => ({ date: days[i], shown, state: card.strip!.states[i] })) } : {}),
  }
}

type SqlResult = { columns: string[]; rows: unknown[][]; truncated: boolean } | { error: string }

async function runSql(path: string, sql: string): Promise<SqlResult> {
  const child = spawn('python3', [SQL_SCRIPT, path], { timeout: SQL_KILL_MS, killSignal: 'SIGKILL' })
  let out = ''
  let err = ''
  let overflow = false
  child.stdout.setEncoding('utf8').on('data', (chunk: string) => {
    out += chunk
    if (out.length > SQL_MAX_CHARS && !overflow) {
      overflow = true
      child.kill('SIGKILL')
    }
  })
  child.stderr.setEncoding('utf8').on('data', (chunk: string) => (err += chunk))
  child.stdin.on('error', () => {})
  child.stdin.end(sql)
  let code: number | null
  let signal: NodeJS.Signals | null
  try {
    ;[code, signal] = (await once(child, 'close')) as [number | null, NodeJS.Signals | null]
  } catch (error) {
    return { error: `could not start python3: ${(error as Error).message}` }
  }
  if (overflow) return { error: `result passed ${SQL_MAX_CHARS / 1_000_000}M characters; select fewer columns or rows` }
  if (signal) return { error: `stopped after ${SQL_KILL_MS / 1000} s; narrow the query` }
  try {
    return JSON.parse(out) as SqlResult
  } catch {
    return { error: err.trim() || `sql runner exited with ${code}` }
  }
}

function buildServer(db: DB, store: ConfigStore): McpServer {
  const server = new McpServer({ name: 'noticer', version: '1.0.0' })

  server.registerTool(
    'list_cards',
    {
      title: 'Cards and their status',
      description:
        'Every card on the home screen with its status right now: danger/warning/pending/good/unknown, hours since the last entry, the limit it is judged against, and the last six days of its daily strip (oldest first; `shown` is the number displayed that day, `state` its colour). Also the sleep pair: awake or asleep, for how long, and the predicted next sleep. Use card ids from here with card_report.',
      annotations: { title: 'Cards and their status', ...READ_ONLY },
    },
    () => {
      const now = Math.floor(Date.now() / 1000)
      const board = buildDashboard(store.read(), listEvents(db, 0, now + 1), now)
      const sleep = board.sleep && {
        state: board.sleep.state,
        status: board.sleep.status,
        hours: hours(board.sleep.hours),
        lastSleepHours: hours(board.sleep.lastSleepHours),
        predictedSleepAt: board.sleep.predictedSleepAt === null ? null : localTime(board.sleep.predictedSleepAt),
      }
      return json({ now: localTime(now), sleep, cards: [...board.urgent, ...board.others].map((card) => describeCard(card, lastDays(now, 6))) })
    },
  )

  server.registerTool(
    'list_entries',
    {
      title: 'Entries between two days',
      description: `Entries recorded from one local day to another (both inclusive), oldest first. Each entry has its local time, card ("quick note" for entries outside any card), tags, the numbers recorded on tags (values), choices such as mood, and the note. Narrow with card_id or tag. Returns at most ${ENTRIES_MAX}; when more exist the result says so and gives the offset to continue from — prefer a narrower range.`,
      inputSchema: z.object({
        from: day.describe('First local day, YYYY-MM-DD'),
        to: day.describe('Last local day, YYYY-MM-DD'),
        card_id: z.string().optional().describe('Only entries of this card (ids from list_cards)'),
        tag: z.string().optional().describe('Only entries carrying this tag'),
        limit: z.number().int().min(1).max(ENTRIES_MAX).default(ENTRIES_DEFAULT),
        offset: z.number().int().min(0).default(0),
      }),
      annotations: { title: 'Entries between two days', ...READ_ONLY },
    },
    ({ from, to, card_id, tag, limit, offset }) => {
      if (from > to) return fail('`from` is after `to`.')
      const config = store.read()
      const all = listEvents(db, dayStart(from), nextDayStart(to)).filter(
        (e) => (card_id === undefined || e.cardId === card_id) && (tag === undefined || e.tags.includes(tag)),
      )
      const page = all.slice(offset, offset + limit)
      const rest = all.length - offset - page.length
      return json({
        total: all.length,
        entries: page.map((e) => describeEntry(config, e)),
        ...(rest > 0 ? { more: `${rest} more; call again with offset ${offset + page.length}, or narrow the range` } : {}),
      })
    },
  )

  server.registerTool(
    'search_entries',
    {
      title: 'Search entries',
      description: 'Entries whose note or any tag contains the text, newest first, with the total number of matches. Pass the returned `next` back as `after` for the following page.',
      inputSchema: z.object({
        text: z.string().trim().min(1),
        limit: z.number().int().min(1).max(200).default(50),
        after: z
          .string()
          .regex(/^\d+:\d+$/)
          .optional()
          .describe('The `next` value from the previous page'),
      }),
      annotations: { title: 'Search entries', ...READ_ONLY },
    },
    ({ text, limit, after }) => {
      const config = store.read()
      const [eventAt, id] = after ? after.split(':').map(Number) : []
      const page = searchEvents(db, text, limit, after ? { eventAt: eventAt!, id: id! } : null)
      return json({
        ...(page.total === null ? {} : { total: page.total }),
        entries: page.events.map((e) => describeEntry(config, e)),
        next: page.next ? `${page.next.eventAt}:${page.next.id}` : null,
      })
    },
  )

  server.registerTool(
    'card_report',
    {
      title: 'A card day by day',
      description:
        "One card's report calendar: for every local day, the value it shows (count, total, latest number, ✓ or a choice) and its state as judged by the card's looking-back rule (good/warning/danger/none; `logged` when the card only records). Defaults to the last 30 days; days before the month of the card's first entry are left out.",
      inputSchema: z.object({
        card_id: z.string().describe('A card id from list_cards'),
        from: day.optional().describe('First local day, YYYY-MM-DD'),
        to: day.optional().describe('Last local day, YYYY-MM-DD'),
      }),
      annotations: { title: 'A card day by day', ...READ_ONLY },
    },
    ({ card_id, from, to }) => {
      const config = store.read()
      const card = config.cards.find((k) => k.id === card_id)
      if (!card) return fail(`No card ${card_id}. Call list_cards for the ids.`)
      const now = Math.floor(Date.now() / 1000)
      const today = new Date(now * 1000)
      const last = to ?? localDay(today)
      const first = from ?? localDay(new Date(today.getFullYear(), today.getMonth(), today.getDate() - 29))
      if (first > last) return fail('`from` is after `to`.')
      const calendar = cardCalendar(config, card, listEvents(db, 0, now + 1), now)
      return json({
        card: { id: card.id, name: card.name, emoji: card.emoji },
        days: calendar.days.filter((d) => d.date >= first && d.date <= last),
      })
    },
  )

  server.registerTool(
    'sleep_summary',
    {
      title: 'Sleep rhythm',
      description:
        'Sleep rhythm over the last N days: free-running period τ in hours and daily drift in minutes, regularity, current phase, sleep duration stats, the predicted next sleep, and forecast windows when the rhythm lines up with normal nights. Times are local.',
      inputSchema: z.object({ days: z.number().int().min(30).max(730).default(90) }),
      annotations: { title: 'Sleep rhythm', ...READ_ONLY },
    },
    ({ days }) => {
      const now = Math.floor(Date.now() / 1000)
      const events = listEvents(db, now - days * 86400, now + 1)
      const { blocks, predictedSleepAt, ...analysis } = analyzeSleep(blocksOf(sleepEvents(events, now)), now)
      return json({ ...analysis, sleepsCounted: blocks.length, predictedSleepAt: predictedSleepAt === null ? null : localTime(predictedSleepAt) })
    },
  )

  if (store.read().mcp.sql) {
    server.registerTool(
      'execute_sql',
      {
        title: 'Read-only SQL',
        description:
          "One read-only SQLite statement (SELECT or WITH) against the app's database; returns columns and rows, at most 1000 (`truncated` when there were more), and stops a query after 1 second. Writes, ATTACH and PRAGMAs other than schema ones such as pragma_table_info are refused. Tables: events (one row per entry: card_id, event_at in Unix seconds — datetime(event_at, 'unixepoch', 'localtime') gives local time —, time_offset < 0 when backdated, note), checkin_tags joined to tags_dict (an entry's tags), checkin_facts (k, value: numbers on tags keyed `tag:unit`, choices such as mood keyed by their input), checkin_attachments, event_versions (edits sent from devices). `SELECT sql FROM sqlite_master` shows the full schema. Card names, rules and fact labels are not in the database: card ids come from list_cards, and card_id `pure` is a quick note outside any card. Prefer the other tools when they already answer the question.",
        inputSchema: z.object({ sql: z.string().trim().min(1).max(100_000) }),
        annotations: { title: 'Read-only SQL', ...READ_ONLY },
      },
      async ({ sql }) => {
        const result = await runSql(db.name, sql)
        return 'error' in result ? fail(result.error) : json(result)
      },
    )
  }

  return server
}

function sameToken(given: string, expected: string) {
  const a = Buffer.from(given)
  const b = Buffer.from(expected)
  return a.length === b.length && timingSafeEqual(a, b)
}

export function mcpFetch(db: DB, store: ConfigStore, token: string | undefined) {
  const handler = createMcpHandler(() => buildServer(db, store))
  return (request: Request): Response | Promise<Response> => {
    if (!token) return Response.json({ error: 'MCP is off; set NOTICER_MCP_TOKEN to turn it on' }, { status: 404 })
    const rejected = originValidationResponse(request, localhostAllowedOrigins())
    if (rejected) return rejected
    const [scheme, given] = (request.headers.get('authorization') ?? '').split(' ', 2)
    if (scheme?.toLowerCase() !== 'bearer' || !given || !sameToken(given, token)) {
      return Response.json({ error: 'missing or wrong bearer token' }, { status: 401, headers: { 'WWW-Authenticate': 'Bearer' } })
    }
    return handler.fetch(request)
  }
}
