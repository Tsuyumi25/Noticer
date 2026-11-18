import type { EventRecord } from './events.ts'
import type { CardStatus } from './trackers.ts'

export const SLEEP_CARD = 'sleep_start'
export const WAKE_CARD = 'sleep_end'

const AWAKE = { good: 8, pending: 11, warning: 16 }
const ASLEEP = { warning: 6, good: 7, tooLong: 10 }
const STALE_HOURS = { awake: 30, asleep: 20 }
const MAX_BLOCK_HOURS = 20
const MAIN_SLEEP_HOURS = 4
const NEXT_SLEEP = { minWake: 8, maxWake: 30, halfLifeDays: 28, minSamples: 5 }

export interface SleepPair {
  state: 'awake' | 'asleep' | 'unknown'
  hours: number | null
  status: CardStatus
  progress: number
  maxHours: number | null
  lastSleepHours: number | null
  predictedSleepAt: number | null
}

interface Block {
  onset: number
  offset: number
}

function blocksOf(events: EventRecord[]): Block[] {
  const blocks: Block[] = []
  for (let i = 0; i < events.length - 1; i++) {
    const a = events[i]!
    const b = events[i + 1]!
    if (a.cardId === SLEEP_CARD && b.cardId === WAKE_CARD && b.eventAt - a.eventAt <= MAX_BLOCK_HOURS * 3600) {
      blocks.push({ onset: a.eventAt, offset: b.eventAt })
    }
  }
  return blocks
}

/** Recency-weighted median of past wake spans longer than the hours already awake. */
function predictSleep(blocks: Block[], now: number): number | null {
  const main = blocks.filter((b) => b.offset - b.onset >= MAIN_SLEEP_HOURS * 3600 && b.offset <= now)
  const last = main[main.length - 1]
  if (!last) return null
  const awake = (now - last.offset) / 3600
  const samples = main
    .slice(0, -1)
    .map((b, i) => ({ hours: (main[i + 1]!.onset - b.offset) / 3600, onset: main[i + 1]!.onset }))
    .filter((s) => s.hours >= NEXT_SLEEP.minWake && s.hours <= NEXT_SLEEP.maxWake && s.hours > awake)
    .map((s) => ({ hours: s.hours, weight: 0.5 ** ((last.offset - s.onset) / 86400 / NEXT_SLEEP.halfLifeDays) }))
    .sort((a, b) => a.hours - b.hours)
  if (samples.length < NEXT_SLEEP.minSamples) return null
  const total = samples.reduce((sum, s) => sum + s.weight, 0)
  let cumulative = 0
  const median = samples.find((s) => (cumulative += s.weight) >= total / 2)!.hours
  return Math.round(last.offset + median * 3600)
}

export function evaluateSleep(events: EventRecord[], now: number): SleepPair {
  const sleepEvents = events.filter((e) => (e.cardId === SLEEP_CARD || e.cardId === WAKE_CARD) && e.eventAt <= now)
  const last = sleepEvents[sleepEvents.length - 1]
  const unknown: SleepPair = { state: 'unknown', hours: null, status: 'unknown', progress: 0, maxHours: null, lastSleepHours: null, predictedSleepAt: null }
  if (!last) return unknown

  const hours = (now - last.eventAt) / 3600
  if (last.cardId === WAKE_CARD) {
    if (hours > STALE_HOURS.awake) return { ...unknown, hours }
    const prev = sleepEvents[sleepEvents.length - 2]
    const lastSleepHours = prev?.cardId === SLEEP_CARD ? (last.eventAt - prev.eventAt) / 3600 : null
    const status = hours < AWAKE.good ? 'good' : hours < AWAKE.pending ? 'pending' : hours < AWAKE.warning ? 'warning' : 'danger'
    return {
      state: 'awake',
      hours,
      status,
      progress: Math.max(0, ((AWAKE.warning - hours) / AWAKE.warning) * 100),
      maxHours: AWAKE.warning,
      lastSleepHours,
      predictedSleepAt: predictSleep(blocksOf(sleepEvents), now),
    }
  }
  if (hours > STALE_HOURS.asleep) return { ...unknown, hours }
  const status = hours < ASLEEP.warning ? 'pending' : hours < ASLEEP.good ? 'warning' : hours < ASLEEP.tooLong ? 'good' : 'warning'
  return {
    state: 'asleep',
    hours,
    status,
    progress: Math.min(100, (hours / ASLEEP.tooLong) * 100),
    maxHours: ASLEEP.tooLong,
    lastSleepHours: null,
    predictedSleepAt: null,
  }
}
