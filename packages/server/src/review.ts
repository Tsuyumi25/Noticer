import type { CardConfig, Config, TrackerSource } from './config.ts'
import type { EventRecord, FactValue } from './events.ts'
import { evaluateStrip, matchesSource, type DailyState } from './trackers.ts'

/** The events a card reports on: its periodic tracker's, else its status tracker's, else everything tagged with the card. */
export function cardSource(config: Config, card: CardConfig): TrackerSource {
  const periodic = config.trackersPeriodic.find((t) => t.id === card.id)
  if (periodic) return periodic.source
  const status = card.trackerId ? config.trackersStatus.find((t) => t.id === card.trackerId) : undefined
  return status?.source ?? { tag: card.tag }
}

export interface CalendarDay {
  /** Local date, YYYY-MM-DD. */
  date: string
  value: FactValue | null
  /** Change from the previous day that had a value; only for number facts. */
  delta: number | null
  /** `logged` marks a day with events on a card that has no tracker to judge it. */
  state: DailyState | 'logged'
}

export interface CardCalendar {
  /** `decimals` is set when the days carry a number fact's value. */
  card: { id: string; name: string; emoji: string; decimals: number | null }
  /** Every day from the first of the month of the earliest event through today, oldest first. */
  days: CalendarDay[]
}

const dateKey = (d: Date) =>
  `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`

export function cardCalendar(config: Config, card: CardConfig, events: EventRecord[], now: number): CardCalendar {
  const source = cardSource(config, card)
  const matched = events.filter((e) => e.eventAt <= now && matchesSource(e, source))
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

  const periodic = config.trackersPeriodic.find((t) => t.id === card.id)
  const strip = periodic ? evaluateStrip(periodic, events, now, days) : null
  const inputs = (card.facts ?? []).map((key) => ({ key, input: config.factInputs[key]! }))
  const numberFact = inputs.find((i) => i.input.kind === 'number')
  const choiceFact = inputs.find((i) => i.input.kind === 'choice')
  const decimals = numberFact?.input.kind === 'number' ? numberFact.input.decimals : 0
  const lastFact = (list: EventRecord[], key: string) => [...list].reverse().find((e) => e.facts[key] !== undefined)?.facts[key]

  let previous: number | null = null
  return {
    card: { id: card.id, name: card.tag, emoji: card.emoji, decimals: !periodic && numberFact ? decimals : null },
    days: dates.map((date, i): CalendarDay => {
      const list = byDate.get(date) ?? []
      let value: FactValue | null = strip ? strip.values[i]! : list.length || null
      let state: CalendarDay['state'] = strip ? strip.states[i]! : list.length ? 'logged' : 'none'
      let delta: number | null = null
      if (!periodic && numberFact) {
        const v = lastFact(list, numberFact.key)
        value = typeof v === 'number' ? v : null
        if (typeof v === 'number') {
          delta = previous === null ? null : Number((v - previous).toFixed(decimals))
          previous = v
        }
      }
      const choice = choiceFact ? lastFact(list, choiceFact.key) : undefined
      if (choice !== undefined) {
        value = choice
        if (state === 'none') state = 'logged'
      }
      return { date, value, delta, state }
    }),
  }
}
