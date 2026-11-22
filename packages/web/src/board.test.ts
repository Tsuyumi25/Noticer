import { describe, expect, it } from 'vitest'
import { fillRows, fitScale, pyramidRows, sizeStep, stepScale } from './board.ts'

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

describe('fillRows', () => {
  const widths = [250, 250, 230, ...Array.from({ length: 14 }, () => 186), 382]

  it('keeps the pyramid counts while the rows fit, so the biggest cards stay at the tip', () => {
    const counts = pyramidRows(widths.length, 6, 99)
    expect(fillRows(widths, counts, 1400, 10)).toEqual(counts)
  })

  it('moves cards down instead of letting a row run past the width, keeping their order', () => {
    const rows = fillRows(widths, [1, 2, 3, 12], 700, 10)
    let next = 0
    for (const n of rows) {
      const row = widths.slice(next, (next += n))
      expect(row.length === 1 || row.reduce((a, b) => a + b, 0) + (row.length - 1) * 10 <= 700.5).toBe(true)
    }
    expect(next).toBe(widths.length)
    expect(rows.slice(0, 2)).toEqual([1, 2])
  })
})

describe('two piles', () => {
  const starts = (rows: number[]) => rows.reduce<number[]>((acc, n) => [...acc, (acc.at(-1) ?? 0) + n], [])

  it('never puts an urgent card in the same row as a calm one', () => {
    for (const urgent of [1, 4, 7, 11]) {
      const rows = pyramidRows(18, 6, 99, urgent)
      expect(starts(rows)).toContain(urgent)
      expect(rows.reduce((a, b) => a + b, 0)).toBe(18)
    }
  })

  it('keeps the piles apart even when a crowded urgent row pushes a card down', () => {
    const widths = [400, 400, 400, 186, 186, 186, 186, 186]
    const rows = fillRows(widths, [2, 3, 3], 900, 10, 3)
    expect(starts(rows)).toContain(3)
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
