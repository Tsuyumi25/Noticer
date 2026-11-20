import type { Measure, NowRule } from 'server/config'
import { locale, t, tn, type MessageKey } from '../../i18n/index.ts'
import type { RulesData } from './context.ts'

const D = 86400
const H = 3600

/** Whole or half days read as days; anything else as hours. */
export const duration = (seconds: number) =>
  seconds >= D && seconds % (D / 2) === 0 ? tn('time.days', seconds / D) : tn('time.hours', Math.round((seconds / H) * 10) / 10)

export const elapsed = (seconds: number) =>
  seconds >= 2 * D ? tn('time.days', Number((seconds / D).toFixed(1))) : tn('time.hours', Number((seconds / H).toFixed(1)))

export const hour = (h: number) => `${String(h).padStart(2, '0')}:00`

export const clock = (seconds: number) =>
  new Intl.DateTimeFormat(locale.value, { month: 'numeric', day: 'numeric', hour: '2-digit', minute: '2-digit', hourCycle: 'h23' }).format(seconds * 1000)

export const statusWord = (status: string) => t(`rules.status.${status}` as MessageKey)

type Unit = RulesData['units'][number]

export function measureLabel(measure: Measure): string {
  return t(`rules.measure.${measure.kind}`, { fact: 'unit' in measure ? measure.unit : '' })
}

export function amount(measure: Measure, units: Unit[], n: number): string {
  if (measure.kind === 'times') return tn('rules.times', n)
  if (measure.kind === 'since') return tn('time.days', n)
  const unit = units.find((u) => u.unit === measure.unit)
  return `${unit ? n.toFixed(Math.min(unit.decimals, String(n).split('.')[1]?.length ?? 0)) : n} ${measure.unit}`
}

export function nowReason(now: NowRule, lastAt: number | null, at: number, status: string): string {
  const marks = [now.soon, now.late?.warn, now.late?.danger].filter((m) => m !== undefined)
  if (!marks.length) return t('rules.why.off')
  if (lastAt === null) return t('rules.why.none')
  const gap = at - lastAt
  const passed = marks.findLast((m) => gap >= m)
  const reason = passed === undefined ? t('rules.why.under', { d: duration(marks[0]!) }) : t('rules.why.over', { d: duration(passed) })
  return t('rules.why.now', { when: clock(lastAt), gap: elapsed(gap), reason, status: t(`rules.state.${status}` as MessageKey) })
}
