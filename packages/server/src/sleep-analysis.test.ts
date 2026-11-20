import { describe, expect, it } from 'vitest'
import { createApp } from './app.ts'
import { emptyConfig, memoryStore } from './config.ts'
import { openDb } from './db.ts'
import { analyzeSleep } from './sleep-analysis.ts'

const H = 3600
const first = new Date(2026, 0, 1, 23, 30).getTime() / 1000

/** `period` hours from one onset to the next, `asleep` hours in bed. */
const schedule = (nights: number, period: number, asleep = 8) =>
  Array.from({ length: nights }, (_, i) => ({
    onset: Math.round(first + i * period * H),
    offset: Math.round(first + i * period * H + asleep * H),
  }))

describe('analyzeSleep', () => {
  it('recovers the period, drift and current phase of a free-running schedule', () => {
    const blocks = schedule(40, 25)
    const last = blocks[blocks.length - 1]!
    const now = last.offset + 4 * H
    const { rhythm, phase } = analyzeSleep(blocks, now)

    expect(rhythm.tau).toBeCloseTo(25, 1)
    expect(rhythm.driftMinPerDay).toBeCloseTo(60, -1)
    expect(rhythm.rotationDays).toBeCloseTo(24, -1)
    expect(rhythm.rayleighR).toBeGreaterThan(0.9)

    // The phase estimate should land on the clock hour of the next onset the schedule is heading for.
    const next = new Date((last.onset + 25 * H) * 1000)
    expect(phase.currentOnsetHour).toBeCloseTo(next.getHours() + next.getMinutes() / 60, 0)
    expect(phase.anchors).toHaveLength(5)
  })

  it('passes a free-running rhythm through the normal window once per rotation', () => {
    const { rhythm, forecast } = analyzeSleep(schedule(40, 25), first + 40 * 25 * H)
    const starts = forecast.map((w) => new Date(w.start).getTime() / 86_400_000)
    expect(starts.length).toBeGreaterThan(1)
    expect(starts[1]! - starts[0]!).toBeCloseTo(rhythm.rotationDays!, -1)
  })

  it('reads an entrained schedule as a 24 hour period that does not drift', () => {
    const { rhythm } = analyzeSleep(schedule(40, 24), first + 40 * 24 * H)
    expect(rhythm.tau).toBeCloseTo(24, 1)
    expect(Math.abs(rhythm.driftMinPerDay!)).toBeLessThan(1)
  })

  it('reports the blocks but no rhythm when there is too little to fit', () => {
    const blocks = schedule(5, 25)
    const analysis = analyzeSleep(blocks, first + 5 * 25 * H)
    expect(analysis.rhythm).toEqual({ tau: null, peakPower: null, rayleighR: null, driftMinPerDay: null, rotationDays: null })
    expect(analysis.phase).toEqual({ currentOnsetHour: null, circularSD: null, anchors: [] })
    expect(analysis.forecast).toEqual([])
    expect(analysis.blocks).toHaveLength(5)
    expect(analysis.stats).toMatchObject({ totalSessions: 5, mainSleepCount: 5, fragmentCount: 0 })
  })

  it('has nothing to report without blocks', () => {
    const analysis = analyzeSleep([], first)
    expect(analysis).toMatchObject({ blocks: [], dateRange: null, totalDays: 0, predictedSleepAt: null })
    expect(analysis.stats.totalSessions).toBe(0)
  })
})

describe('GET /api/sleep/analysis', () => {
  const app = createApp(openDb(':memory:'), memoryStore(emptyConfig))

  it('accepts windows of 30 to 730 days and refuses the rest', async () => {
    expect((await app.request('/api/sleep/analysis?days=30')).status).toBe(200)
    expect((await app.request('/api/sleep/analysis?days=29')).status).toBe(400)
    expect((await app.request('/api/sleep/analysis?days=731')).status).toBe(400)
    expect((await app.request('/api/sleep/analysis?days=week')).status).toBe(400)
  })
})
