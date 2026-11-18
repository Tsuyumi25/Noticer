import { existsSync, readFileSync, writeFileSync } from 'node:fs'
import { z } from 'zod'

const statusSchema = z.enum(['good', 'pending', 'warning', 'danger'])

const tagSourceSchema = z.object({
  tag: z.string(),
  tags: z.array(z.string()).optional(),
  allTags: z.array(z.string()).optional(),
  excludeTags: z.array(z.string()).optional(),
})
const sourceSchema = z.union([tagSourceSchema, z.array(tagSourceSchema)])

const displaySchema = z.object({ name: z.string(), emoji: z.string() })

const statusTrackerSchema = z.discriminatedUnion('type', [
  z.object({
    id: z.string(),
    type: z.literal('deadline'),
    display: displaySchema,
    source: sourceSchema,
    stages: z.array(z.object({ lessThan: z.number(), status: statusSchema })).min(1),
  }),
  z.object({
    id: z.string(),
    type: z.literal('cooldown'),
    display: displaySchema,
    source: sourceSchema,
    stages: z.array(z.object({ atLeast: z.number(), status: statusSchema })).min(1),
    initial: z.object({ status: statusSchema }).optional(),
  }),
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
  z.object({
    id: z.string(),
    type: z.literal('periodLimit'),
    source: sourceSchema,
    target: z.object({ limit: z.number(), period: z.number() }),
  }),
])

const numberInputSchema = z
  .object({
    kind: z.literal('number'),
    name: z.string(),
    unit: z.string(),
    decimals: z.number().int().min(0).max(3),
    min: z.number(),
    max: z.number(),
    steps: z.array(z.number().positive()).min(1),
    presets: z.array(z.number()).optional(),
    initial: z.union([z.number(), z.literal('last')]).optional(),
    required: z.boolean().optional(),
  })
  .refine((i) => i.min <= i.max, { message: 'min must not exceed max' })

const choiceInputSchema = z.object({
  kind: z.literal('choice'),
  name: z.string(),
  options: z.array(z.object({ value: z.string(), label: z.string() })).min(1),
  required: z.boolean().optional(),
})

const factInputSchema = z.discriminatedUnion('kind', [numberInputSchema, choiceInputSchema])

const cardSchema = z.object({
  id: z.string(),
  tag: z.string(),
  bucket: z.string().optional(),
  defaultTags: z.array(z.string()).optional(),
  hiddenTags: z.array(z.string()).optional(),
  emoji: z.string(),
  trackerId: z.string().nullable(),
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

const tagRootSchema = z.object({ emoji: z.string().optional(), groups: tagGroupsSchema })

export const configSchema = z
  .object({
    cards: z.array(cardSchema),
    trackersStatus: z.array(statusTrackerSchema),
    trackersPeriodic: z.array(periodicTrackerSchema),
    tagGroups: z.record(z.string(), tagRootSchema).default({}),
    factInputs: z.record(z.string(), factInputSchema).default({}),
  })
  .superRefine((config, ctx) => {
    for (const card of config.cards) {
      for (const key of card.facts ?? []) {
        if (!(key in config.factInputs)) ctx.addIssue({ code: 'custom', message: `card ${card.id} uses unknown fact ${key}` })
      }
    }
  })

export type Config = z.infer<typeof configSchema>
export type TagSource = z.infer<typeof tagSourceSchema>
export type TrackerSource = z.infer<typeof sourceSchema>
export type StatusTrackerConfig = z.infer<typeof statusTrackerSchema>
export type PeriodicTrackerConfig = z.infer<typeof periodicTrackerSchema>
export type CompareStage = z.infer<typeof compareStageSchema>
export type CardConfig = z.infer<typeof cardSchema>
export type FactInput = z.infer<typeof factInputSchema>
export type TagGroup = z.infer<typeof tagGroupsSchema>[number]
export type RuleStatus = z.infer<typeof statusSchema>

export const emptyConfig: Config = { cards: [], trackersStatus: [], trackersPeriodic: [], tagGroups: {}, factInputs: {} }

/** The file as stored: card entries keep fields this app does not model yet (memo…). */
export type RawConfig = {
  cards: Array<{ id: string } & Record<string, unknown>>
  tagGroups?: Record<string, { emoji?: string; groups: unknown }>
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
