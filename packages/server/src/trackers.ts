import type { CompareStage, PeriodicTrackerConfig, RuleStatus, StatusTrackerConfig, TrackerSource } from './config.ts'
import type { EventRecord } from './events.ts'

export type CardStatus = RuleStatus | 'unknown'
export type DailyState = RuleStatus | 'good-carry' | 'none'

export interface StatusResult {
  status: CardStatus
  progress: number
  lastAt: number | null
  maxHours: number
}

export interface DailyStrip {
  values: (number | boolean | null)[]
  states: DailyState[]
}

export function matchesSource(event: EventRecord, source: TrackerSource): boolean {
  const tags = event.tags
  return (Array.isArray(source) ? source : [source]).some(
    (src) =>
      tags.includes(src.tag) &&
      !src.excludeTags?.some((t) => tags.includes(t)) &&
      (src.allTags ?? []).every((t) => tags.includes(t)) &&
      (!src.tags?.length || src.tags.some((t) => tags.includes(t))),
  )
}

function lastMatchAt(events: EventRecord[], source: TrackerSource, now: number): number | null {
  for (let i = events.length - 1; i >= 0; i--) {
    const e = events[i]!
    if (e.eventAt <= now && matchesSource(e, source)) return e.eventAt
  }
  return null
}

export function evaluateStatus(tracker: StatusTrackerConfig, events: EventRecord[], now: number): StatusResult {
  const lastAt = lastMatchAt(events, tracker.source, now)
  if (tracker.type === 'deadline') {
    const stages = [...tracker.stages].sort((a, b) => a.lessThan - b.lessThan)
    const limit = stages[stages.length - 1]!.lessThan
    if (lastAt === null) return { status: 'unknown', progress: 0, lastAt, maxHours: limit / 3600e3 }
    const elapsed = (now - lastAt) * 1000
    const status = stages.find((s) => elapsed < s.lessThan)?.status ?? 'danger'
    const progress = elapsed >= limit ? 0 : ((limit - elapsed) / limit) * 100
    return { status, progress, lastAt, maxHours: limit / 3600e3 }
  }
  const stages = [...tracker.stages].sort((a, b) => a.atLeast - b.atLeast)
  const required = stages[stages.length - 1]!.atLeast
  if (lastAt === null) return { status: 'unknown', progress: 0, lastAt, maxHours: required / 3600e3 }
  const elapsed = (now - lastAt) * 1000
  const reached = stages.filter((s) => elapsed >= s.atLeast)
  const status = reached[reached.length - 1]?.status ?? tracker.initial?.status ?? 'pending'
  return { status, progress: Math.min(100, (elapsed / required) * 100), lastAt, maxHours: required / 3600e3 }
}

function compareState(value: number, stages: CompareStage[]): RuleStatus {
  const equal = stages.find((s) => s.equals === value)
  if (equal) return equal.status
  const greater = stages
    .filter((s) => s.greaterThan !== undefined)
    .sort((a, b) => b.greaterThan! - a.greaterThan!)
    .find((s) => value > s.greaterThan!)
  if (greater) return greater.status
  const less = stages
    .filter((s) => s.lessThan !== undefined)
    .sort((a, b) => a.lessThan! - b.lessThan!)
    .find((s) => value < s.lessThan!)
  return less?.status ?? 'good'
}

function intervalState(gap: number, stages: CompareStage[]): RuleStatus {
  const equal = stages.find((s) => s.equals === gap)
  if (equal) return equal.status
  const greater = stages
    .filter((s) => s.greaterThan !== undefined)
    .sort((a, b) => b.greaterThan! - a.greaterThan!)
    .find((s) => gap > s.greaterThan!)
  if (greater) return greater.status
  const less = stages
    .filter((s) => s.lessThan !== undefined)
    .sort((a, b) => b.lessThan! - a.lessThan!)
    .find((s) => gap < s.lessThan!)
  return less?.status ?? 'good'
}

/** Local-midnight starts of the last `days` days ending today, plus the start of tomorrow. */
function dayStarts(now: number, days: number): number[] {
  const today = new Date(now * 1000)
  return Array.from({ length: days + 1 }, (_, i) =>
    new Date(today.getFullYear(), today.getMonth(), today.getDate() - (days - 1) + i).getTime() / 1000,
  )
}

export function evaluateStrip(tracker: PeriodicTrackerConfig, events: EventRecord[], now: number, days = 7): DailyStrip {
  const matched = events.filter((e) => e.eventAt <= now && matchesSource(e, tracker.source))
  const starts = dayStarts(now, days)
  const buckets = Array.from({ length: days }, (_, i) =>
    matched.filter((e) => e.eventAt >= starts[i]! && e.eventAt < starts[i + 1]!),
  )
  const firstAt = matched[0]?.eventAt
  const hasData = buckets.map((_, i) => firstAt !== undefined && firstAt < starts[i + 1]!)

  let values: (number | boolean)[]
  let states: DailyState[]
  switch (tracker.type) {
    case 'dailyCount':
      values = buckets.map((b) => b.length)
      states = values.map((v) => compareState(v as number, tracker.stages))
      break
    case 'duration':
      values = buckets.map((b) => b.reduce((sum, e) => sum + Math.max(0, Number(e.facts.duration_min ?? 0) || 0), 0))
      states = values.map((v) => compareState(v as number, tracker.stages))
      break
    case 'dailyBinary':
      values = buckets.map((b) => b.length > 0)
      states = values.map((v) => (v ? 'good' : 'danger'))
      break
    case 'dailyAbsence':
      values = buckets.map((b) => b.length > 0)
      states = values.map((v) => (v ? 'danger' : 'good'))
      break
    case 'periodLimit':
      values = buckets.map((b) => b.length)
      states = values.map((v) => (v === 0 ? 'good' : v === 1 ? 'warning' : 'danger'))
      break
    case 'interval': {
      values = buckets.map((b) => b.length)
      const before = matched.filter((e) => e.eventAt < starts[0]!)
      let gap = before.length ? Math.floor((starts[0]! - before[before.length - 1]!.eventAt) / 86400) : Infinity
      states = values.map((v) => {
        if (v) {
          gap = 0
          return 'good'
        }
        gap += 1
        const s = intervalState(gap, tracker.stages)
        return s === 'good' ? 'good-carry' : s
      })
      break
    }
  }
  return {
    values: values.map((v, i) => (hasData[i] ? v : null)),
    states: states.map((s, i) => (hasData[i] ? s : 'none')),
  }
}
