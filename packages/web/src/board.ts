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

export const CELLS_PER_CARD = 8

export type Side = 'left' | 'center' | 'right'
export type Rect = { x: number; y: number; w: number; h: number }
export type Pin = { side: Side; fx: number; fy: number }
export type GridItem = { id: string; w: number; h: number; step: Step }

const share = (value: number, room: number) => (room > 0 ? value / room : 0)

export function pinRect(pin: Pin, w: number, h: number, cols: number, rows: number): Rect {
  const roomX = Math.max(0, cols - w)
  const roomY = Math.max(0, rows - h)
  const y = roomY - Math.round(pin.fy * roomY)
  if (pin.side === 'left') return { x: Math.round(pin.fx * roomX), y, w, h }
  if (pin.side === 'right') return { x: roomX - Math.round(pin.fx * roomX), y, w, h }
  return { x: Math.round(roomX / 2 + (pin.fx * roomX) / 2), y, w, h }
}

export function pinOf(rect: Rect, side: Side, cols: number, rows: number): Pin {
  const roomX = Math.max(0, cols - rect.w)
  const roomY = Math.max(0, rows - rect.h)
  const fy = share(roomY - rect.y, roomY)
  if (side === 'left') return { side, fx: share(rect.x, roomX), fy }
  if (side === 'right') return { side, fx: share(roomX - rect.x, roomX), fy }
  return { side, fx: share(rect.x - roomX / 2, roomX / 2), fy }
}

const overlaps = (a: Rect, b: Rect) => a.x < b.x + b.w && b.x < a.x + a.w && a.y < b.y + b.h && b.y < a.y + a.h

export function placeStack(
  items: GridItem[],
  pinned: Record<string, Rect>,
  { cols, rows, n, align }: { cols: number; rows: number; n: number; align: Side },
): Record<string, Rect> | null {
  const taken: Rect[] = []
  const out: Record<string, Rect> = {}
  const inside = (r: Rect) => r.x >= 0 && r.y >= 0 && r.x + r.w <= cols && r.y + r.h <= rows
  const free = (r: Rect) => inside(r) && !taken.some((t) => overlaps(t, r))
  for (const [id, rect] of Object.entries(pinned)) {
    if (!free(rect)) return null
    taken.push(rect)
    out[id] = rect
  }

  const auto = items.filter((it) => !(it.id in pinned))
  const urgent = auto.filter((it) => it.step > 0).length
  const counts = pyramidRows(auto.length, Math.floor(cols / n), Math.max(1, Math.floor(rows / n)), urgent)
  const piles: GridItem[][][] = [[], []]
  let next = 0
  for (const count of counts) {
    const row = auto.slice(next, (next += count))
    piles[row[0]!.step > 0 ? 0 : 1]!.push(row)
  }

  const starts = (width: number, preferred: number) =>
    Array.from({ length: Math.max(0, cols - width + 1) }, (_, x) => x).sort((a, b) => Math.abs(a - preferred) - Math.abs(b - preferred))
  const preferredStart = (width: number) => (align === 'left' ? 0 : align === 'right' ? cols - width : Math.round((cols - width) / 2))

  let floor = rows
  for (const pile of [piles[1]!, piles[0]!]) {
    const queue = pile.reverse()
    let carry: GridItem[] = []
    while (queue.length || carry.length) {
      const row = [...(queue.shift() ?? []), ...carry]
      carry = []
      const height = Math.max(...row.map((it) => it.h))
      if (floor - height < 0) return null
      const width = row.reduce((sum, it) => sum + it.w, 0)
      const at = (x0: number) => {
        let x = x0
        return row.map((it) => {
          const rect = { x, y: floor - it.h, w: it.w, h: it.h }
          x += it.w
          return rect
        })
      }
      const whole = starts(width, preferredStart(width))
        .map(at)
        .find((rects) => rects.every(free))
      if (whole) {
        whole.forEach((rect, i) => (taken.push(rect), (out[row[i]!.id] = rect)))
      } else {
        const planned = at(preferredStart(width))
        row.forEach((it, i) => {
          const spot = starts(it.w, planned[i]!.x)
            .map((x) => ({ x, y: floor - it.h, w: it.w, h: it.h }))
            .find(free)
          if (spot) {
            taken.push(spot)
            out[it.id] = spot
          } else carry.push(it)
        })
      }
      floor -= carry.length === row.length ? n : height
    }
  }
  return out
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
