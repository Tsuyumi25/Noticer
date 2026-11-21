import { describe, expect, it } from 'vitest'
import type { BackupRecord } from './backup.ts'
import { configSchema } from './config.ts'
import { convertLegacyConfig, convertLegacyValues } from './legacy.ts'

const D = 86400
const ms = (seconds: number) => seconds * 1000

const legacy = {
  cards: [
    { id: 'coffee', tag: '喝咖啡', emoji: '☕', trackerId: 'coffee', memo: 'kept' },
    { id: 'sunscreen', tag: '防曬', bucket: '護膚', emoji: '🌞', trackerId: 'sunscreen' },
    { id: 'skincare', tag: '護膚', emoji: '🧴', trackerId: 'skincare' },
    { id: 'ironing', tag: '燙衣', emoji: '👕', trackerId: 'ironing' },
    { id: 'sweet_coffee', tag: '加糖', bucket: '喝咖啡', emoji: '🍬', trackerId: 'sweet_coffee' },
    { id: 'weight', tag: '體重', emoji: '⚖️', trackerId: null, facts: ['weight_kg'] },
    { id: 'pure', tag: '隨手記', emoji: '📝', trackerId: null },
  ],
  trackersStatus: [
    { id: 'coffee', type: 'cooldown', source: { tag: '喝咖啡' }, stages: [{ atLeast: ms(3 * 3600), status: 'pending' }, { atLeast: ms(4 * 3600), status: 'good' }] },
    { id: 'sunscreen', type: 'deadline', source: [{ tag: '護膚', tags: ['防曬'] }, { tag: '護膚', tags: ['全套'] }], stages: [{ lessThan: ms(12 * 3600), status: 'good' }] },
    { id: 'skincare', type: 'deadline', source: { tag: '護膚', tags: ['化妝水', '面膜', '全套'] }, stages: [{ lessThan: ms(D), status: 'good' }, { lessThan: ms(1.5 * D), status: 'warning' }] },
    {
      id: 'ironing', type: 'deadline', source: { tag: '燙衣' },
      stages: [{ lessThan: ms(2 * D), status: 'good' }, { lessThan: ms(3 * D), status: 'pending' }, { lessThan: ms(5 * D), status: 'warning' }],
    },
    { id: 'sweet_coffee', type: 'cooldown', source: { tag: '喝咖啡', tags: ['加糖'] }, stages: [{ atLeast: ms(7 * D), status: 'good' }] },
    { id: 'orphan', type: 'deadline', source: { tag: '澆花' }, stages: [{ lessThan: 1, status: 'good' }] },
  ],
  trackersPeriodic: [
    {
      id: 'coffee', type: 'dailyCount', source: { tag: '喝咖啡', excludeTags: ['試喝', '不算'] },
      stages: [{ lessThan: 1, status: 'danger' }, { lessThan: 2, status: 'warning' }, { greaterThan: 4, status: 'danger' }, { greaterThan: 3, status: 'warning' }],
    },
    { id: 'skincare', type: 'dailyBinary', source: [{ tag: '護膚', allTags: ['化妝水', '面膜'] }, { tag: '護膚', tags: ['全套'] }] },
    { id: 'ironing', type: 'interval', source: { tag: '燙衣' }, stages: [{ greaterThan: 4, status: 'danger' }, { greaterThan: 2, status: 'warning' }] },
    { id: 'sweet_coffee', type: 'periodLimit', source: { tag: '喝咖啡', tags: ['加糖'] }, target: { limit: 1, period: ms(7 * D) } },
  ],
  tagGroups: {},
  factInputs: {},
}

describe('convertLegacyConfig', () => {
  const converted = convertLegacyValues(convertLegacyConfig(legacy), []).config
  const rules = (id: string) => configSchema.parse(converted).cards.find((c) => c.id === id)!.rules

  it('produces a valid config without trackers or the old quick-note card, and keeps fields it does not model', () => {
    expect(converted).not.toHaveProperty('trackersStatus')
    expect(converted.cards.map((c) => c.id)).not.toContain('pure')
    expect(converted.cards[0]).toMatchObject({ memo: 'kept' })
    expect(converted.cards[0]).not.toHaveProperty('trackerId')
  })

  it('reads a cooldown as "too soon" until its first ready stage, and gives looking back its own find', () => {
    expect(rules('coffee')).toEqual({
      find: { match: 'all', blocks: [] },
      now: { soon: 4 * 3600 },
      back: {
        span: 'day', measure: { kind: 'times' }, want: { kind: 'between', lo: 2, hi: 3 },
        find: { match: 'all', blocks: [{ ops: ['any'], layers: [[{ kind: 'tag', op: 'not', tags: ['試喝', '不算'] }]] }] },
      },
    })
  })

  it('merges single-tag alternatives into one row and keeps richer ones as blocks joined by "any"', () => {
    expect(rules('sunscreen').find).toEqual({ match: 'all', blocks: [{ ops: ['any'], layers: [[{ kind: 'tag', op: 'has', tags: ['防曬', '全套'] }]] }] })
    expect(rules('skincare').back?.find).toEqual({
      match: 'any',
      blocks: [
        { ops: ['all'], layers: [[{ kind: 'tag', op: 'all', tags: ['化妝水', '面膜'] }]] },
        { ops: ['all'], layers: [[{ kind: 'tag', op: 'has', tags: ['全套'] }]] },
      ],
    })
  })

  it('takes the last two deadline stages as warn and danger, and warns one duration early before a lone one', () => {
    expect(rules('skincare').now).toEqual({ late: { warn: D, danger: 1.5 * D } })
    expect(rules('ironing').now).toEqual({ late: { warn: 3 * D, danger: 5 * D } })
    expect(rules('sunscreen').now).toEqual({ late: { warn: 8 * 3600, danger: 12 * 3600 } })
  })

  it('turns intervals, period limits and binaries into looking-back wants', () => {
    expect(rules('ironing').back).toMatchObject({ measure: { kind: 'since' }, want: { kind: 'atMost', n: 2, red: 4 } })
    expect(rules('sweet_coffee').back).toMatchObject({ span: 'week', want: { kind: 'atMost', n: 1 } })
    expect(rules('skincare').back).toMatchObject({ measure: { kind: 'times' }, want: { kind: 'atLeast', n: 1 } })
  })

  it('leaves a card without trackers unjudged', () => {
    expect(rules('weight')).toEqual({ find: { match: 'all', blocks: [] }, now: {}, back: null })
  })

  it('refuses a card whose tracker counts another root', () => {
    const bad = { ...legacy, cards: [{ id: 'x', tag: '洗車', emoji: '🚗', trackerId: 'orphan' }] }
    expect(() => convertLegacyConfig(bad)).toThrow(/not the card's root/)
  })
})

describe('convertLegacyValues', () => {
  const record = (id: number, card_id: string, tags: string[], facts: BackupRecord['facts'] = {}): BackupRecord => ({
    id, card_id, created_at: '2026-01-01T00:00:00Z', event_at: '2026-01-01T00:00:00Z', time_offset: 0, note: null, tags, facts,
  })
  const legacyConfig = {
    cards: [
      { id: 'practice', tag: '練習', emoji: '🎹', facts: ['duration_min'], rules: { find: { match: 'all', blocks: [] }, now: {}, back: null } },
      { id: 'weight', tag: '體重', emoji: '⚖️', facts: ['weight_kg'], rules: { find: { match: 'all', blocks: [] }, now: {}, back: null } },
      { id: 'water_plants', tag: '澆花', emoji: '🪴', defaultTags: ['350cc'], rules: { find: { match: 'all', blocks: [] }, now: {}, back: null } },
      { id: 'snacks', tag: '甜點', emoji: '🍪', rules: { find: { match: 'all', blocks: [] }, now: {}, back: null } },
    ],
    tagGroups: {
      練習: { groups: [{ name: '類型', color: '#000', tags: [{ label: '鋼琴', emoji: '' }, { label: '吉他', emoji: '' }] }] },
      澆花: { groups: [{ name: '量', color: '#000', tags: [{ label: '350cc', emoji: '' }, { label: '多肉', emoji: '' }] }] },
      甜點: { groups: [{ name: '點心', color: '#000', tags: [{ label: '糖果 x3', emoji: '🍭' }] }] },
    },
    factInputs: {},
  }
  const { config, records } = convertLegacyValues(legacyConfig, [
    record(1, 'practice', ['練習', '鋼琴'], { duration_min: { type: 'integer', value: 20 } }),
    record(2, 'practice', ['練習', '鋼琴', '吉他'], { duration_min: { type: 'integer', value: 30 } }),
    record(6, 'practice', ['練習'], { duration_min: { type: 'integer', value: 10 } }),
    record(3, 'weight', ['體重'], { weight_kg: { type: 'real', value: 53.5 } }),
    record(4, 'water_plants', ['澆花', '250cc', '多肉']),
    record(5, 'snacks', ['甜點', '糖果 x3']),
  ])

  it('puts a duration on the first other tag a record carries, and leaves it on the root only when there is none', () => {
    expect(records[0]).toMatchObject({ tags: ['練習', '鋼琴'], facts: { '鋼琴:分鐘': { type: 'integer', value: 20 } } })
    expect(records[1]!.facts).toEqual({ '鋼琴:分鐘': { type: 'integer', value: 30 } })
    expect(records[2]!.facts).toEqual({ '練習:分鐘': { type: 'integer', value: 10 } })
    expect(records[3]!.facts).toEqual({ '體重:kg': { type: 'real', value: 53.5 } })
  })

  it('turns 250cc tags into the root’s cc value and "x3" tags into a count on the bare tag', () => {
    expect(records[4]).toMatchObject({ tags: ['澆花', '多肉'], facts: { '澆花:cc': { type: 'integer', value: 250 } } })
    expect(records[5]).toMatchObject({ tags: ['甜點', '糖果'], facts: { '糖果:顆': { type: 'integer', value: 3 } } })
  })

  it('declares what each tag carries without lending a root its own, drops number facts and amount tags, and stays valid', () => {
    const parsed = configSchema.parse(config)
    expect(parsed.tagGroups['練習']?.values).toEqual({ 鋼琴: { unit: '分鐘', decimals: 0, keep: 'sum' }, 吉他: { unit: '分鐘', decimals: 0, keep: 'sum' } })
    expect(parsed.tagGroups['體重']?.values).toEqual({ 體重: { unit: 'kg', decimals: 1, keep: 'latest', pad: 'weight' } })
    expect(parsed.tagGroups['澆花']).toMatchObject({ groups: [{ tags: [{ label: '多肉' }] }], values: { 澆花: { unit: 'cc', decimals: 0, keep: 'sum', default: 350 } } })
    expect(Object.keys(parsed.tagGroups['澆花']?.values ?? {})).toEqual(['澆花'])
    expect(parsed.tagGroups['甜點']?.groups[0]?.tags).toEqual([{ label: '糖果', emoji: '🍭' }])
    expect(parsed.cards.find((c) => c.id === 'water_plants')?.defaultTags).toEqual([])
    expect(parsed.cards.every((c) => c.facts === undefined)).toBe(true)
  })
})
