import { describe, expect, it } from 'vitest'
import type { EventRecord } from './events.ts'
import { evaluateSleep } from './sleep.ts'

const H = 3600
const local = (d: number, h = 12, m = 0) => new Date(2026, 5, d, h, m).getTime() / 1000
let nextId = 1
const ev = (eventAt: number, tags: string[], cardId = 'x', facts: EventRecord['facts'] = {}): EventRecord => ({
  id: nextId++, cardId, eventAt, timeOffset: 0, note: null, tags, facts, attachments: [], versions: [],
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
