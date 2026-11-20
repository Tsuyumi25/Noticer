import { existsSync, readFileSync, writeFileSync } from 'node:fs'
import { z } from 'zod'

const statusSchema = z.enum(['good', 'pending', 'warning', 'danger'])

/** Minutes after local midnight; 1440 is the end of the day. */
const minuteOfDaySchema = z.number().int().min(0).max(1440)

const filterSchema = z.discriminatedUnion('kind', [
  /** `has`: carries any of the tags; `all`: carries every one; `not`: carries none of them. */
  z.object({ kind: z.literal('tag'), op: z.enum(['has', 'all', 'not']), tags: z.array(z.string().min(1)).min(1) }),
  /** Local time of day; `from` after `to` wraps past midnight. */
  z.object({ kind: z.literal('time'), from: minuteOfDaySchema, to: minuteOfDaySchema }),
  z.object({ kind: z.literal('weekday'), is: z.enum(['weekday', 'weekend']) }),
])

const matchSchema = z.enum(['all', 'any'])

/** Read top to bottom: the first layer joins its rows by its connector; each later layer joins everything above with its own rows by its own. */
const blockSchema = z
  .object({ ops: z.array(matchSchema).min(1).max(3), layers: z.array(z.array(filterSchema).min(1)).min(1).max(3) })
  .refine((b) => b.ops.length === b.layers.length, { message: 'each layer needs its connector' })

/** Which of the events tagged with the card's root count: blocks joined by `match`. */
const findSchema = z.object({ match: matchSchema, blocks: z.array(blockSchema) })

const secondsSchema = z.number().int().positive()

/** Seconds since the last counted record: before `soon` it is too soon; from `late.warn` a warning, from `late.danger` danger. */
const nowSchema = z
  .object({
    soon: secondsSchema.optional(),
    late: z
      .object({ warn: secondsSchema, danger: secondsSchema })
      .refine((l) => l.danger > l.warn, { message: 'danger must come after warn' })
      .optional(),
  })
  .refine((n) => n.soon === undefined || n.late === undefined || n.soon < n.late.warn, { message: 'soon must end before warn' })

/** `total` adds up and `last` takes the latest of the values recorded in `unit`, whichever tag carries them. */
const measureSchema = z.discriminatedUnion('kind', [
  z.object({ kind: z.literal('times') }),
  z.object({ kind: z.literal('total'), unit: z.string() }),
  z.object({ kind: z.literal('last'), unit: z.string() }),
  z.object({ kind: z.literal('since') }),
])

const amountSchema = z.number().min(0)

const wantSchema = z.discriminatedUnion('kind', [
  z.object({ kind: z.literal('atLeast'), n: amountSchema }),
  z
    .object({ kind: z.literal('atMost'), n: amountSchema, red: amountSchema.optional() })
    .refine((w) => w.red === undefined || w.red > w.n, { message: 'red must be above n' }),
  z
    .object({ kind: z.literal('between'), lo: amountSchema, hi: amountSchema })
    .refine((w) => w.lo <= w.hi, { message: 'lo must not exceed hi' }),
  z.object({ kind: z.literal('off') }),
])

const backSchema = z.object({
  span: z.enum(['day', 'week']),
  measure: measureSchema,
  want: wantSchema,
  /** Looking back counts other events than the home card does. */
  find: findSchema.optional(),
})

export const rulesSchema = z.object({ find: findSchema, now: nowSchema, back: backSchema.nullable() })

const choiceInputSchema = z.object({
  kind: z.literal('choice'),
  name: z.string(),
  options: z.array(z.object({ value: z.string(), label: z.string() })).min(1),
  required: z.boolean().optional(),
})

const factInputSchema = choiceInputSchema

const cardSchema = z.object({
  id: z.string(),
  tag: z.string(),
  bucket: z.string().optional(),
  defaultTags: z.array(z.string()).optional(),
  hiddenTags: z.array(z.string()).optional(),
  emoji: z.string(),
  rules: rulesSchema,
  /** Keys into factInputs, in the order the sheet shows them. */
  facts: z.array(z.string()).optional(),
})

const tagSchema = z.object({ label: z.string().trim().min(1), emoji: z.string() })

export const tagGroupsSchema = z
  .array(z.object({ name: z.string().trim().min(1), color: z.string(), tags: z.array(tagSchema) }))
  .refine((groups) => new Set(groups.map((g) => g.name)).size === groups.length, { message: 'group names must be unique' })
  .refine((groups) => {
    const labels = groups.flatMap((g) => g.tags.map((t) => t.label))
    return new Set(labels).size === labels.length
  }, { message: 'a tag can only be in one group' })

/** Keypad rows that replace the usual amounts for one kind of number; the web app holds their components. */
export const PAD_ROWS = ['weight'] as const

/** A number a tag carries in a root's events: `sum` values add up over a day, `latest` ones replace each other. */
export const valueSpecSchema = z.object({
  unit: z.string().trim().min(1).regex(/^[^:]+$/),
  decimals: z.number().int().min(0).max(3),
  keep: z.enum(['sum', 'latest']),
  default: z.number().min(0).optional(),
  pad: z.enum(PAD_ROWS).optional(),
})

/** `values`: which tags carry a number when they appear alongside this root, keyed by tag. */
const tagRootSchema = z.object({
  emoji: z.string().optional(),
  groups: tagGroupsSchema,
  values: z.record(z.string(), valueSpecSchema).optional(),
})

export const configSchema = z
  .object({
    cards: z.array(cardSchema),
    tagGroups: z.record(z.string(), tagRootSchema).default({}),
    factInputs: z.record(z.string(), factInputSchema).default({}),
  })
  .superRefine((config, ctx) => {
    for (const card of config.cards) {
      for (const key of card.facts ?? []) {
        if (!(key in config.factInputs)) ctx.addIssue({ code: 'custom', message: `card ${card.id} uses unknown fact ${key}` })
      }
      const measure = card.rules.back?.measure
      if (measure && 'unit' in measure && !rootUnits(config, card.bucket ?? card.tag).includes(measure.unit)) {
        ctx.addIssue({ code: 'custom', message: `card ${card.id} measures ${measure.unit}, which no tag under its root carries` })
      }
    }
  })

/** Units the tags under a root carry, in first-declared order. */
export function rootUnits(config: Pick<Config, 'tagGroups'>, root: string): string[] {
  return [...new Set(Object.values(config.tagGroups[root]?.values ?? {}).map((v) => v.unit))]
}

export type Config = z.infer<typeof configSchema>
export type Rules = z.infer<typeof rulesSchema>
export type Find = z.infer<typeof findSchema>
export type Block = z.infer<typeof blockSchema>
export type Match = z.infer<typeof matchSchema>
export type Filter = z.infer<typeof filterSchema>
export type NowRule = z.infer<typeof nowSchema>
export type BackRule = z.infer<typeof backSchema>
export type Want = z.infer<typeof wantSchema>
export type Measure = z.infer<typeof measureSchema>
export type CardConfig = z.infer<typeof cardSchema>
export type FactInput = z.infer<typeof factInputSchema>
export type ValueSpec = z.infer<typeof valueSpecSchema>
export type TagGroup = z.infer<typeof tagGroupsSchema>[number]
export type RuleStatus = z.infer<typeof statusSchema>

export const emptyConfig: Config = { cards: [], tagGroups: {}, factInputs: {} }

/** The file as stored: card entries keep fields this app does not model yet (memo…). */
export type RawConfig = {
  cards: Array<{ id: string } & Record<string, unknown>>
  tagGroups?: Record<string, { emoji?: string; groups: unknown; values?: Record<string, unknown> }>
} & Record<string, unknown>

export interface ConfigStore {
  read(): Config
  /** Applies an edit to the raw file content, validates it, and persists it. */
  update(edit: (raw: RawConfig) => void): Config
}

export function readConfig(path: string): Config {
  if (!existsSync(path)) return emptyConfig
  return configSchema.parse(JSON.parse(readFileSync(path, 'utf8')))
}

export function writeConfig(path: string, raw: unknown): Config {
  const config = configSchema.parse(raw)
  writeFileSync(path, JSON.stringify(raw, null, 2))
  return config
}

export function fileStore(path: string): ConfigStore {
  return {
    read: () => readConfig(path),
    update(edit) {
      const raw: RawConfig = existsSync(path) ? JSON.parse(readFileSync(path, 'utf8')) : structuredClone(emptyConfig)
      edit(raw)
      return writeConfig(path, raw)
    },
  }
}

export function memoryStore(initial: unknown): ConfigStore {
  let raw = structuredClone(initial) as RawConfig
  return {
    read: () => configSchema.parse(raw),
    update(edit) {
      const next = structuredClone(raw)
      edit(next)
      const config = configSchema.parse(next)
      raw = next
      return config
    },
  }
}
