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

const cardSchema = z.object({
  id: z.string(),
  tag: z.string(),
  bucket: z.string().optional(),
  defaultTags: z.array(z.string()).optional(),
  emoji: z.string(),
  trackerId: z.string().nullable(),
  inputComponent: z.string().optional(),
})

export const configSchema = z.object({
  cards: z.array(cardSchema),
  trackersStatus: z.array(statusTrackerSchema),
  trackersPeriodic: z.array(periodicTrackerSchema),
})

export type Config = z.infer<typeof configSchema>
export type TagSource = z.infer<typeof tagSourceSchema>
export type TrackerSource = z.infer<typeof sourceSchema>
export type StatusTrackerConfig = z.infer<typeof statusTrackerSchema>
export type PeriodicTrackerConfig = z.infer<typeof periodicTrackerSchema>
export type CompareStage = z.infer<typeof compareStageSchema>
export type CardConfig = z.infer<typeof cardSchema>
export type RuleStatus = z.infer<typeof statusSchema>

export const emptyConfig: Config = { cards: [], trackersStatus: [], trackersPeriodic: [] }

export function readConfig(path: string): Config {
  if (!existsSync(path)) return emptyConfig
  return configSchema.parse(JSON.parse(readFileSync(path, 'utf8')))
}

export function writeConfig(path: string, raw: unknown): Config {
  const config = configSchema.parse(raw)
  writeFileSync(path, JSON.stringify(raw, null, 2))
  return config
}
