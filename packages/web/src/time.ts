export const MINUTE = 60_000
export const DAY = 86_400_000

const WEEKDAYS = ['日', '一', '二', '三', '四', '五', '六']

export const floorMinute = (ms: number) => Math.floor(ms / MINUTE) * MINUTE

export function startOfDay(ms: number): number {
  const d = new Date(ms)
  return new Date(d.getFullYear(), d.getMonth(), d.getDate()).getTime()
}

const pad = (n: number) => String(n).padStart(2, '0')

export const clock = (ms: number) => {
  const d = new Date(ms)
  return `${pad(d.getHours())}:${pad(d.getMinutes())}`
}

export const weekday = (ms: number) => WEEKDAYS[new Date(ms).getDay()]!

/** 今天／昨天／前天, otherwise the date (with the year once it is a different year). */
export function dayName(ms: number, now: number): string {
  const days = Math.round((startOfDay(now) - startOfDay(ms)) / DAY)
  if (days === 0) return '今天'
  if (days === 1) return '昨天'
  if (days === 2) return '前天'
  const d = new Date(ms)
  const year = d.getFullYear() === new Date(now).getFullYear() ? '' : `${d.getFullYear()}/`
  return `${year}${d.getMonth() + 1}/${d.getDate()}（${weekday(ms)}）`
}

export const absoluteTime = (ms: number, now: number) => `${dayName(ms, now)} ${clock(ms)}`

export function relativeTime(ms: number, now: number): string {
  let minutes = Math.round((now - ms) / MINUTE)
  if (minutes <= 0) return '現在'
  const days = Math.floor(minutes / 1440)
  minutes -= days * 1440
  const hours = Math.floor(minutes / 60)
  minutes -= hours * 60
  return `${days ? `${days}天` : ''}${hours ? `${hours}小時` : ''}${minutes && !days ? `${minutes}分鐘` : ''}前`
}
