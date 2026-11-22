import { describe, expect, it } from 'vitest'
import { arrangeStrip } from './strip.ts'

const strip = {
  values: [2, 3, 3, 0, 1, 1],
  states: ['good', 'good', 'good', 'danger', 'good', 'warning'] as const,
}
const texts = (groups: { text: string }[][]) => groups.map((g) => g.map((d) => d.text).join(','))

describe('arrangeStrip', () => {
  it('keeps today apart and joins only neighbouring days of the same colour, newest first when today is on the left', () => {
    const { today, groups } = arrangeStrip({ ...strip, states: [...strip.states] }, { look: 'blend', side: 'left' }, 6)
    expect(today).toMatchObject({ text: '1', state: 'warning' })
    expect(texts(groups)).toEqual(['1', '0', '3,3,2'])
  })

  it('runs oldest to newest when today is on the right', () => {
    const { groups } = arrangeStrip({ ...strip, states: [...strip.states] }, { look: 'thin', side: 'right' }, 6)
    expect(texts(groups)).toEqual(['2,3,3', '0', '1'])
  })

  it('never joins days in separate cells, even when they share a colour', () => {
    const { groups } = arrangeStrip({ ...strip, states: [...strip.states] }, { look: 'cells', side: 'left' }, 6)
    expect(texts(groups)).toEqual(['1', '0', '3', '3', '2'])
  })

  it('drops the oldest days first when fewer fit, and gives wider numbers more room', () => {
    const { today, groups } = arrangeStrip({ values: [5, 1800, null], states: ['good', 'good', 'none'] }, { look: 'cells', side: 'left' }, 2)
    expect(today.text).toBe('')
    expect(texts(groups)).toEqual(['1800'])
    expect(groups[0]![0]!.grow).toBeGreaterThan(today.grow)
  })
})
