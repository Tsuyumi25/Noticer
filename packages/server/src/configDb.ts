import { configSchema, type Config, type ConfigStore, type RawConfig } from './config.ts'
import { dictionaryIds } from './checkin.ts'
import type { DB } from './db.ts'

type Json = Record<string, unknown>
type Map1 = (x: unknown) => unknown
type Filter = { kind: string; tags?: unknown[] } & Json
type Find = { blocks?: { layers: Filter[][] }[] } & Json
type Rules = { find: Find; back?: ({ measure: Json; find?: Find } & Json) | null } & Json
type Group = { name: string; color: string; tags: unknown[] }
type RootEntry = { emoji?: string; groups: Group[]; values?: Record<string, Json> }

const OWN_KEYS = new Set(['cards', 'tagGroups', 'factInputs', 'tagNotes'])
const TAG_GROUPS = 'tag_groups'
const INPUTS = 'inputs'

function mapFind(find: Find, tag: Map1): Find {
  return {
    ...find,
    blocks: (find.blocks ?? []).map((b) => ({
      ...b,
      layers: b.layers.map((layer) => layer.map((f) => (f.kind === 'tag' ? { ...f, tags: (f.tags ?? []).map(tag) } : f))),
    })),
  }
}

function mapRules(rules: Rules, tag: Map1, unit: Map1): Rules {
  const back = rules.back
  return {
    ...rules,
    find: mapFind(rules.find, tag),
    back: back && {
      ...back,
      measure: 'unit' in back.measure ? { ...back.measure, unit: unit(back.measure.unit) } : back.measure,
      ...(back.find ? { find: mapFind(back.find, tag) } : {}),
    },
  }
}

const mapList = (list: unknown, f: Map1) => (Array.isArray(list) ? list.map(f) : undefined)
const defined = (o: Json) => Object.fromEntries(Object.entries(o).filter(([, v]) => v !== undefined))

function dictionaries(db: DB) {
  const tags = db.prepare<[], { id: number; name: string; emoji: string; note: string | null }>('SELECT id, name, emoji, note FROM tags_dict').all()
  const units = db.prepare<[], { id: number; name: string }>('SELECT id, name FROM unit_dict').all()
  const byId = new Map(tags.map((t) => [t.id, t]))
  const unitById = new Map(units.map((u) => [u.id, u.name]))
  const tag = (id: unknown) => {
    const row = byId.get(id as number)
    if (!row) throw new Error(`definitions point at tag #${String(id)}, which does not exist`)
    return row
  }
  const unit = (id: unknown) => {
    const name = unitById.get(id as number)
    if (name === undefined) throw new Error(`definitions point at unit #${String(id)}, which does not exist`)
    return name
  }
  return { tags, tag, unit }
}

export function assemble(db: DB): RawConfig {
  const { tags, tag, unit } = dictionaries(db)
  const name = (id: unknown) => tag(id).name
  const settings = new Map(db.prepare<[], { key: string; value: string }>('SELECT key, value FROM settings').all().map((s) => [s.key, JSON.parse(s.value) as unknown]))

  const cards = db
    .prepare<[], { id: string; def: string }>('SELECT id, def FROM cards ORDER BY position')
    .all()
    .map(({ id, def }) => {
      const card = JSON.parse(def) as Json & { rules: Rules }
      return defined({
        id,
        ...card,
        root: name(card.root),
        defaultTags: mapList(card.defaultTags, name),
        hiddenTags: mapList(card.hiddenTags, name),
        facts: mapList(card.facts, name),
        rules: mapRules(card.rules, name, unit),
      }) as { id: string } & Json
    })

  const tagGroups: Record<string, RootEntry> = {}
  for (const [rootId, entry] of Object.entries((settings.get(TAG_GROUPS) ?? {}) as Record<string, RootEntry>)) {
    const root = tag(Number(rootId))
    tagGroups[root.name] = defined({
      emoji: root.emoji || undefined,
      groups: entry.groups.map((g) => ({ ...g, tags: g.tags.map((id) => ({ label: name(id), emoji: tag(id).emoji })) })),
      values: entry.values && Object.fromEntries(Object.entries(entry.values).map(([id, spec]) => [name(Number(id)), { ...spec, unit: unit(spec.unit) }])),
    }) as RootEntry
  }

  const factInputs = Object.fromEntries(Object.entries((settings.get(INPUTS) ?? {}) as Record<string, Json>).map(([id, input]) => [name(Number(id)), input]))
  const tagNotes = Object.fromEntries(tags.filter((t) => t.note !== null).map((t) => [t.name, t.note]))
  const rest = Object.fromEntries([...settings].filter(([key]) => key !== TAG_GROUPS && key !== INPUTS))
  return { ...rest, cards, tagGroups, factInputs, tagNotes }
}

function persist(db: DB, raw: RawConfig) {
  const ids = dictionaryIds(db)
  const tagId = (name: unknown) => ids.tag(String(name))
  const unitId = (name: unknown) => ids.unit(String(name))
  const setEmoji = db.prepare('UPDATE tags_dict SET emoji = ? WHERE id = ?')
  const setNote = db.prepare('UPDATE tags_dict SET note = ? WHERE id = ?')
  const insertCard = db.prepare('INSERT INTO cards (id, position, def) VALUES (?, ?, ?)')
  const putSetting = db.prepare('INSERT INTO settings (key, value) VALUES (?, ?)')

  db.prepare('DELETE FROM cards').run()
  raw.cards.forEach(({ id, ...card }, position) => {
    const def = defined({
      ...card,
      root: tagId(card.root),
      defaultTags: mapList(card.defaultTags, tagId),
      hiddenTags: mapList(card.hiddenTags, tagId),
      facts: mapList(card.facts, tagId),
      rules: mapRules(card.rules as Rules, tagId, unitId),
    })
    insertCard.run(id, position, JSON.stringify(def))
  })

  const emojis = new Map<number, string>()
  const giveEmoji = (id: number, emoji: string) => {
    if (emoji !== '' || !emojis.get(id)) emojis.set(id, emoji)
  }
  const stored: Record<string, Json> = {}
  for (const [root, entry] of Object.entries((raw.tagGroups ?? {}) as Record<string, RootEntry>)) {
    const groups = entry.groups.map((g) => ({
      ...g,
      tags: (g.tags as { label: string; emoji: string }[]).map((t) => {
        const id = tagId(t.label)
        giveEmoji(id, t.emoji)
        return id
      }),
    }))
    const rootId = tagId(root)
    if (entry.emoji !== undefined) giveEmoji(rootId, entry.emoji)
    stored[rootId] = defined({
      groups,
      values: entry.values && Object.fromEntries(Object.entries(entry.values).map(([tag, spec]) => [tagId(tag), { ...spec, unit: unitId(spec.unit) }])),
    })
  }
  for (const [id, emoji] of emojis) setEmoji.run(emoji, id)

  const inputs = Object.fromEntries(Object.entries((raw.factInputs ?? {}) as Record<string, Json>).map(([key, input]) => [tagId(key), input]))

  db.prepare('UPDATE tags_dict SET note = NULL WHERE note IS NOT NULL').run()
  for (const [tag, note] of Object.entries((raw.tagNotes ?? {}) as Record<string, string>)) setNote.run(note, tagId(tag))

  db.prepare('DELETE FROM settings').run()
  putSetting.run(TAG_GROUPS, JSON.stringify(stored))
  putSetting.run(INPUTS, JSON.stringify(inputs))
  for (const [key, value] of Object.entries(raw)) if (!OWN_KEYS.has(key) && value !== undefined) putSetting.run(key, JSON.stringify(value))
}

export function writeDefinitions(db: DB, raw: RawConfig): Config {
  return db.transaction(() => {
    const config = configSchema.parse(raw)
    persist(db, raw)
    return config
  })()
}

export function dbStore(db: DB): ConfigStore {
  return {
    read: () => configSchema.parse(assemble(db)),
    update: (edit) =>
      db.transaction(() => {
        const raw = assemble(db)
        edit(raw)
        const config = configSchema.parse(raw)
        persist(db, raw)
        return config
      })(),
  }
}
