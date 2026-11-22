import type { StripStyle } from 'server/config'
import type { DailyState, DailyStrip } from 'server/rules'

export type StripDay = { text: string; state: DailyState; grow: number }

export function arrangeStrip(strip: DailyStrip, style: Pick<StripStyle, 'look' | 'side'>, shown: number) {
  const days = strip.values
    .map((value, i) => ({ text: value === null ? '' : String(value), state: strip.states[i]! }))
    .slice(-shown)
    .reverse()
  const [first, ...past] = days
  const today: StripDay = { ...first!, grow: Math.max(1, first!.text.length) + 1.5 }
  const groups: StripDay[][] = []
  for (const day of style.side === 'left' ? past : past.reverse()) {
    const last = groups.at(-1)
    const item = { ...day, grow: Math.max(1, day.text.length) + 0.6 }
    if (last && style.look !== 'cells' && last[0]!.state === day.state) last.push(item)
    else groups.push([item])
  }
  return { today, groups }
}
