import { z } from 'zod'
import type { BackupRecord } from './backup.ts'
import type { BackRule, FactInput, Filter, Find, NowRule, RawConfig, Rules, ValueSpec, Want } from './config.ts'
import { PURE_CARD } from './pure.ts'
import { durationBefore } from './rules.ts'
import { valueKey } from './values.ts'

const statusSchema = z.enum(['good', 'pending', 'warning', 'danger'])

const tagSourceSchema = z.object({
  tag: z.string(),
  tags: z.array(z.string()).optional(),
  allTags: z.array(z.string()).optional(),
  excludeTags: z.array(z.string()).optional(),
})
const sourceSchema = z.union([tagSourceSchema, z.array(tagSourceSchema)])

const statusTrackerSchema = z.discriminatedUnion('type', [
  z.object({ id: z.string(), type: z.literal('deadline'), source: sourceSchema, stages: z.array(z.object({ lessThan: z.number(), status: statusSchema })).min(1) }),
  z.object({ id: z.string(), type: z.literal('cooldown'), source: sourceSchema, stages: z.array(z.object({ atLeast: z.number(), status: statusSchema })).min(1) }),
])

const compareStageSchema = z.object({
  lessThan: z.number().optional(),
  greaterThan: z.number().optional(),
  equals: z.number().optional(),
  status: statusSchema,
})

const periodicTrackerSchema = z.discriminatedUnion('type', [
  z.object({ id: z.string(), type: z.literal('dailyCount'), source: sourceSchema, stages: z.array(compareStageSchema) }),
  z.object({ id: z.string(), type: z.literal('duration'), source: sourceSchema, stages: z.array(compareStageSchema) }),
  z.object({ id: z.string(), type: z.literal('interval'), source: sourceSchema, stages: z.array(compareStageSchema) }),
  z.object({ id: z.string(), type: z.literal('dailyBinary'), source: sourceSchema }),
  z.object({ id: z.string(), type: z.literal('dailyAbsence'), source: sourceSchema }),
  z.object({ id: z.string(), type: z.literal('periodLimit'), source: sourceSchema, target: z.object({ limit: z.number(), period: z.number() }) }),
])

const legacySchema = z.object({
  cards: z.array(z.object({ id: z.string(), tag: z.string(), bucket: z.string().optional(), defaultTags: z.array(z.string()).optional(), trackerId: z.string().nullable() }).passthrough()),
  trackersStatus: z.array(statusTrackerSchema),
  trackersPeriodic: z.array(periodicTrackerSchema),
})

type Source = z.infer<typeof sourceSchema>
type CompareStage = z.infer<typeof compareStageSchema>
type StatusTracker = z.infer<typeof statusTrackerSchema>
type PeriodicTracker = z.infer<typeof periodicTrackerSchema>

const DAY = 86400

/** One narrowing of an old source: carry any of these, carry all of these, or carry none of these. */
type Narrowing = { op: 'any' | 'all' | 'none'; tags: string[] }

function narrowings(src: z.infer<typeof tagSourceSchema>): Narrowing[] {
  const out: Narrowing[] = []
  if (src.allTags?.length) out.push({ op: 'all', tags: src.allTags })
  if (src.tags?.length) out.push({ op: 'any', tags: src.tags })
  if (src.excludeTags?.length) out.push({ op: 'none', tags: src.excludeTags })
  return out
}

const has = (tags: string[]): Filter => ({ kind: 'tag', op: 'has', tags })

function row(n: Narrowing): Filter {
  return n.op === 'none' ? { kind: 'tag', op: 'not', tags: n.tags } : n.op === 'all' ? { kind: 'tag', op: 'all', tags: n.tags } : has(n.tags)
}

function toFind(source: Source, root: string, where: string): Find {
  const sources = Array.isArray(source) ? source : [source]
  const stray = sources.find((s) => s.tag !== root)
  if (stray) throw new Error(`${where}: source tag ${stray.tag} is not the card's root ${root}`)
  if (sources.length === 1) {
    return { match: 'all', blocks: narrowings(sources[0]!).map((n) => ({ ops: ['any'], layers: [[row(n)]] })) }
  }
  const each = sources.map(narrowings)
  if (each.some((n) => n.length !== 1)) throw new Error(`${where}: each alternative source must narrow by exactly one condition`)
  const alternatives = each.map((n) => n[0]!)
  // Alternatives that each need one of some tags read as a single row.
  if (alternatives.every((n) => n.op === 'any')) {
    return { match: 'all', blocks: [{ ops: ['any'], layers: [[has(alternatives.flatMap((n) => n.tags))]] }] }
  }
  return { match: 'any', blocks: alternatives.map((n) => ({ ops: ['all'], layers: [[row(n)]] })) }
}

/** A single deadline is where it turns red; the warning starts one duration earlier. */
function toNow(tracker: StatusTracker): NowRule {
  if (tracker.type === 'deadline') {
    const limits = tracker.stages.map((s) => s.lessThan / 1000).sort((a, b) => a - b)
    const danger = limits.at(-1)!
    return { late: { warn: limits.length === 1 ? durationBefore(danger) : limits.at(-2)!, danger } }
  }
  const stages = [...tracker.stages].sort((a, b) => a.atLeast - b.atLeast)
  const ready = stages.find((s) => s.status === 'good') ?? stages.at(-1)!
  return { soon: ready.atLeast / 1000 }
}

function toWant(stages: CompareStage[], where: string): Want {
  if (stages.some((s) => s.equals !== undefined)) throw new Error(`${where}: equals stages have no counterpart`)
  const lows = stages.flatMap((s) => (s.lessThan === undefined ? [] : [s.lessThan]))
  const highs = stages.flatMap((s) => (s.greaterThan === undefined ? [] : [s.greaterThan])).sort((a, b) => a - b)
  if (lows.length && highs.length) return { kind: 'between', lo: Math.max(...lows), hi: highs[0]! }
  if (lows.length) return { kind: 'atLeast', n: Math.max(...lows) }
  if (highs.length === 0) return { kind: 'off' }
  return highs.length === 1 ? { kind: 'atMost', n: highs[0]! } : { kind: 'atMost', n: highs[0]!, red: highs.at(-1)! }
}

function toBack(tracker: PeriodicTracker, where: string): Omit<BackRule, 'find'> {
  switch (tracker.type) {
    case 'dailyCount':
      return { span: 'day', measure: { kind: 'times' }, want: toWant(tracker.stages, where) }
    case 'duration':
      return { span: 'day', measure: { kind: 'total', unit: LEGACY_NUMBERS.duration_min!.spec.unit }, want: toWant(tracker.stages, where) }
    case 'interval':
      return { span: 'day', measure: { kind: 'since' }, want: toWant(tracker.stages, where) }
    case 'dailyBinary':
      return { span: 'day', measure: { kind: 'times' }, want: { kind: 'atLeast', n: 1 } }
    case 'dailyAbsence':
      return { span: 'day', measure: { kind: 'times' }, want: { kind: 'atMost', n: 0 } }
    case 'periodLimit': {
      const span = tracker.target.period === 7 * DAY * 1000 ? 'week' : tracker.target.period === DAY * 1000 ? 'day' : null
      if (!span) throw new Error(`${where}: a period of ${tracker.target.period} ms is neither a day nor a week`)
      return { span, measure: { kind: 'times' }, want: { kind: 'atMost', n: tracker.target.limit } }
    }
  }
}

/**
 * Turns the old app's config into this app's: each card carries its own rules; trackers no card uses are dropped, and
 * so is the old quick-note card, since quick notes are no card here. A card's old tag becomes its name, its bucket (or
 * the tag when it had none) its root, and a tag under a bucket starts picked instead of always attached.
 */
export function convertLegacyConfig(raw: unknown): RawConfig {
  const { cards, trackersStatus, trackersPeriodic, ...rest } = raw as Record<string, unknown>
  const legacy = legacySchema.parse({ cards, trackersStatus, trackersPeriodic })
  const status = new Map(legacy.trackersStatus.map((t) => [t.id, t]))
  const periodic = new Map(legacy.trackersPeriodic.map((t) => [t.id, t]))
  return {
    ...rest,
    cards: legacy.cards.filter((card) => card.id !== PURE_CARD).map(({ trackerId, tag, bucket, ...card }) => {
      const root = bucket ?? tag
      const nowTracker = trackerId ? status.get(trackerId) : undefined
      const backTracker = periodic.get(card.id)
      const find = nowTracker
        ? toFind(nowTracker.source, root, `tracker ${nowTracker.id}`)
        : backTracker
          ? toFind(backTracker.source, root, `tracker ${backTracker.id}`)
          : { match: 'all' as const, blocks: [] }
      let back: BackRule | null = null
      if (backTracker) {
        const own = toFind(backTracker.source, root, `tracker ${backTracker.id}`)
        back = { ...toBack(backTracker, `tracker ${backTracker.id}`), ...(JSON.stringify(own) === JSON.stringify(find) ? {} : { find: own }) }
      }
      const rules: Rules = { find, now: nowTracker ? toNow(nowTracker) : {}, back }
      const defaultTags = bucket ? [...new Set([tag, ...(card.defaultTags ?? [])])] : (card.defaultTags ?? [])
      return { ...card, name: tag, root, ...(defaultTags.length ? { defaultTags } : {}), rules }
    }),
  }
}

/** Number facts the old app kept per card; `root` puts the value on the card's root tag, `tag` on the one other tag the record carries. */
const LEGACY_NUMBERS: Record<string, { spec: ValueSpec; on: 'root' | 'tag' }> = {
  weight_kg: { spec: { unit: 'kg', decimals: 1, pad: 'weight' }, on: 'root' },
  duration_min: { spec: { unit: '分鐘', decimals: 0 }, on: 'tag' },
}
/** Amounts the old app could only store in tag names. */
const VOLUME_TAG = /^(\d+)cc$/
const DOSE_TAG = /^(.+) x(\d+)$/
const VOLUME: ValueSpec = { unit: 'cc', decimals: 0 }
const DOSE: ValueSpec = { unit: '顆', decimals: 0 }

/** The old app hard-wired one input component per value; numbers become tag values, a choice becomes a value on a tag of the input's name. */
export const LEGACY_INPUTS: Record<string, FactInput> = {
  mood_emoji: {
    kind: 'choice',
    name: '心情',
    options: [
      { value: '😊', label: '很好' },
      { value: '🙂', label: '不錯' },
      { value: '😐', label: '普通' },
      { value: '😔', label: '不好' },
      { value: '😵', label: '很差' },
    ],
  },
}
const LEGACY_LABEL = 'mood_label'
const LEGACY_TEXT = 'mood_text'

type RawGroups = { name: string; color: string; tags: { label: string; emoji: string }[] }[]

/**
 * Moves numbers into tag values: the old number facts, `350cc` tags (the root carries cc) and `糖果 x3` tags (the tag carries a count).
 * Takes a config already through convertLegacyConfig and the records it goes with.
 */
export function convertLegacyValues(raw: RawConfig, records: BackupRecord[]): { config: RawConfig; records: BackupRecord[] } {
  const config: RawConfig = structuredClone(raw)
  config.tagGroups ??= {}
  const tagGroups = config.tagGroups
  const known = { ...LEGACY_INPUTS, ...((config.factInputs ?? {}) as Record<string, FactInput>) }
  const choiceTag = new Map(Object.entries(known).map(([key, input]) => [key, input.name]))
  const cards = new Map(config.cards.map((c) => [c.id, c as { id: string; name: string; root: string; facts?: string[]; defaultTags?: string[]; hiddenTags?: string[] }]))
  const asked = new Set([...Object.keys(config.factInputs ?? {}), ...[...cards.values()].flatMap((c) => c.facts ?? [])])
  config.factInputs = Object.fromEntries(Object.entries(known).filter(([key]) => asked.has(key)).map(([key, input]) => [choiceTag.get(key)!, input]))
  for (const card of cards.values()) if (card.facts) card.facts = card.facts.map((k) => choiceTag.get(k) ?? k)
  const declare = (root: string, tag: string, spec: ValueSpec) => {
    const entry = (tagGroups[root] ??= { groups: [] })
    const values = (entry.values ??= {}) as Record<string, ValueSpec>
    values[tag] ??= { ...spec }
  }

  for (const card of cards.values()) {
    const root = card.root
    for (const key of card.facts ?? []) {
      const legacy = LEGACY_NUMBERS[key]
      if (legacy?.on === 'root') declare(root, root, legacy.spec)
    }
    card.facts = card.facts?.filter((k) => !(k in LEGACY_NUMBERS))
    if (card.facts?.length === 0) delete card.facts
    const groups = (tagGroups[root]?.groups ?? []) as RawGroups
    for (const g of groups) {
      const seen = new Set<string>()
      g.tags = g.tags.flatMap((t) => {
        if (VOLUME_TAG.test(t.label)) return []
        const label = DOSE_TAG.exec(t.label)?.[1] ?? t.label
        if (seen.has(label)) return []
        seen.add(label)
        return [{ ...t, label }]
      })
    }
    for (const field of ['defaultTags', 'hiddenTags'] as const) {
      const list = card[field]
      if (!list) continue
      const volume = list.map((t) => VOLUME_TAG.exec(t)).find(Boolean)
      if (volume) declare(root, root, { ...VOLUME, default: Number(volume[1]) })
      card[field] = list.filter((t) => !VOLUME_TAG.test(t)).map((t) => DOSE_TAG.exec(t)?.[1] ?? t)
    }
  }

  const converted = records.map((r): BackupRecord => {
    const card = cards.get(r.card_id)
    if (!card) return r
    const root = card.root
    // The old app attached the card's tag, now its name, and its bucket, now its root.
    const auto = new Set([card.root, card.name])
    const tags: string[] = []
    const facts: BackupRecord['facts'] = {}
    let note = r.note
    for (const t of r.tags) {
      const volume = VOLUME_TAG.exec(t)
      const dose = DOSE_TAG.exec(t)
      if (volume) {
        declare(root, root, VOLUME)
        facts[valueKey(root, VOLUME.unit)] = { type: 'integer', value: Number(volume[1]) }
      } else if (dose) {
        declare(root, dose[1]!, DOSE)
        tags.push(dose[1]!)
        facts[valueKey(dose[1]!, DOSE.unit)] = { type: 'integer', value: Number(dose[2]) }
      } else tags.push(t)
    }
    for (const [k, fact] of Object.entries(r.facts)) {
      const choice = choiceTag.get(k)
      if (choice) {
        facts[choice] = fact
        if (!tags.includes(choice)) tags.push(choice)
        continue
      }
      if (k === LEGACY_LABEL) continue
      if (k === LEGACY_TEXT && fact.type === 'text') {
        note = note ? `${note}\n\n${fact.value}` : fact.value
        continue
      }
      const legacy = LEGACY_NUMBERS[k]
      if (!legacy) {
        facts[k] = fact
        continue
      }
      // A tag value goes to the first other tag; a record with none keeps it on the root without making the root carry one from now on.
      const owner = legacy.on === 'tag' ? (tags.find((t) => !auto.has(t)) ?? null) : root
      if (owner !== null) declare(root, owner, legacy.spec)
      facts[valueKey(owner ?? root, legacy.spec.unit)] = fact
    }
    return { ...r, note, tags, facts }
  })

  // A group whose tags carry a number lends it to members never recorded with one; a root's own value is not lent.
  for (const [root, entry] of Object.entries(tagGroups)) {
    const values = entry.values as Record<string, ValueSpec> | undefined
    if (!values) continue
    for (const g of entry.groups as RawGroups) {
      const spec = g.tags.filter((t) => t.label !== root).map((t) => values[t.label]).find(Boolean)
      if (!spec) continue
      for (const t of g.tags) if (t.label !== root) values[t.label] ??= { unit: spec.unit, decimals: spec.decimals }
    }
  }
  return { config, records: converted }
}
