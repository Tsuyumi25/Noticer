import type { BackRule, Block, Filter, Find, Match, Measure, RuleStatus, Rules, Want } from './config.ts'
import type { EventRecord } from './events.ts'

export type CardStatus = RuleStatus | 'unknown'
/** `good-carry`: a day without events that is still fine; `logged`: a value with nothing to judge it by. */
export type DailyState = RuleStatus | 'good-carry' | 'logged' | 'none'

export interface NowResult {
  status: CardStatus
  /** Water left, 0–100: a worry card drains toward its last threshold, a soon card fills toward its first. */
  progress: number
  lastAt: number | null
  maxHours: number | null
}

export interface DailyStrip {
  values: (number | null)[]
  states: DailyState[]
}

export function filterMatches(filter: Filter, event: EventRecord): boolean {
  switch (filter.kind) {
    case 'tag': {
      const carries = (t: string) => event.tags.includes(t)
      if (filter.op === 'all') return filter.tags.every(carries)
      const hit = filter.tags.some(carries)
      return filter.op === 'has' ? hit : !hit
    }
    case 'time': {
      const d = new Date(event.eventAt * 1000)
      const h = d.getHours() + d.getMinutes() / 60
      return filter.from <= filter.to ? h >= filter.from && h < filter.to : h >= filter.from || h < filter.to
    }
    case 'weekday': {
      const day = new Date(event.eventAt * 1000).getDay()
      return (day === 0 || day === 6) === (filter.is === 'weekend')
    }
  }
}

const join = (match: Match, values: boolean[]) => (match === 'all' ? values.every(Boolean) : values.some(Boolean))

export function blockMatches(block: Block, event: EventRecord): boolean {
  let result = join(block.ops[0]!, block.layers[0]!.map((f) => filterMatches(f, event)))
  for (let k = 1; k < block.layers.length; k++) {
    result = join(block.ops[k]!, [result, ...block.layers[k]!.map((f) => filterMatches(f, event))])
  }
  return result
}

export function matchesFind(find: Find, root: string, event: EventRecord): boolean {
  if (!event.tags.includes(root)) return false
  return find.blocks.length === 0 || join(find.match, find.blocks.map((b) => blockMatches(b, event)))
}

export function evaluateNow(rules: Rules, root: string, events: EventRecord[], now: number): NowResult {
  let lastAt: number | null = null
  for (let i = events.length - 1; i >= 0; i--) {
    const e = events[i]!
    if (e.eventAt <= now && matchesFind(rules.find, root, e)) {
      lastAt = e.eventAt
      break
    }
  }
  const rule = rules.now
  if (rule.kind === 'off') return { status: 'unknown', progress: 0, lastAt, maxHours: null }
  const limit = rule.kind === 'worry' ? (rule.panic ?? rule.after) : rule.within
  if (lastAt === null) return { status: 'unknown', progress: 0, lastAt, maxHours: limit / 3600 }
  const elapsed = now - lastAt
  if (rule.kind === 'soon') {
    return { status: elapsed >= limit ? 'good' : 'pending', progress: Math.min(100, (elapsed / limit) * 100), lastAt, maxHours: limit / 3600 }
  }
  const status = elapsed < rule.after ? 'good' : rule.panic !== undefined && elapsed < rule.panic ? 'warning' : 'danger'
  return { status, progress: elapsed >= limit ? 0 : ((limit - elapsed) / limit) * 100, lastAt, maxHours: limit / 3600 }
}

export function wantStatus(want: Exclude<Want, { kind: 'off' }>, value: number): RuleStatus {
  switch (want.kind) {
    case 'atLeast':
      return value >= want.n ? 'good' : value === 0 ? 'danger' : 'warning'
    case 'atMost':
      return value <= want.n ? 'good' : want.red !== undefined && value <= want.red ? 'warning' : 'danger'
    case 'between':
      return value >= want.lo && value <= want.hi ? 'good' : value >= want.lo - 1 && value <= want.hi + 1 ? 'warning' : 'danger'
  }
}

const localMidnight = (seconds: number) => {
  const d = new Date(seconds * 1000)
  return new Date(d.getFullYear(), d.getMonth(), d.getDate()).getTime() / 1000
}

/** Local-midnight starts of the last `days` days ending today, plus the start of tomorrow. */
export function dayStarts(now: number, days: number): number[] {
  const today = new Date(now * 1000)
  return Array.from({ length: days + 1 }, (_, i) =>
    new Date(today.getFullYear(), today.getMonth(), today.getDate() - (days - 1) + i).getTime() / 1000,
  )
}

function measureValue(measure: Measure, inSpan: EventRecord[], history: EventRecord[], dayStart: number): number | null {
  switch (measure.kind) {
    case 'times':
      return inSpan.length
    case 'total':
      return inSpan.reduce((sum, e) => sum + Math.max(0, Number(e.facts[measure.fact] ?? 0) || 0), 0)
    case 'last': {
      const hit = inSpan.findLast((e) => typeof e.facts[measure.fact] === 'number')
      return hit ? (hit.facts[measure.fact] as number) : null
    }
    case 'since':
      return Math.round((dayStart - localMidnight(history.at(-1)!.eventAt)) / 86400)
  }
}

export const backFind = (rules: Rules): Find => rules.back?.find ?? rules.find

function judge(back: BackRule, value: number | null): DailyState {
  if (value === null) return 'none'
  if (back.want.kind === 'off') return 'logged'
  const status = wantStatus(back.want, value)
  return back.measure.kind === 'since' && status === 'good' && value > 0 ? 'good-carry' : status
}

/** One value and state per day for the last `days` days ending today; days before the first counted event have none. */
export function evaluateDays(rules: Rules, root: string, events: EventRecord[], now: number, days = 7): DailyStrip | null {
  const back = rules.back
  if (!back) return null
  const find = backFind(rules)
  const matched = events.filter((e) => e.eventAt <= now && matchesFind(find, root, e))
  const starts = dayStarts(now, days)
  const values: (number | null)[] = []
  const states: DailyState[] = []
  let seen = 0
  for (let i = 0; i < days; i++) {
    const start = starts[i]!
    while (seen < matched.length && matched[seen]!.eventAt < starts[i + 1]!) seen++
    const history = matched.slice(0, seen)
    if (history.length === 0) {
      values.push(null)
      states.push('none')
      continue
    }
    const d = new Date(start * 1000)
    const from = back.span === 'week' ? new Date(d.getFullYear(), d.getMonth(), d.getDate() - 6).getTime() / 1000 : start
    const value = measureValue(back.measure, history.filter((e) => e.eventAt >= from), history, start)
    values.push(value)
    states.push(judge(back, value))
  }
  return { values, states }
}
