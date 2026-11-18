import type { Config } from './config.ts'
import type { EventRecord } from './events.ts'
import { evaluateSleep, SLEEP_CARD, WAKE_CARD, type SleepPair } from './sleep.ts'
import { evaluateStatus, evaluateStrip, type CardStatus, type DailyStrip } from './trackers.ts'

export interface CardModel {
  id: string
  name: string
  emoji: string
  status: CardStatus
  mode: 'deadline' | 'cooldown' | null
  progress: number
  nowHours: number | null
  maxHours: number | null
  summary: string
  strip: DailyStrip | null
}

export interface SleepCard extends SleepPair {
  sleepCard: { name: string; emoji: string }
  wakeCard: { name: string; emoji: string }
}

export interface Dashboard {
  now: number
  sleep: SleepCard | null
  urgent: CardModel[]
  others: CardModel[]
}

const STATUS_PRIORITY: Record<CardStatus, number> = { danger: 1, warning: 2, pending: 3, good: 4, unknown: 5 }

function urgency(card: CardModel): number {
  if (card.nowHours == null || card.maxHours == null || card.maxHours <= 0) return -1
  const ratio = card.nowHours / card.maxHours
  return card.mode === 'cooldown' ? 1 / Math.max(ratio, 0.001) : ratio
}

export function buildDashboard(config: Config, events: EventRecord[], now: number): Dashboard {
  const status = new Map(config.trackersStatus.map((t) => [t.id, t]))
  const periodic = new Map(config.trackersPeriodic.map((t) => [t.id, t]))
  const sleepCard = config.cards.find((c) => c.id === SLEEP_CARD)
  const wakeCard = config.cards.find((c) => c.id === WAKE_CARD)
  const hasSleep = sleepCard !== undefined && wakeCard !== undefined

  const cards = config.cards
    .filter((c) => !hasSleep || (c.id !== SLEEP_CARD && c.id !== WAKE_CARD))
    .map((card): CardModel => {
      const tracker = card.trackerId ? status.get(card.trackerId) : undefined
      const result = tracker ? evaluateStatus(tracker, events, now) : null
      const strip = periodic.get(card.id)
      return {
        id: card.id,
        name: card.tag,
        emoji: card.emoji,
        status: result?.status ?? 'unknown',
        mode: tracker?.type ?? null,
        progress: result?.progress ?? 0,
        nowHours: result?.lastAt != null ? (now - result.lastAt) / 3600 : null,
        maxHours: result?.maxHours ?? null,
        summary: result && result.lastAt === null ? '無記錄' : '距今',
        strip: strip ? evaluateStrip(strip, events, now) : null,
      }
    })
    .sort(
      (a, b) =>
        STATUS_PRIORITY[a.status] - STATUS_PRIORITY[b.status] || urgency(b) - urgency(a) || a.name.localeCompare(b.name),
    )

  return {
    now,
    sleep: hasSleep
      ? {
          ...evaluateSleep(events, now),
          sleepCard: { name: sleepCard.tag, emoji: sleepCard.emoji },
          wakeCard: { name: wakeCard.tag, emoji: wakeCard.emoji },
        }
      : null,
    urgent: cards.filter((c) => c.status === 'danger' || c.status === 'warning'),
    others: cards.filter((c) => c.status !== 'danger' && c.status !== 'warning'),
  }
}
