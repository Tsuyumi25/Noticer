import { z } from 'zod'
import type { BackRule, Filter, Find, NowRule, RawConfig, Rules, Want } from './config.ts'
import { durationBefore } from './rules.ts'

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
  cards: z.array(z.object({ id: z.string(), tag: z.string(), bucket: z.string().optional(), trackerId: z.string().nullable() }).passthrough()),
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
      return { span: 'day', measure: { kind: 'total', fact: 'duration_min' }, want: toWant(tracker.stages, where) }
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

/** Turns the old app's config into this app's: each card carries its own rules; trackers no card uses are dropped. */
export function convertLegacyConfig(raw: unknown): RawConfig {
  const { cards, trackersStatus, trackersPeriodic, ...rest } = raw as Record<string, unknown>
  const legacy = legacySchema.parse({ cards, trackersStatus, trackersPeriodic })
  const status = new Map(legacy.trackersStatus.map((t) => [t.id, t]))
  const periodic = new Map(legacy.trackersPeriodic.map((t) => [t.id, t]))
  return {
    ...rest,
    cards: legacy.cards.map(({ trackerId, ...card }) => {
      const root = card.bucket ?? card.tag
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
      return { ...card, rules }
    }),
  }
}
