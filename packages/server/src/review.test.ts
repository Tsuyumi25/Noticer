import { describe, expect, it } from 'vitest'
import { emptyConfig, type Config, type Rules } from './config.ts'
import type { EventRecord } from './events.ts'
import { cardCalendar } from './review.ts'

const local = (month: number, d: number, h = 12) => new Date(2026, month - 1, d, h).getTime() / 1000
let nextId = 1
const ev = (eventAt: number, tags: string[], facts: EventRecord['facts'] = {}): EventRecord => ({
  id: nextId++, cardId: 'x', eventAt, timeOffset: 0, note: null, tags, facts, attachments: [],
})

const unjudged: Rules = { find: { match: 'all', blocks: [] }, now: {}, back: null }
const config: Config = {
  ...emptyConfig,
  cards: [
    { id: 'coffee', name: '喝咖啡', root: '喝咖啡', emoji: '☕', rules: { ...unjudged, back: { span: 'day', measure: { kind: 'times' }, want: { kind: 'atLeast', n: 2 } } } },
    { id: 'weight', name: '體重', root: '體重', emoji: '⚖️', rules: unjudged },
    { id: 'today', name: '今日', root: '今日', emoji: '📔', rules: unjudged, facts: ['mood_emoji'] },
  ],
  tagGroups: { 體重: { groups: [], values: { 體重: { unit: 'kg', decimals: 1, keep: 'latest' } } } },
  factInputs: {
    mood_emoji: { kind: 'choice', name: '心情', options: [{ value: '🙂', label: '不錯' }] },
  },
}
const card = (id: string) => config.cards.find((c) => c.id === id)!

describe('cardCalendar', () => {
  it('runs from the first of the month of the earliest event through today, one entry per local day', () => {
    const { days } = cardCalendar(config, card('coffee'), [ev(local(10, 20), ['喝咖啡'])], local(11, 3))
    expect(days[0]?.date).toBe('2026-10-01')
    expect(days.at(-1)?.date).toBe('2026-11-03')
    expect(days).toHaveLength(31 + 3)
  })

  it("takes counts and states from the card's looking-back rule", () => {
    const events = [ev(local(11, 2, 8), ['喝咖啡']), ev(local(11, 2, 13), ['喝咖啡']), ev(local(11, 3, 8), ['喝咖啡'])]
    const { days } = cardCalendar(config, card('coffee'), events, local(11, 3, 20))
    expect(days.slice(-2)).toEqual([
      { date: '2026-11-02', value: 2, delta: null, state: 'good' },
      { date: '2026-11-03', value: 1, delta: null, state: 'warning' },
    ])
  })

  it("shows the last value of the day in a unit that replaces itself, and its change from the previous recorded day", () => {
    const events = [
      ev(local(11, 1, 8), ['體重'], { '體重:kg': 50.6 }),
      ev(local(11, 3, 8), ['體重'], { '體重:kg': 50.4 }),
      ev(local(11, 3, 21), ['體重'], { '體重:kg': 50.2 }),
    ]
    const { days, card: meta } = cardCalendar(config, card('weight'), events, local(11, 3, 22))
    expect(meta.decimals).toBe(1)
    expect(days.map((d) => [d.value, d.delta, d.state])).toEqual([
      [50.6, null, 'logged'],
      [null, null, 'none'],
      [50.2, -0.4, 'logged'],
    ])
  })

  it('shows the chosen option instead of a count when the card has a choice fact', () => {
    const { days } = cardCalendar(config, card('today'), [ev(local(11, 1), ['今日'], { mood_emoji: '🙂' })], local(11, 1, 20))
    expect(days).toEqual([{ date: '2026-11-01', value: '🙂', delta: null, state: 'logged' }])
  })
})
