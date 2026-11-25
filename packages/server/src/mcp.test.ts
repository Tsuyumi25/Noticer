import { mkdtempSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { describe, expect, it } from 'vitest'
import { createApp } from './app.ts'
import { AttachmentFiles } from './attachments.ts'
import { emptyConfig, memoryStore } from './config.ts'
import { openDb } from './db.ts'

const unjudged = { find: { match: 'all', blocks: [] }, now: {}, back: null } as const
const config = {
  ...emptyConfig,
  cards: [
    { id: 'practice', name: '練習', root: '練習', emoji: '🎹', rules: unjudged, facts: ['mood_emoji'] },
    { id: 'tea', name: '喝茶', root: '喝茶', emoji: '🍵', rules: unjudged },
  ],
  tagGroups: { 練習: { groups: [], values: { 鋼琴: { unit: '分鐘', decimals: 0, keep: 'sum' } } } },
  factInputs: { mood_emoji: { kind: 'choice', name: '心情', options: [{ value: '🙂', label: '不錯' }] } },
}
const TOKEN = 'fixture-token'

function setup(mcpToken: string | undefined, db = openDb(':memory:')) {
  const app = createApp(db, memoryStore(config), new AttachmentFiles(mkdtempSync(join(tmpdir(), 'noticer-mcp-'))), { mcpToken })
  const api = (method: string, path: string, body: unknown) =>
    app.request(path, { method, headers: { 'content-type': 'application/json' }, body: JSON.stringify(body) })
  const rpc = (method: string, params: unknown, headers: Record<string, string> = { authorization: `Bearer ${TOKEN}` }) =>
    app.request('/mcp', {
      method: 'POST',
      headers: { 'content-type': 'application/json', accept: 'application/json, text/event-stream', ...headers },
      body: JSON.stringify({ jsonrpc: '2.0', id: 1, method, params }),
    })
  const body = async (res: Response) => {
    const text = await res.text()
    return JSON.parse(text.startsWith('event:') ? text.split('\n').find((l) => l.startsWith('data: '))!.slice(6) : text)
  }
  const call = async (name: string, args: unknown) => {
    const result = (await body(await rpc('tools/call', { name, arguments: args }))).result as { content: { text: string }[]; isError?: boolean }
    return { isError: result.isError ?? false, data: result.isError ? result.content[0]!.text : JSON.parse(result.content[0]!.text) }
  }
  return { api, rpc, call, body }
}

const today = () => {
  const d = new Date()
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`
}

describe('mcp', () => {
  it('stays off without a token, and turns away a missing or wrong token and a foreign browser origin', async () => {
    expect((await setup(undefined).rpc('tools/list', {})).status).toBe(404)
    const { rpc } = setup(TOKEN)
    expect((await rpc('tools/list', {}, {})).status).toBe(401)
    expect((await rpc('tools/list', {}, { authorization: 'Bearer nope' })).status).toBe(401)
    expect((await rpc('tools/list', {}, { authorization: `Bearer ${TOKEN}`, origin: 'https://evil.example' })).status).toBe(403)
    expect((await rpc('tools/list', {})).status).toBe(200)
    expect((await rpc('tools/list', {}, { authorization: `bearer ${TOKEN}` })).status).toBe(200)
  })

  it('offers only read-only tools', async () => {
    const { rpc, body } = setup(TOKEN)
    const tools = (await body(await rpc('tools/list', {}))).result.tools as { name: string; annotations: { readOnlyHint: boolean; destructiveHint: boolean } }[]
    expect(tools.map((t) => t.name).sort()).toEqual(['card_report', 'list_cards', 'list_entries', 'search_entries', 'sleep_summary'])
    expect(tools.every((t) => t.annotations.readOnlyHint && !t.annotations.destructiveHint)).toBe(true)
  })

  it('lists entries with their card, numbers, choices and note, narrows by card, and says how to fetch the rest', async () => {
    const { api, call } = setup(TOKEN)
    await api('POST', '/api/checkin', { cardId: 'practice', note: '晚上', tags: ['鋼琴'], facts: { '鋼琴:分鐘': 25, mood_emoji: '🙂' } })
    await api('POST', '/api/checkin', { cardId: 'tea', note: '', tags: [] })
    await api('POST', '/api/checkin', { cardId: 'tea', note: '', tags: [] })
    const all = await call('list_entries', { from: today(), to: today() })
    expect(all.data.total).toBe(3)
    expect(all.data.entries[0]).toMatchObject({ card: '練習', tags: ['鋼琴'], values: { 鋼琴: '25 分鐘' }, choices: { 心情: '🙂 不錯' }, note: '晚上' })
    const tea = await call('list_entries', { from: today(), to: today(), card_id: 'tea', limit: 1 })
    expect(tea.data).toMatchObject({ total: 2, more: expect.stringContaining('offset 1') })
    expect(tea.data.entries).toEqual([expect.objectContaining({ card: '喝茶', tags: [] })])
    expect((await call('list_entries', { from: today(), to: '2000-01-01' })).isError).toBe(true)
    expect((await call('list_entries', { from: '2024-02-30', to: '2024-03-01' })).isError).toBe(true)
  })

  it('reports a card day by day and points an unknown card back to list_cards', async () => {
    const { api, call } = setup(TOKEN)
    await api('POST', '/api/checkin', { cardId: 'tea', note: '', tags: [] })
    const report = await call('card_report', { card_id: 'tea', from: today(), to: today() })
    expect(report.data.days).toEqual([{ date: today(), value: 1, delta: null, state: 'logged' }])
    expect(await call('card_report', { card_id: 'nope' })).toMatchObject({ isError: true, data: expect.stringContaining('list_cards') })
  })

  it('keeps execute_sql out until the setting is on, then answers reads and refuses writes, attach and runaway queries', async () => {
    const db = openDb(join(mkdtempSync(join(tmpdir(), 'noticer-sql-')), 'app.db'))
    const { api, rpc, body, call } = setup(TOKEN, db)
    await api('POST', '/api/checkin', { cardId: 'tea', note: '午後', tags: [] })
    const names = async () => ((await body(await rpc('tools/list', {}))).result.tools as { name: string }[]).map((t) => t.name)
    expect(await names()).not.toContain('execute_sql')
    expect((await api('PUT', '/api/mcp', { sql: true })).status).toBe(204)
    expect(await names()).toContain('execute_sql')

    expect((await call('execute_sql', { sql: "SELECT card_id, note FROM events WHERE card_id = 'tea'" })).data).toEqual({ columns: ['card_id', 'note'], rows: [['tea', '午後']], truncated: false })
    expect((await call('execute_sql', { sql: 'WITH RECURSIVE n(x) AS (SELECT 1 UNION ALL SELECT x + 1 FROM n LIMIT 1001) SELECT x FROM n' })).data).toMatchObject({ truncated: true })
    expect((await call('execute_sql', { sql: "SELECT name FROM pragma_table_info('events') LIMIT 1" })).data.rows).toEqual([['id']])
    for (const sql of ["INSERT INTO tags_dict (name) VALUES ('x')", "DELETE FROM events", "ATTACH DATABASE ':memory:' AS other", 'PRAGMA query_only = 0']) {
      expect(await call('execute_sql', { sql })).toMatchObject({ isError: true, data: 'not authorized' })
    }
    expect(await call('execute_sql', { sql: 'WITH RECURSIVE n(x) AS (SELECT 1 UNION ALL SELECT x + 1 FROM n) SELECT COUNT(*) FROM n' })).toMatchObject({ isError: true, data: expect.stringContaining('1 s') })
    expect(await call('execute_sql', { sql: "WITH RECURSIVE n(x) AS (SELECT 1 UNION ALL SELECT x + 1 FROM n LIMIT 10) SELECT printf('%.*c', 900000, 'x') FROM n" })).toMatchObject({ isError: true, data: expect.stringContaining('fewer columns or rows') })
    expect(db.prepare('SELECT COUNT(*) AS n FROM events').get()).toEqual({ n: 1 })

    await api('PUT', '/api/mcp', { sql: false })
    expect(await names()).not.toContain('execute_sql')
  })
})
