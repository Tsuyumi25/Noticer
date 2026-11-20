import type { CardConfig, Config } from './config.ts'
import type { EventRecord } from './events.ts'
import { evaluateDays, evaluateNow, type CardStatus, type DailyStrip, type NowResult } from './rules.ts'
import { evaluateSleep, SLEEP_CARD, WAKE_CARD, type SleepPair } from './sleep.ts'
import { cardRoot } from './tags.ts'

export interface CardModel {
  id: string
  name: string
  emoji: string
  status: CardStatus
  mode: NowResult['mode']
  progress: number
  nowHours: number | null
  maxHours: number | null
  strip: DailyStrip | null
}

export interface SleepCard extends SleepPair {
  sleepCard: { id: string; name: string; emoji: string }
  wakeCard: { id: string; name: string; emoji: string }
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
  return card.mode === 'soon' ? 1 / Math.max(ratio, 0.001) : ratio
}

export function cardModel(card: Pick<CardConfig, 'id' | 'tag' | 'bucket' | 'emoji' | 'rules'>, events: EventRecord[], now: number): CardModel {
  const root = cardRoot(card)
  const result = evaluateNow(card.rules, root, events, now)
  return {
    id: card.id,
    name: card.tag,
    emoji: card.emoji,
    status: result.status,
    mode: result.mode,
    progress: result.progress,
    nowHours: result.mode !== null && result.lastAt !== null ? (now - result.lastAt) / 3600 : null,
    maxHours: result.maxHours,
    strip: evaluateDays(card.rules, root, events, now),
  }
}

export function buildDashboard(config: Config, events: EventRecord[], now: number): Dashboard {
  const sleepCard = config.cards.find((c) => c.id === SLEEP_CARD)
  const wakeCard = config.cards.find((c) => c.id === WAKE_CARD)
  const hasSleep = sleepCard !== undefined && wakeCard !== undefined

  const cards = config.cards
    .filter((c) => !hasSleep || (c.id !== SLEEP_CARD && c.id !== WAKE_CARD))
    .map((card) => cardModel(card, events, now))
    .sort(
      (a, b) =>
        STATUS_PRIORITY[a.status] - STATUS_PRIORITY[b.status] || urgency(b) - urgency(a) || a.name.localeCompare(b.name),
    )

  return {
    now,
    sleep: hasSleep
      ? {
          ...evaluateSleep(events, now),
          sleepCard: { id: sleepCard.id, name: sleepCard.tag, emoji: sleepCard.emoji },
          wakeCard: { id: wakeCard.id, name: wakeCard.tag, emoji: wakeCard.emoji },
        }
      : null,
    urgent: cards.filter((c) => c.status === 'danger' || c.status === 'warning'),
    others: cards.filter((c) => c.status !== 'danger' && c.status !== 'warning'),
  }
}
