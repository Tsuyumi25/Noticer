import { describe, expect, it } from 'vitest'
import type { Find, Rules } from './config.ts'
import type { EventRecord } from './events.ts'
import { evaluateDays, evaluateNow, matchesFind } from './rules.ts'

const H = 3600
const local = (d: number, h = 12, m = 0) => new Date(2026, 5, d, h, m).getTime() / 1000
let nextId = 1
const ev = (eventAt: number, tags: string[], facts: EventRecord['facts'] = {}): EventRecord => ({
  id: nextId++, cardId: 'x', eventAt, timeOffset: 0, note: null, tags, facts, attachments: [],
})
const all: Find = { match: 'all', blocks: [] }
type Row = Find['blocks'][number]['layers'][number][number]
const has = (...tags: string[]): Row => ({ kind: 'tag', op: 'has', tags })
const not = (...tags: string[]): Row => ({ kind: 'tag', op: 'not', tags })
const every = (...tags: string[]): Row => ({ kind: 'tag', op: 'all', tags })
/** One block per row, joined by `match`. */
const flat = (match: Find['match'], ...rows: Row[]): Find => ({ match, blocks: rows.map((r) => ({ ops: ['all'], layers: [[r]] })) })

describe('matchesFind', () => {
  const e = ev(local(13, 8), ['護膚', '化妝水', '面膜'])
  const one = (row: Row) => matchesFind(flat('all', row), '護膚', e)

  it('requires the root tag even with no conditions', () => {
    expect(matchesFind(all, '護膚', e)).toBe(true)
    expect(matchesFind(all, '喝咖啡', e)).toBe(false)
  })

  it('counts a has row when any of its tags is there, an all row when every one is, and a not row when none are', () => {
    expect(one(has('防曬', '面膜'))).toBe(true)
    expect(one(has('防曬', '全套'))).toBe(false)
    expect(one(every('化妝水', '面膜'))).toBe(true)
    expect(one(every('化妝水', '防曬'))).toBe(false)
    expect(one(not('防曬', '全套'))).toBe(true)
    expect(one(not('防曬', '面膜'))).toBe(false)
  })

  it('joins blocks with all or any', () => {
    expect(matchesFind(flat('all', has('全套'), has('化妝水')), '護膚', e)).toBe(false)
    expect(matchesFind(flat('any', has('全套'), has('化妝水')), '護膚', e)).toBe(true)
  })

  it('reads a block top to bottom, each layer joining everything above with its own connector', () => {
    // ((防曬 ∨ 化妝水) ∧ 面膜) ∨ 全套
    const find: Find = { match: 'all', blocks: [{ ops: ['any', 'all', 'any'], layers: [[has('防曬'), has('化妝水')], [has('面膜')], [has('全套')]] }] }
    expect(matchesFind(find, '護膚', e)).toBe(true)
    expect(matchesFind(find, '護膚', ev(local(13), ['護膚', '化妝水']))).toBe(false)
    expect(matchesFind(find, '護膚', ev(local(13), ['護膚', '全套']))).toBe(true)
  })

  it('reads time windows in local minutes, wrapping past midnight', () => {
    expect(one({ kind: 'time', from: 6 * 60, to: 10 * 60 })).toBe(true)
    expect(one({ kind: 'time', from: 8 * 60, to: 8 * 60 })).toBe(false)
    expect(one({ kind: 'time', from: 22 * 60, to: 9 * 60 })).toBe(true)
    expect(one({ kind: 'time', from: 22 * 60, to: 8 * 60 })).toBe(false)
    expect(one({ kind: 'time', from: 7 * 60 + 59, to: 8 * 60 + 1 })).toBe(true)
    expect(one({ kind: 'time', from: 8 * 60 + 1, to: 10 * 60 })).toBe(false)
  })

  it('tells weekdays from weekends', () => {
    // 2026-06-13 is a Saturday.
    expect(one({ kind: 'weekday', is: 'weekend' })).toBe(true)
    expect(matchesFind(flat('all', { kind: 'weekday', is: 'weekday' }), '護膚', ev(local(15), ['護膚']))).toBe(true)
  })
})

describe('evaluateNow', () => {
  const late: Rules = { find: all, now: { late: { warn: 6 * H, danger: 8 * H } }, back: null }

  it('warns from `warn` and is in danger from `danger`, draining toward danger', () => {
    const at = local(10)
    const events = [ev(at - 100 * H, ['澆花']), ev(at, ['澆花'])]
    expect(evaluateNow(late, '澆花', events, at + 2 * H)).toMatchObject({ status: 'good', mode: 'late', progress: 75, maxHours: 8 })
    expect(evaluateNow(late, '澆花', events, at + 6 * H).status).toBe('warning')
    expect(evaluateNow(late, '澆花', events, at + 8 * H)).toMatchObject({ status: 'danger', progress: 0 })
  })

  it('stays pending inside a soon window and fills toward it', () => {
    const at = local(10)
    const rules: Rules = { find: all, now: { soon: 4 * H }, back: null }
    expect(evaluateNow(rules, '喝咖啡', [ev(at, ['喝咖啡'])], at + 1 * H)).toMatchObject({ status: 'pending', mode: 'soon', progress: 25 })
    expect(evaluateNow(rules, '喝咖啡', [ev(at, ['喝咖啡'])], at + 5 * H)).toMatchObject({ status: 'good', progress: 100 })
  })

  it('runs too soon, then good, warning and danger when both ends are set, with the water full where soon ends', () => {
    const at = local(10)
    const rules: Rules = { find: all, now: { soon: 4 * H, late: { warn: 8 * H, danger: 12 * H } }, back: null }
    const at_ = (h: number) => evaluateNow(rules, '喝咖啡', [ev(at, ['喝咖啡'])], at + h * H)
    expect(at_(2)).toMatchObject({ status: 'pending', mode: 'soon', progress: 50, maxHours: 4 })
    expect(at_(4)).toMatchObject({ status: 'good', mode: 'late', progress: 100, maxHours: 12 })
    expect(at_(10)).toMatchObject({ status: 'warning', progress: 25 })
    expect(at_(12).status).toBe('danger')
  })

  it('takes the last counted event at or before now, however many newer ones only share the root', () => {
    const at = local(1)
    const events = [ev(at, ['喝咖啡', '加糖']), ...Array.from({ length: 300 }, (_, i) => ev(at + (i + 1) * H, ['喝咖啡']))]
    const rules: Rules = { find: flat('all', has('加糖')), now: { soon: 7 * 24 * H }, back: null }
    expect(evaluateNow(rules, '喝咖啡', events, at + 400 * H).lastAt).toBe(at)
    expect(evaluateNow(late, '喝咖啡', events, at + 3 * H).lastAt).toBe(at + 3 * H)
  })

  it('is unknown without a counted event or without a reminder', () => {
    expect(evaluateNow(late, '澆花', [ev(local(10), ['喝咖啡'])], local(11))).toMatchObject({ status: 'unknown', progress: 0 })
    const off: Rules = { find: all, now: {}, back: null }
    expect(evaluateNow(off, '澆花', [ev(local(10), ['澆花'])], local(11))).toMatchObject({ status: 'unknown', mode: null, maxHours: null })
  })
})

describe('evaluateDays', () => {
  const now = local(20, 15)
  const rules = (back: Rules['back'], find: Find = all): Rules => ({ find, now: {}, back })

  it('counts per local day, oldest first, with no value before the first counted event', () => {
    const events = [ev(local(18, 0, 5), ['喝咖啡']), ev(local(18, 23, 55), ['喝咖啡']), ev(local(20, 9), ['喝咖啡'])]
    expect(evaluateDays(rules({ span: 'day', measure: { kind: 'times' }, want: { kind: 'between', lo: 2, hi: 3 } }), '喝咖啡', events, now)).toEqual({
      values: [null, null, null, null, 2, 0, 1],
      states: ['none', 'none', 'none', 'none', 'good', 'danger', 'warning'],
    })
  })

  it('counts days since the last event by calendar day, carrying the good ones', () => {
    const events = [ev(local(12), ['洗車']), ev(local(16, 23), ['洗車'])]
    const strip = evaluateDays(rules({ span: 'day', measure: { kind: 'since' }, want: { kind: 'atMost', n: 2 } }), '洗車', events, now)
    expect(strip?.values).toEqual([2, 3, 0, 1, 2, 3, 4])
    expect(strip?.states).toEqual(['good-carry', 'danger', 'good', 'good-carry', 'good-carry', 'danger', 'danger'])
  })

  it('looks back a week when the span is a week', () => {
    const events = [ev(local(13), ['喝咖啡', '加糖']), ev(local(17), ['喝咖啡', '加糖'])]
    const strip = evaluateDays(rules({ span: 'week', measure: { kind: 'times' }, want: { kind: 'atMost', n: 1 } }), '喝咖啡', events, now)
    expect(strip?.values).toEqual([1, 1, 1, 2, 2, 2, 1])
    expect(strip?.states.slice(2, 4)).toEqual(['good', 'danger'])
  })

  it('sums or reads the values recorded in a unit across tags, leaving days without one empty', () => {
    const events = [
      ev(local(14), ['練習', '鋼琴'], { '鋼琴:分鐘': 15 }),
      ev(local(20, 8), ['練習', '鋼琴', '吉他'], { '鋼琴:分鐘': 10, '吉他:分鐘': 5 }),
      ev(local(20, 9), ['練習', '長笛'], { '長笛:分鐘': 20, '長笛:首': 2 }),
    ]
    const total = evaluateDays(rules({ span: 'day', measure: { kind: 'total', unit: '分鐘' }, want: { kind: 'atLeast', n: 20 } }), '練習', events, now)
    expect(total?.values.slice(-1)).toEqual([35])
    expect(total?.states[0]).toBe('warning')
    const weights = [ev(local(19, 8), ['體重'], { '體重:kg': 53.2 }), ev(local(19, 22), ['體重'], { '體重:kg': 53.6 })]
    const last = evaluateDays(rules({ span: 'day', measure: { kind: 'last', unit: 'kg' }, want: { kind: 'off' } }), '體重', weights, now)
    expect(last?.values.slice(-2)).toEqual([53.6, null])
    expect(last?.states.slice(-2)).toEqual(['logged', 'none'])
  })

  it('uses the looking-back find when it has one, and nothing without a back rule', () => {
    const events = [ev(local(20, 8), ['喝咖啡']), ev(local(20, 10), ['喝咖啡', '試喝'])]
    const own: Find = flat('all', not('試喝'))
    const strip = evaluateDays(rules({ span: 'day', measure: { kind: 'times' }, want: { kind: 'atLeast', n: 1 }, find: own }), '喝咖啡', events, now)
    expect(strip?.values.at(-1)).toBe(1)
    expect(evaluateDays(rules(null), '喝咖啡', events, now)).toBeNull()
  })
})
