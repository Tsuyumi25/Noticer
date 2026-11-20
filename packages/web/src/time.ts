import { locale, t, tn } from './i18n/index.ts'

export const MINUTE = 60_000
export const DAY = 86_400_000

export const floorMinute = (ms: number) => Math.floor(ms / MINUTE) * MINUTE

export function startOfDay(ms: number): number {
  const d = new Date(ms)
  return new Date(d.getFullYear(), d.getMonth(), d.getDate()).getTime()
}

/** A local calendar day as YYYY-MM-DD. */
export const dayKey = (date: Date) => date.toLocaleDateString('sv-SE')

const pad = (n: number) => String(n).padStart(2, '0')

export const clock = (ms: number) => {
  const d = new Date(ms)
  return `${pad(d.getHours())}:${pad(d.getMinutes())}`
}

export const weekday = (ms: number) => new Intl.DateTimeFormat(locale.value, { weekday: 'short' }).format(ms)

/** Month, day and weekday in the reader's language, with the year when asked. */
export const date = (ms: number, withYear = false) =>
  new Intl.DateTimeFormat(locale.value, {
    year: withYear ? 'numeric' : undefined,
    month: 'numeric',
    day: 'numeric',
    weekday: 'short',
  }).format(ms)

/** Today, yesterday, the day before, otherwise the date (with the year once it is a different year). */
export function dayName(ms: number, now: number): string {
  const days = Math.round((startOfDay(now) - startOfDay(ms)) / DAY)
  if (days === 0) return t('time.today')
  if (days === 1) return t('time.yesterday')
  if (days === 2) return t('time.dayBefore')
  return date(ms, new Date(ms).getFullYear() !== new Date(now).getFullYear())
}

export const absoluteTime = (ms: number, now: number) => `${dayName(ms, now)} ${clock(ms)}`

export function relativeTime(ms: number, now: number): string {
  let minutes = Math.round((now - ms) / MINUTE)
  if (minutes <= 0) return t('time.now')
  const days = Math.floor(minutes / 1440)
  minutes -= days * 1440
  const hours = Math.floor(minutes / 60)
  minutes -= hours * 60
  const parts = [
    days ? tn('time.days', days) : '',
    hours ? tn('time.hours', hours) : '',
    minutes && !days ? tn('time.minutes', minutes) : '',
  ].filter(Boolean)
  return t('time.ago', { span: parts.join(t('time.joiner')) })
}
