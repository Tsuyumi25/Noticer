import type { Measure, NowRule } from 'server/config'
import { locale, t, tn, type MessageKey } from '../../i18n/index.ts'
import type { RulesData } from './context.ts'

const D = 86400
const H = 3600

export const duration = (seconds: number) => (seconds % D === 0 ? tn('time.days', seconds / D) : tn('time.hours', Math.round((seconds / H) * 10) / 10))

export const elapsed = (seconds: number) =>
  seconds >= 2 * D ? tn('time.days', Number((seconds / D).toFixed(1))) : tn('time.hours', Number((seconds / H).toFixed(1)))

export const hour = (h: number) => `${String(h).padStart(2, '0')}:00`

export const clock = (seconds: number) =>
  new Intl.DateTimeFormat(locale.value, { month: 'numeric', day: 'numeric', hour: '2-digit', minute: '2-digit', hourCycle: 'h23' }).format(seconds * 1000)

export const statusWord = (status: string) => t(`rules.status.${status}` as MessageKey)

type Fact = RulesData['facts'][number]
const factOf = (facts: Fact[], measure: Measure) => ('fact' in measure ? facts.find((f) => f.key === measure.fact) : undefined)

export function measureLabel(measure: Measure, facts: Fact[]): string {
  const fact = factOf(facts, measure)?.name ?? ''
  return t(`rules.measure.${measure.kind}`, { fact })
}

export function amount(measure: Measure, facts: Fact[], n: number): string {
  if (measure.kind === 'times') return tn('rules.times', n)
  if (measure.kind === 'since') return tn('time.days', n)
  const fact = factOf(facts, measure)
  return `${fact ? n.toFixed(Math.min(fact.decimals, String(n).split('.')[1]?.length ?? 0)) : n} ${fact?.unit ?? ''}`.trim()
}

export function nowReason(now: NowRule, lastAt: number | null, at: number, status: string): string {
  if (now.kind === 'off') return t('rules.why.off')
  if (lastAt === null) return t('rules.why.none')
  const gap = at - lastAt
  const threshold = now.kind === 'soon' ? now.within : now.panic !== undefined && gap >= now.panic ? now.panic : now.after
  const reason = t(gap >= threshold ? 'rules.why.over' : 'rules.why.under', { d: duration(threshold) })
  return t('rules.why.now', { when: clock(lastAt), gap: elapsed(gap), reason, status: statusWord(status) })
}
