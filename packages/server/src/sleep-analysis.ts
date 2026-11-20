import { MAIN_SLEEP_HOURS, predictSleep, type SleepBlock } from './sleep.ts'

const TWO_PI = 2 * Math.PI

const SEARCH = { minPeriodHours: 23.5, maxPeriodHours: 26.5, frequencies: 500 }
const SIGNAL = { binSeconds: 600, minBlocks: 10, minBins: 100 }
const PHASE = { anchors: 5, minAnchors: 3, anchorGapHours: 12 }
/** The night a drifting rhythm is forecast to pass back through; the client draws the same band. */
const NORMAL_NIGHT = { from: 23, to: 7 }
const NIGHT_HOURS = (NORMAL_NIGHT.to - NORMAL_NIGHT.from + 24) % 24
const NORMAL = { centerHour: (NORMAL_NIGHT.from + NIGHT_HOURS / 2) % 24, nearHours: NIGHT_HOURS / 2, forecastDays: 60, pastDays: 7 }
const DAYTIME = { from: 8, to: 20 }

export interface AnalysisBlock {
  onset: number
  offset: number
  durationHours: number
  isMainSleep: boolean
}

export interface SleepRhythm {
  /** Dominant period in hours, or null when there is too little to fit. */
  tau: number | null
  peakPower: number | null
  /** Mean resultant length of the main onsets folded at tau; 1 = perfectly regular. */
  rayleighR: number | null
  driftMinPerDay: number | null
  /** Days for the rhythm to drift once around the clock; null unless it drifts later. */
  rotationDays: number | null
}

export interface SleepPhase {
  currentOnsetHour: number | null
  circularSD: number | null
  anchors: { date: string; time: string }[]
}

/** A stretch of days whose projected onset falls inside the normal window. */
export interface ForecastWindow {
  start: string
  end: string
  days: number
  isCurrent: boolean
  daysUntil: number | null
}

export interface SleepStats {
  totalSessions: number
  mainSleepCount: number
  fragmentCount: number
  fragmentPercent: number
  daytimeSleepCount: number
  daytimeSleepPercent: number
  avgDurationHours: number
  avgMainDurationHours: number
}

export interface SleepAnalysis {
  blocks: AnalysisBlock[]
  dateRange: { start: string; end: string } | null
  totalDays: number
  rhythm: SleepRhythm
  phase: SleepPhase
  forecast: ForecastWindow[]
  stats: SleepStats
  predictedSleepAt: number | null
  normalNight: { from: number; to: number }
}

export interface AnalysisOptions {
  /** Points on the period grid; 500 resolves to 0.006 h over the search range. */
  frequencies?: number
}

const mod24 = (hours: number) => ((hours % 24) + 24) % 24

const round = (value: number, digits: number) => {
  const scale = 10 ** digits
  return Math.round(value * scale) / scale
}

const dateKey = (d: Date) =>
  `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`

const midnightOf = (unixSeconds: number) => {
  const d = new Date(unixSeconds * 1000)
  return new Date(d.getFullYear(), d.getMonth(), d.getDate()).getTime() / 1000
}

/**
 * Σ cos(θ·i) and Σ sin(θ·i) over i in [from, to], by the Dirichlet kernel:
 * the sum of a run of equally spaced unit vectors is their midpoint direction
 * scaled by sin(n·θ/2) / sin(θ/2).
 */
function angleSum(theta: number, from: number, to: number): { cos: number; sin: number } {
  const half = theta / 2
  const scale = Math.sin((to - from + 1) * half) / Math.sin(half)
  const mid = (from + to) * half
  return { cos: scale * Math.cos(mid), sin: scale * Math.sin(mid) }
}

/**
 * Lomb-Scargle over the sleep/wake square wave sampled in 10 minute bins.
 *
 * The signal is 1 inside a block and 0 outside, so every per-bin sum collapses
 * to a closed form over the blocks: each frequency costs O(blocks), not O(bins).
 */
function lombScargle(blocks: AnalysisBlock[], frequencies: number): { tau: number; peakPower: number } | null {
  if (blocks.length < SIGNAL.minBlocks || frequencies < 2) return null

  const origin = blocks[0]!.onset
  const bins = Math.ceil((blocks[blocks.length - 1]!.offset - origin) / SIGNAL.binSeconds) + 1
  if (bins < SIGNAL.minBins) return null

  const spans: { from: number; to: number }[] = []
  for (const block of blocks) {
    const from = Math.max(0, Math.floor((block.onset - origin) / SIGNAL.binSeconds))
    const to = Math.min(bins - 1, Math.floor((block.offset - origin) / SIGNAL.binSeconds))
    const previous = spans[spans.length - 1]
    if (previous && from <= previous.to) previous.to = Math.max(previous.to, to)
    else spans.push({ from, to })
  }

  const asleepBins = spans.reduce((sum, s) => sum + (s.to - s.from + 1), 0)
  const mean = asleepBins / bins
  const variance = mean * (1 - mean)
  if (variance < 1e-10) return null

  const binHours = SIGNAL.binSeconds / 3600
  let bestPeriod = SEARCH.minPeriodHours
  let bestPower = 0

  for (let i = 0; i < frequencies; i++) {
    const period = SEARCH.minPeriodHours + (i / (frequencies - 1)) * (SEARCH.maxPeriodHours - SEARCH.minPeriodHours)
    const omega = TWO_PI / period
    const step = omega * binHours

    // Offset that orthogonalises the sine and cosine terms (Scargle 1982).
    const doubled = angleSum(2 * step, 0, bins - 1)
    const resultant = Math.hypot(doubled.cos, doubled.sin)
    const offset = Math.atan2(doubled.sin, doubled.cos) / (2 * omega)
    const cosSquares = (bins + resultant) / 2
    const sinSquares = (bins - resultant) / 2

    const all = angleSum(step, 0, bins - 1)
    let asleepCos = 0
    let asleepSin = 0
    for (const span of spans) {
      const sum = angleSum(step, span.from, span.to)
      asleepCos += sum.cos
      asleepSin += sum.sin
    }
    const projCos = asleepCos - mean * all.cos
    const projSin = asleepSin - mean * all.sin

    const cosOffset = Math.cos(omega * offset)
    const sinOffset = Math.sin(omega * offset)
    const cosTerm = cosOffset * projCos + sinOffset * projSin
    const sinTerm = cosOffset * projSin - sinOffset * projCos

    const power =
      ((cosTerm * cosTerm) / Math.max(cosSquares, 1e-10) / 2 + (sinTerm * sinTerm) / Math.max(sinSquares, 1e-10) / 2) /
      variance
    if (power > bestPower) {
      bestPower = power
      bestPeriod = period
    }
  }

  return { tau: round(bestPeriod, 3), peakPower: round(bestPower, 3) }
}

/** Mean direction and concentration of hour-of-day style angles folded at `period`. */
function circularMean(hours: number[], period: number): { meanHours: number; R: number } {
  if (hours.length === 0) return { meanHours: 0, R: 0 }
  let cosSum = 0
  let sinSum = 0
  for (const h of hours) {
    const angle = (TWO_PI * (h % period)) / period
    cosSum += Math.cos(angle)
    sinSum += Math.sin(angle)
  }
  const mc = cosSum / hours.length
  const ms = sinSum / hours.length
  let mean = Math.atan2(ms, mc)
  if (mean < 0) mean += TWO_PI
  return { meanHours: (mean / TWO_PI) * period, R: Math.hypot(mc, ms) }
}

/** The most recent onsets, skipping any that sit less than half a day after the one kept. */
function anchorBlocks(mainBlocks: AnalysisBlock[]): AnalysisBlock[] {
  const picked: AnalysisBlock[] = []
  for (let i = mainBlocks.length - 1; i >= 0 && picked.length < PHASE.anchors; i--) {
    const block = mainBlocks[i]!
    const kept = picked[picked.length - 1]
    if (!kept || (kept.onset - block.onset) / 3600 >= PHASE.anchorGapHours) picked.push(block)
  }
  picked.reverse()
  return picked.length >= PHASE.minAnchors ? picked : mainBlocks.slice(-PHASE.anchors)
}

function estimatePhase(mainBlocks: AnalysisBlock[], driftHours: number, now: number): SleepPhase {
  if (mainBlocks.length < PHASE.minAnchors) return { currentOnsetHour: null, circularSD: null, anchors: [] }

  const picked = anchorBlocks(mainBlocks)
  const projected: number[] = []
  const anchors: SleepPhase['anchors'] = []
  for (const block of picked) {
    const date = new Date(block.onset * 1000)
    projected.push(date.getHours() + date.getMinutes() / 60 + (driftHours * (now - block.onset)) / 86400)
    anchors.push({
      date: `${String(date.getMonth() + 1).padStart(2, '0')}/${String(date.getDate()).padStart(2, '0')}`,
      time: `${String(date.getHours()).padStart(2, '0')}:${String(date.getMinutes()).padStart(2, '0')}`,
    })
  }

  const { meanHours, R } = circularMean(projected, 24)
  return {
    currentOnsetHour: round(mod24(meanHours), 2),
    circularSD: round(R >= 1 ? 0 : (Math.sqrt(-2 * Math.log(R)) / TWO_PI) * 24, 1),
    anchors,
  }
}

/** Days whose projected onset lands within `NORMAL.nearHours` of the normal window centre. */
function forecastNormalPasses(currentOnsetHour: number, driftHours: number, now: number): ForecastWindow[] {
  const today = midnightOf(now)
  const elapsed = (now - today) / 86400

  const windows: ForecastWindow[] = []
  let start: number | null = null

  const close = (end: number, inclusive: boolean) => {
    const days = Math.round((end - start!) / 86400) + (inclusive ? 1 : 0)
    windows.push({
      start: dateKey(new Date(start! * 1000)),
      end: dateKey(new Date(end * 1000)),
      days,
      isCurrent: start! <= now && end > now,
      daysUntil: start! > now ? Math.round((start! - now) / 86400) : null,
    })
    start = null
  }

  for (let offset = -NORMAL.pastDays; offset <= NORMAL.forecastDays; offset++) {
    const at = today + offset * 86400
    const onset = mod24(currentOnsetHour + driftHours * (offset - elapsed))
    const distance = Math.abs(onset - NORMAL.centerHour)
    const near = Math.min(distance, 24 - distance) < NORMAL.nearHours
    if (near && start === null) start = at
    else if (!near && start !== null) close(at, false)
  }
  if (start !== null) close(today + NORMAL.forecastDays * 86400, true)

  return windows
}

function computeStats(blocks: AnalysisBlock[], mainBlocks: AnalysisBlock[]): SleepStats {
  const fragments = blocks.length - mainBlocks.length
  const daytime = blocks.filter((b) => {
    const hour = new Date(b.onset * 1000).getHours()
    return hour >= DAYTIME.from && hour < DAYTIME.to
  }).length
  const average = (list: AnalysisBlock[]) =>
    list.length === 0 ? 0 : round(list.reduce((sum, b) => sum + b.durationHours, 0) / list.length, 1)

  return {
    totalSessions: blocks.length,
    mainSleepCount: mainBlocks.length,
    fragmentCount: fragments,
    fragmentPercent: blocks.length === 0 ? 0 : Math.round((fragments / blocks.length) * 100),
    daytimeSleepCount: daytime,
    daytimeSleepPercent: blocks.length === 0 ? 0 : Math.round((daytime / blocks.length) * 100),
    avgDurationHours: average(blocks),
    avgMainDurationHours: average(mainBlocks),
  }
}

const emptyRhythm: SleepRhythm = { tau: null, peakPower: null, rayleighR: null, driftMinPerDay: null, rotationDays: null }

/**
 * Sleep rhythm over a run of paired sleep blocks: the dominant period, how far
 * it drifts each day, where the drifting onset sits now, and when it next
 * passes through a normal night. The blocks come back for the client's raster.
 */
export function analyzeSleep(blocks: SleepBlock[], now: number, options: AnalysisOptions = {}): SleepAnalysis {
  const sorted = [...blocks].sort((a, b) => a.onset - b.onset)
  const analysed: AnalysisBlock[] = sorted.map((b) => ({
    onset: b.onset,
    offset: b.offset,
    durationHours: round((b.offset - b.onset) / 3600, 2),
    isMainSleep: b.offset - b.onset >= MAIN_SLEEP_HOURS * 3600,
  }))
  const mainBlocks = analysed.filter((b) => b.isMainSleep)
  const stats = computeStats(analysed, mainBlocks)
  const predictedSleepAt = predictSleep(sorted, now)

  if (analysed.length === 0) {
    return {
      blocks: [],
      dateRange: null,
      totalDays: 0,
      rhythm: emptyRhythm,
      phase: { currentOnsetHour: null, circularSD: null, anchors: [] },
      forecast: [],
      stats,
      predictedSleepAt,
      normalNight: NORMAL_NIGHT,
    }
  }

  const first = midnightOf(analysed[0]!.onset)
  const last = midnightOf(analysed[analysed.length - 1]!.offset)
  const dateRange = { start: dateKey(new Date(first * 1000)), end: dateKey(new Date(last * 1000)) }
  const totalDays = Math.round((last - first) / 86400) + 1

  const peak = lombScargle(analysed, options.frequencies ?? SEARCH.frequencies)
  if (!peak) {
    return {
      blocks: analysed,
      dateRange,
      totalDays,
      rhythm: emptyRhythm,
      phase: { currentOnsetHour: null, circularSD: null, anchors: [] },
      forecast: [],
      stats,
      predictedSleepAt,
      normalNight: NORMAL_NIGHT,
    }
  }

  // Folded at tau over absolute hours, so a drifting rhythm still reads as regular.
  const base = (mainBlocks[0] ?? analysed[0]!).onset
  const { R } = circularMean(
    mainBlocks.map((b) => (b.onset - base) / 3600),
    peak.tau,
  )
  const driftHours = peak.tau - 24
  const phase = estimatePhase(mainBlocks, driftHours, now)

  return {
    blocks: analysed,
    dateRange,
    totalDays,
    rhythm: {
      tau: peak.tau,
      peakPower: peak.peakPower,
      rayleighR: round(R, 3),
      driftMinPerDay: round(driftHours * 60, 1),
      rotationDays: driftHours > 0 ? round(24 / driftHours, 1) : null,
    },
    phase,
    forecast: phase.currentOnsetHour === null ? [] : forecastNormalPasses(phase.currentOnsetHour, driftHours, now),
    stats,
    predictedSleepAt,
    normalNight: NORMAL_NIGHT,
  }
}
