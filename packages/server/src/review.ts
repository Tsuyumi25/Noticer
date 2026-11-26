import { rootUnits, type CardConfig, type Config } from './config.ts'
import type { EventRecord, FactValue } from './events.ts'
import { backFind, evaluateDays, matchesFind, type DailyState } from './rules.ts'
import { valuesIn } from './values.ts'

export function reportCounts(card: CardConfig, event: EventRecord): boolean {
  return matchesFind(backFind(card.rules), card.root, event)
}

export interface CalendarDay {
  /** Local date, YYYY-MM-DD. */
  date: string
  value: FactValue | null
  /** Change from the previous day that had a value; only for numbers. */
  delta: number | null
  /** `logged` marks a day with events and no rule to judge them. */
  state: DailyState
}

export interface CardCalendar {
  /** `decimals` is set when the days carry a number. */
  card: { id: string; name: string; emoji: string; decimals: number | null }
  /** Every day from the first of the month of the earliest event through today, oldest first. */
  days: CalendarDay[]
}

const dateKey = (d: Date) =>
  `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`

const unitDecimals = (config: Config, card: CardConfig, unit: string) =>
  Math.max(0, ...Object.values(config.tagGroups[card.root]?.values ?? {}).filter((v) => v.unit === unit).map((v) => v.decimals))

function measuredDecimals(config: Config, card: CardConfig): number | null {
  const measure = card.rules.back?.measure
  return measure && 'unit' in measure ? unitDecimals(config, card, measure.unit) : null
}

/** An unjudged card that takes a number shows the last one recorded each day, such as a weight. */
function shownUnit(config: Config, card: CardConfig): string | null {
  return rootUnits(config, card.root)[0] ?? null
}

export function cardCalendar(config: Config, card: CardConfig, events: EventRecord[], now: number): CardCalendar {
  const matched = events.filter((e) => e.eventAt <= now && reportCounts(card, e))
  const today = new Date(now * 1000)
  const first = matched.length ? new Date(matched[0]!.eventAt * 1000) : today
  const start = new Date(first.getFullYear(), first.getMonth(), 1)
  const end = new Date(today.getFullYear(), today.getMonth(), today.getDate())
  const days = Math.round((end.getTime() - start.getTime()) / 86_400_000) + 1
  const dates = Array.from({ length: days }, (_, i) => dateKey(new Date(start.getFullYear(), start.getMonth(), start.getDate() + i)))

  const byDate = new Map<string, EventRecord[]>()
  for (const e of matched) {
    const key = dateKey(new Date(e.eventAt * 1000))
    byDate.set(key, [...(byDate.get(key) ?? []), e])
  }

  const judged = card.rules.back !== null
  const strip = evaluateDays(card.rules, card.root, events, now, days)
  const unit = judged ? null : shownUnit(config, card)
  const choiceFact = (card.facts ?? [])[0]
  const decimals = unit ? unitDecimals(config, card, unit) : 0
  const lastFact = (list: EventRecord[], key: string) => [...list].reverse().find((e) => e.facts[key] !== undefined)?.facts[key]
  const lastValue = (list: EventRecord[], u: string) => [...list].reverse().map((e) => valuesIn(e.facts, u)[0]).find((v) => v !== undefined)

  let previous: number | null = null
  return {
    card: { id: card.id, name: card.name, emoji: card.emoji, decimals: judged ? measuredDecimals(config, card) : unit ? decimals : null },
    days: dates.map((date, i): CalendarDay => {
      const list = byDate.get(date) ?? []
      let value: FactValue | null = strip ? strip.shown[i]! : list.length || null
      let state: CalendarDay['state'] = strip ? strip.states[i]! : list.length ? 'logged' : 'none'
      let delta: number | null = null
      if (unit) {
        const v = lastValue(list, unit)
        value = typeof v === 'number' ? v : null
        if (typeof v === 'number') {
          delta = previous === null ? null : Number((v - previous).toFixed(decimals))
          previous = v
        }
      }
      const choice = choiceFact ? lastFact(list, choiceFact) : undefined
      if (choice !== undefined) {
        value = choice
        if (state === 'none') state = 'logged'
      }
      return { date, value, delta, state }
    }),
  }
}
