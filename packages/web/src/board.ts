export function pyramidRows(count: number, perRow: number, maxRows: number, apart = 0): number[] {
  const piles = apart > 0 && apart < count ? [count - apart, apart] : [count]
  let rows: number[] = []
  for (let taper = 0.8; ; taper = Math.min(1, taper + 0.05)) {
    rows = []
    let width = Math.max(1, perRow)
    for (const pile of piles) {
      for (let rest = pile; rest > 0; width *= taper) {
        const n = Math.min(rest, Math.max(1, Math.floor(width)))
        rows.push(n)
        rest -= n
      }
    }
    if (rows.length <= maxRows || taper >= 1) break
  }
  return rows.reverse()
}

export type Step = 0 | 1 | 2 | 3

export function sizeStep(status: string, nowHours: number | null, maxHours: number | null): Step {
  if (status === 'danger') return nowHours !== null && maxHours ? (nowHours / maxHours >= 2 ? 3 : 2) : 2
  return status === 'warning' ? 1 : 0
}

export const stepScale = (step: Step, maxScale: number) => 1 + (step / 3) * (maxScale - 1)

export function fillRows(widths: number[], counts: number[], room: number, gap: number, breakAt = -1): number[] {
  const rows: number[] = []
  let next = 0
  const take = (cap: number) => {
    let n = 0
    let used = 0
    while (next + n < widths.length && n < cap) {
      const add = widths[next + n]! + (n ? gap : 0)
      if (n > 0 && (used + add > room + 0.5 || next + n === breakAt)) break
      used += add
      n++
    }
    next += n
    if (n) rows.push(n)
  }
  for (const cap of counts) take(cap)
  while (next < widths.length) take(Infinity)
  return rows
}

export function fitScale(available: number, contentHeight: (scale: number) => number, preferred = 1): number {
  const fits = (scale: number) => contentHeight(scale) * scale <= available + 0.5
  if (fits(preferred)) return preferred
  let low = 0
  let high = preferred
  for (let i = 0; i < 20; i++) {
    const mid = (low + high) / 2
    if (fits(mid)) low = mid
    else high = mid
  }
  return low
}
