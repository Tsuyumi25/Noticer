import { describe, expect, it } from 'vitest'
import type { PeriodicTrackerConfig, StatusTrackerConfig } from './config.ts'
import type { EventRecord } from './events.ts'
import { evaluateSleep } from './sleep.ts'
import { evaluateStatus, evaluateStrip, matchesSource } from './trackers.ts'

const H = 3600
const local = (d: number, h = 12, m = 0) => new Date(2026, 5, d, h, m).getTime() / 1000
let nextId = 1
const ev = (eventAt: number, tags: string[], cardId = 'x', facts: EventRecord['facts'] = {}): EventRecord => ({
  id: nextId++, cardId, eventAt, timeOffset: 0, note: null, tags, facts,
})

describe('matchesSource', () => {
  const e = ev(0, ['護膚', '化妝水', '面膜'])
  it('requires the base tag and applies tags (any), allTags (every) and excludeTags (none)', () => {
    expect(matchesSource(e, { tag: '護膚', tags: ['防曬', '化妝水'] })).toBe(true)
    expect(matchesSource(e, { tag: '護膚', tags: ['防曬'] })).toBe(false)
    expect(matchesSource(e, { tag: '護膚', allTags: ['化妝水', '面膜'] })).toBe(true)
    expect(matchesSource(e, { tag: '護膚', allTags: ['化妝水', '全套'] })).toBe(false)
    expect(matchesSource(e, { tag: '護膚', excludeTags: ['面膜'] })).toBe(false)
    expect(matchesSource(e, { tag: '喝咖啡' })).toBe(false)
  })
  it('treats a list of sources as a union', () => {
    expect(matchesSource(e, [{ tag: '喝咖啡' }, { tag: '護膚', tags: ['面膜'] }])).toBe(true)
  })
})

describe('evaluateStatus', () => {
  const deadline: StatusTrackerConfig = {
    id: 'water_plants', type: 'deadline', display: { name: '澆花', emoji: '🪴' }, source: { tag: '澆花' },
    stages: [{ lessThan: 8 * H * 1000, status: 'warning' }, { lessThan: 6 * H * 1000, status: 'good' }],
  }
  const cooldown: StatusTrackerConfig = {
    id: 'coffee', type: 'cooldown', display: { name: '喝咖啡', emoji: '☕' }, source: { tag: '喝咖啡' },
    stages: [{ atLeast: 3 * H * 1000, status: 'pending' }, { atLeast: 4 * H * 1000, status: 'good' }],
    initial: { status: 'pending' },
  }

  it('walks deadline stages by elapsed time and drops progress to zero past the limit', () => {
    const at = local(10)
    const events = [ev(at - 100 * H, ['澆花']), ev(at, ['澆花'])]
    expect(evaluateStatus(deadline, events, at + 2 * H)).toMatchObject({ status: 'good', progress: 75, maxHours: 8 })
    expect(evaluateStatus(deadline, events, at + 7 * H).status).toBe('warning')
    expect(evaluateStatus(deadline, events, at + 9 * H)).toMatchObject({ status: 'danger', progress: 0 })
  })

  it('ignores events after the reference time', () => {
    const at = local(10)
    const events = [ev(at, ['澆花']), ev(at + 5 * H, ['澆花'])]
    expect(evaluateStatus(deadline, events, at + 7 * H).lastAt).toBe(at + 5 * H)
    expect(evaluateStatus(deadline, events, at + 4 * H).lastAt).toBe(at)
  })

  it('stays at the initial cooldown status until the first stage and caps progress at 100', () => {
    const at = local(10)
    const events = [ev(at, ['喝咖啡'])]
    expect(evaluateStatus(cooldown, events, at + 1 * H)).toMatchObject({ status: 'pending', progress: 25 })
    expect(evaluateStatus(cooldown, events, at + 5 * H)).toMatchObject({ status: 'good', progress: 100 })
  })

  it('finds a match no matter how many newer events share the base tag', () => {
    const at = local(1)
    const events = [ev(at, ['喝咖啡', '加糖']), ...Array.from({ length: 300 }, (_, i) => ev(at + (i + 1) * H, ['喝咖啡']))]
    const sweet: StatusTrackerConfig = { ...cooldown, id: 'sweet', source: { tag: '喝咖啡', tags: ['加糖'] } }
    expect(evaluateStatus(sweet, events, at + 400 * H).lastAt).toBe(at)
  })

  it('reports unknown without a matching event', () => {
    expect(evaluateStatus(deadline, [ev(local(10), ['喝咖啡'])], local(11))).toMatchObject({ status: 'unknown', progress: 0 })
  })
})

describe('evaluateStrip', () => {
  const now = local(20, 15)

  it('counts per local day, oldest first, and marks days before the first event as none', () => {
    const t: PeriodicTrackerConfig = { id: 'coffee', type: 'dailyCount', source: { tag: '喝咖啡' }, stages: [{ lessThan: 2, status: 'warning' }] }
    const events = [ev(local(18, 0, 5), ['喝咖啡']), ev(local(18, 23, 55), ['喝咖啡']), ev(local(20, 9), ['喝咖啡'])]
    expect(evaluateStrip(t, events, now)).toEqual({
      values: [null, null, null, null, 2, 0, 1],
      states: ['none', 'none', 'none', 'none', 'good', 'warning', 'warning'],
    })
  })

  it('carries interval days until the gap crosses a threshold, counting the gap from before the window', () => {
    const t: PeriodicTrackerConfig = { id: 'carwash', type: 'interval', source: { tag: '洗車' }, stages: [{ greaterThan: 2, status: 'danger' }] }
    const events = [ev(local(12), ['洗車']), ev(local(16), ['洗車'])]
    expect(evaluateStrip(t, events, now).states).toEqual(['good-carry', 'danger', 'good', 'good-carry', 'good-carry', 'danger', 'danger'])
  })

  it('sums duration facts per day', () => {
    const t: PeriodicTrackerConfig = { id: 'ex', type: 'duration', source: { tag: '練習' }, stages: [{ lessThan: 20, status: 'warning' }] }
    const events = [ev(local(14), ['練習'], 'x', { duration_min: 15 }), ev(local(20, 8), ['練習'], 'x', { duration_min: 10 }), ev(local(20, 9), ['練習'], 'x', { duration_min: 25 })]
    const strip = evaluateStrip(t, events, now)
    expect(strip.values.slice(-1)).toEqual([35])
    expect(strip.states.slice(-1)).toEqual(['good'])
    expect(strip.states[0]).toBe('warning')
  })
})

describe('evaluateSleep', () => {
  const sleep = (at: number) => ev(at, ['睡覺'], 'sleep_start')
  const wake = (at: number) => ev(at, ['起床'], 'sleep_end')

  it('is awake after a wake event, with the last sleep length and awake thresholds', () => {
    const w = local(10, 8)
    const events = [sleep(w - 7 * H), wake(w)]
    expect(evaluateSleep(events, w + 2 * H)).toMatchObject({ state: 'awake', status: 'good', lastSleepHours: 7, maxHours: 16 })
    expect(evaluateSleep(events, w + 12 * H).status).toBe('warning')
    expect(evaluateSleep(events, w + 17 * H)).toMatchObject({ status: 'danger', progress: 0 })
  })

  it('flags sleep that is too short or too long', () => {
    const s = local(10, 23)
    expect(evaluateSleep([sleep(s)], s + 5 * H)).toMatchObject({ state: 'asleep', status: 'pending' })
    expect(evaluateSleep([sleep(s)], s + 8 * H).status).toBe('good')
    expect(evaluateSleep([sleep(s)], s + 11 * H).status).toBe('warning')
  })

  it('becomes unknown when the last event is too old for its state', () => {
    expect(evaluateSleep([wake(local(10))], local(10) + 31 * H).state).toBe('unknown')
    expect(evaluateSleep([sleep(local(10))], local(10) + 21 * H).state).toBe('unknown')
    expect(evaluateSleep([], local(10)).state).toBe('unknown')
  })

  it('predicts the next sleep only from enough longer past wake spans', () => {
    const events: EventRecord[] = []
    for (let d = 1; d <= 8; d++) events.push(sleep(local(d, 0)), wake(local(d, 8)))
    const lastWake = local(8, 8)
    expect(evaluateSleep(events, lastWake + H).predictedSleepAt).toBe(lastWake + 16 * H)
    expect(evaluateSleep(events.slice(0, 8), local(4, 9)).predictedSleepAt).toBeNull()
  })
})
