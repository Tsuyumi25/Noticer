import { describe, expect, it } from 'vitest'
import { fitScale, pinOf, pinRect, placeStack, pyramidRows, sizeStep, stepScale, type GridItem, type Rect } from './board.ts'

describe('pyramidRows', () => {
  it('puts every card in a row that never holds more than the row below it', () => {
    for (const count of [1, 2, 5, 17, 40]) {
      const rows = pyramidRows(count, 6, 99)
      expect(rows.reduce((a, b) => a + b, 0)).toBe(count)
      expect(rows.at(-1)).toBeLessThanOrEqual(6)
      rows.forEach((n, i) => expect(n).toBeLessThanOrEqual(rows[i + 1] ?? Infinity))
    }
  })

  it('narrows toward a tip when there is room, and flattens toward a grid when the height is short', () => {
    const tall = pyramidRows(17, 6, 99)
    expect(tall[0]).toBe(1)
    expect(tall.at(-1)).toBe(6)
    const short = pyramidRows(17, 6, 3)
    expect(short.length).toBe(3)
    expect(short.reduce((a, b) => a + b, 0)).toBe(17)
  })
})

describe('sizeStep', () => {
  it('grows danger past twice its limit most, then danger, then a warning, and nothing else', () => {
    expect(sizeStep('danger', 50, 24)).toBe(3)
    expect(sizeStep('danger', 30, 24)).toBe(2)
    expect(sizeStep('warning', 20, 24)).toBe(1)
    expect(sizeStep('good', 2, 24)).toBe(0)
    expect(sizeStep('unknown', null, null)).toBe(0)
  })

  it('reaches the chosen largest scale only at the top step', () => {
    expect(stepScale(0, 1.5)).toBe(1)
    expect(stepScale(3, 1.5)).toBe(1.5)
    expect(stepScale(1, 1.3)).toBeCloseTo(1.1)
  })
})

describe('placeStack', () => {
  const n = 3
  const card = (id: string, step: GridItem['step'] = 0): GridItem => {
    const span = Math.round(n * stepScale(step, 2))
    return { id, w: span, h: span, step }
  }
  const items = [card('u1', 3), card('u2', 2), card('u3', 1), ...Array.from({ length: 9 }, (_, i) => card(`c${i}`))]
  const overlap = (a: Rect, b: Rect) => a.x < b.x + b.w && b.x < a.x + a.w && a.y < b.y + b.h && b.y < a.y + a.h
  const sane = (out: Record<string, Rect>, cols: number, rows: number) => {
    const rects = Object.values(out)
    rects.forEach((r, i) => {
      expect(r.x >= 0 && r.y >= 0 && r.x + r.w <= cols && r.y + r.h <= rows).toBe(true)
      rects.slice(i + 1).forEach((o) => expect(overlap(r, o)).toBe(false))
    })
  }

  it('stacks every card on the floor, the calm ones below every urgent one', () => {
    const out = placeStack(items, {}, { cols: 30, rows: 30, n, align: 'center' })!
    sane(out, 30, 30)
    expect(Object.keys(out)).toHaveLength(items.length)
    expect(Math.max(...Object.values(out).map((r) => r.y + r.h))).toBe(30)
    const calmTop = Math.min(...items.filter((it) => it.step === 0).map((it) => out[it.id]!.y))
    for (const it of items.filter((it) => it.step > 0)) expect(out[it.id]!.y + out[it.id]!.h).toBeLessThanOrEqual(calmTop)
    expect(out.u1!.y).toBeLessThan(out.u3!.y)
  })

  it('slides the whole stack to the chosen side', () => {
    const left = placeStack(items, {}, { cols: 40, rows: 30, n, align: 'left' })!
    const right = placeStack(items, {}, { cols: 40, rows: 30, n, align: 'right' })!
    expect(Math.min(...Object.values(left).map((r) => r.x))).toBe(0)
    expect(Math.max(...Object.values(right).map((r) => r.x + r.w))).toBe(40)
  })

  it('keeps a pinned card exactly where it was put and lays the others around it', () => {
    const pin = { x: 12, y: 24, w: 6, h: 3 }
    const out = placeStack([{ id: 'sleep', w: 6, h: 3, step: 0 }, ...items], { sleep: pin }, { cols: 30, rows: 30, n, align: 'center' })!
    expect(out.sleep).toEqual(pin)
    sane(out, 30, 30)
    expect(Object.keys(out)).toHaveLength(items.length + 1)
  })

  it('gives up when the cards do not fit, or when pinned cards collide or fall off the grid', () => {
    expect(placeStack(items, {}, { cols: 9, rows: 6, n, align: 'center' })).toBeNull()
    const a = { x: 0, y: 0, w: 3, h: 3 }
    expect(placeStack(items, { c0: a, c1: { ...a, x: 2 } }, { cols: 30, rows: 30, n, align: 'center' })).toBeNull()
    expect(placeStack(items, { c0: { ...a, x: 28 } }, { cols: 30, rows: 30, n, align: 'center' })).toBeNull()
  })
})

describe('pins', () => {
  it('come back exactly where they were put on the same grid', () => {
    for (const side of ['left', 'center', 'right'] as const) {
      for (const rect of [{ x: 7, y: 20, w: 3, h: 3 }, { x: 0, y: 0, w: 6, h: 3 }, { x: 27, y: 27, w: 3, h: 3 }]) {
        expect(pinRect(pinOf(rect, side, 30, 30), rect.w, rect.h, 30, 30)).toEqual(rect)
      }
    }
  })

  it('keep their place on the board when the grid changes, so a card pinned at the top never forces the others to shrink', () => {
    const top = pinOf({ x: 0, y: 0, w: 6, h: 3 }, 'left', 30, 20)
    for (const [cols, rows] of [[12, 8], [30, 20], [60, 50]] as const) {
      const rect = pinRect(top, 6, 3, cols, rows)
      expect(rect).toMatchObject({ x: 0, y: 0 })
    }
    const corner = pinOf({ x: 27, y: 17, w: 3, h: 3 }, 'right', 30, 20)
    expect(pinRect(corner, 3, 3, 40, 26)).toEqual({ x: 37, y: 23, w: 3, h: 3 })
    const middle = pinRect(pinOf({ x: 12, y: 8, w: 6, h: 3 }, 'center', 30, 20), 6, 3, 60, 40)
    expect(middle.x).toBe(27)
  })
})

describe('fitScale', () => {
  it('keeps the chosen size when it fits, and gives up only as much of it as the height needs', () => {
    expect(fitScale(900, () => 600)).toBe(1)
    expect(fitScale(900, () => 600, 1.4)).toBe(1.4)
    expect(fitScale(900, () => 600, 1.6)).toBeCloseTo(1.5)
  })

  it('shrinks content until it fits, and a layout that gains columns as it shrinks needs less shrinking', () => {
    expect(fitScale(1000, () => 2000)).toBeCloseTo(0.5)
    const twentyCards = (scale: number) => Math.ceil(20 / Math.floor(4 / scale)) * 135
    const scale = fitScale(500, twentyCards)
    expect(twentyCards(scale) * scale).toBeLessThanOrEqual(500.5)
    expect(scale).toBeGreaterThan(500 / twentyCards(1))
  })
})
