import { describe, expect, it } from 'vitest'
import { configSchema } from './config.ts'
import { convertLegacyConfig } from './legacy.ts'

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
  factInputs: { weight_kg: { kind: 'number', name: '體重', unit: 'kg', decimals: 1, min: 30, max: 200, steps: [0.1] } },
}

describe('convertLegacyConfig', () => {
  const converted = convertLegacyConfig(legacy)
  const rules = (id: string) => configSchema.parse(converted).cards.find((c) => c.id === id)!.rules

  it('produces a valid config without trackers and keeps fields it does not model', () => {
    expect(converted).not.toHaveProperty('trackersStatus')
    expect(converted.cards[0]).toMatchObject({ memo: 'kept' })
    expect(converted.cards[0]).not.toHaveProperty('trackerId')
  })

  it('reads a cooldown as "too soon" until its first ready stage, and gives looking back its own find', () => {
    expect(rules('coffee')).toEqual({
      find: { match: 'all', blocks: [] },
      now: { kind: 'soon', within: 4 * 3600 },
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

  it('takes the last two deadline stages as worry and panic', () => {
    expect(rules('skincare').now).toEqual({ kind: 'worry', after: D, panic: 1.5 * D })
    expect(rules('ironing').now).toEqual({ kind: 'worry', after: 3 * D, panic: 5 * D })
    expect(rules('sunscreen').now).toEqual({ kind: 'worry', after: 12 * 3600 })
  })

  it('turns intervals, period limits and binaries into looking-back wants', () => {
    expect(rules('ironing').back).toMatchObject({ measure: { kind: 'since' }, want: { kind: 'atMost', n: 2, red: 4 } })
    expect(rules('sweet_coffee').back).toMatchObject({ span: 'week', want: { kind: 'atMost', n: 1 } })
    expect(rules('skincare').back).toMatchObject({ measure: { kind: 'times' }, want: { kind: 'atLeast', n: 1 } })
  })

  it('leaves a card without trackers unjudged', () => {
    expect(rules('weight')).toEqual({ find: { match: 'all', blocks: [] }, now: { kind: 'off' }, back: null })
  })

  it('refuses a card whose tracker counts another root', () => {
    const bad = { ...legacy, cards: [{ id: 'x', tag: '洗車', emoji: '🚗', trackerId: 'orphan' }] }
    expect(() => convertLegacyConfig(bad)).toThrow(/not the card's root/)
  })
})
