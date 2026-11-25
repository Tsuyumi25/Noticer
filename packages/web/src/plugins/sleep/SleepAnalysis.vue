<script setup lang="ts">
import { useQuery } from '@tanstack/vue-query'
import { ChevronLeft, ChevronRight } from 'lucide-vue-next'
import { computed, nextTick, ref, watch } from 'vue'
import { api } from '../../api.ts'
import { locale, t } from '../../i18n/index.ts'
import { clock } from '../../time.ts'

/** The chart always spans everything; the range only picks how far back the summary is computed. */
const ALL_DAYS = 730
const RANGES = [
  { key: '1M', days: 30 },
  { key: '3M', days: 90 },
  { key: '6M', days: 180 },
  { key: 'all', days: ALL_DAYS },
] as const
type RangeKey = (typeof RANGES)[number]['key']

const PLOT_HEIGHT = 240
const DATE_ROW = 16
const AXIS_WIDTH = 44
const DAYS_PER_SCREEN = 31
const HOUR_LINES = [0, 4, 8, 12, 16, 20, 24]
/** Each column runs from this hour to the same hour next day, so a night's sleep stays in one piece. */
const CUT_HOUR = 18

/** Upper bounds in hours, shortest first; past the last one is the longest colour. */
const DURATION_COLORS: [number, string][] = [
  [3, '#c4b5fd'],
  [5, '#7dd3fc'],
  [7, '#2dd4bf'],
  [9, '#2563eb'],
  [Infinity, '#1e3a8a'],
]
const colorOf = (hours: number) => DURATION_COLORS.find(([upTo]) => hours < upTo)![1]

/** Enough, some, short: the plainer three-way read of how long a sleep was. */
const LENGTH_COLORS: [number, string][] = [
  [5, '#e24b4a'],
  [7, '#ef9f27'],
  [Infinity, '#1d9e75'],
]
const lengthColorOf = (hours: number) => LENGTH_COLORS.find(([upTo]) => hours < upTo)![1]

/** Sky colour by clock hour: night blue, sunrise orange, noon yellow, sunset orange. */
const SKY: [number, string][] = [
  [0, '#0b1a33'],
  [4, '#133058'],
  [5.5, '#1e3d6a'],
  [6, '#c06030'],
  [7, '#e0a050'],
  [9, '#e8c840'],
  [12, '#f0d830'],
  [15, '#e8c840'],
  [17, '#e0a050'],
  [18, '#c06030'],
  [18.5, '#8b3a2a'],
  [20, '#1e3d6a'],
  [22, '#133058'],
]

/** The same chart, coloured by how long each sleep was in five steps, by the time of day it covers, or in three steps. */
const COLOR_MODES = ['analysis', 'sky', 'duration'] as const
type ColorMode = (typeof COLOR_MODES)[number]
const colorMode = ref<ColorMode>('analysis')
const legend = computed(() => (colorMode.value === 'duration' ? LENGTH_COLORS : DURATION_COLORS))
const modeLabel = (mode: ColorMode) => t(mode === 'analysis' ? 'sleep.analysis' : mode === 'sky' ? 'sleep.sky' : 'sleep.duration')

const rangeKey = ref<RangeKey>('1M')
const range = computed(() => RANGES.find((r) => r.key === rangeKey.value)!)

const analysisOver = (days: number) => ({
  queryKey: ['sleepAnalysis', days],
  queryFn: async () => {
    const res = await api.sleep.analysis.$get({ query: { days: String(days) } })
    if (!res.ok) throw new Error(`sleep analysis: ${res.status}`)
    return res.json()
  },
})
const { data, isPending, isError } = useQuery(analysisOver(ALL_DAYS))
const { data: summary } = useQuery(computed(() => ({ ...analysisOver(range.value.days), placeholderData: (previous: typeof data.value) => previous })))

/** Where the column holding this moment starts, in ms. */
const columnOf = (seconds: number) => {
  const d = new Date((seconds - CUT_HOUR * 3600) * 1000)
  return new Date(d.getFullYear(), d.getMonth(), d.getDate(), CUT_HOUR).getTime()
}
const nextDay = (ms: number) => {
  const d = new Date(ms)
  return new Date(d.getFullYear(), d.getMonth(), d.getDate() + 1, d.getHours()).getTime()
}
const shortDate = (ms: number) => new Intl.DateTimeFormat(locale.value, { month: 'numeric', day: 'numeric' }).format(ms)
const pad = (n: number) => String(n).padStart(2, '0')
const hhmm = (hour: number) => `${pad(Math.floor(hour) % 24)}:${pad(Math.round((hour % 1) * 60) % 60)}`
const one = (n: number) => (Math.round(n * 10) / 10).toFixed(1)

/** Each column from the window's first to the one holding now, oldest first. */
const days = computed(() => {
  const current = columnOf(Date.now() / 1000)
  const first = data.value?.blocks[0] ? columnOf(data.value.blocks[0].onset) : current
  const list: number[] = []
  // Stepping by calendar date keeps daylight-saving days at their own length.
  for (let d = first; d <= current; d = nextDay(d)) list.push(d)
  return list
})

const viewport = ref<HTMLElement | null>(null)
const viewWidth = ref(330)
const slot = computed(() => viewWidth.value / DAYS_PER_SCREEN)
const width = computed(() => Math.max(viewWidth.value, days.value.length * slot.value))
const y = (hour: number) => (hour / 24) * PLOT_HEIGHT

const bars = computed(() => {
  const index = new Map(days.value.map((d, i) => [d, i]))
  const barWidth = Math.max(1.5, slot.value * 0.72)
  const out: { x: number; y: number; w: number; h: number; fill: string }[] = []
  const put = (day: number, from: number, to: number, fill: string) => {
    const i = index.get(day)
    if (i === undefined || to <= from) return
    out.push({ x: i * slot.value + (slot.value - barWidth) / 2, y: y(from), w: barWidth, h: Math.max(1.5, y(to) - y(from)), fill })
  }
  for (const b of data.value?.blocks ?? []) {
    const column = columnOf(b.onset)
    const start = (b.onset * 1000 - column) / 3_600_000
    const end = start + (b.offset - b.onset) / 3600
    const fill = colorMode.value === 'sky' ? 'url(#sleep-sky)' : colorMode.value === 'duration' ? lengthColorOf(b.durationHours) : colorOf(b.durationHours)
    put(column, start, Math.min(24, end), fill)
    if (end > 24) put(nextDay(column), 0, end - 24, fill)
  }
  return out
})

/** The sky laid down the column's axis, which starts at the cut. */
const skyStops = (() => {
  const atCut = SKY.find(([h]) => h === CUT_HOUR)![1]
  const shifted = SKY.map(([h, color]) => [(h - CUT_HOUR + 24) % 24, color] as const)
    .filter(([h]) => h > 0)
    .sort((a, b) => a[0] - b[0])
  return [[0, atCut] as const, ...shifted, [24, atCut] as const].map(([h, color]) => ({ offset: `${((h / 24) * 100).toFixed(2)}%`, color }))
})()

/** The normal night as bands on the column's axis; one that wraps past the cut becomes two. */
const nightBands = computed(() => {
  const night = data.value?.normalNight
  if (!night) return []
  const from = (night.from - CUT_HOUR + 24) % 24
  const to = (night.to - CUT_HOUR + 24) % 24
  return from < to ? [[from, to]] : [[0, to], [from, 24]]
})

// A column is labelled with the day it wakes into, which holds most of its hours.
const dateLabels = computed(() => {
  const step = Math.max(1, Math.ceil(36 / slot.value))
  return days.value.flatMap((d, i) => (i % step ? [] : [{ x: i * slot.value + slot.value / 2, text: shortDate(nextDay(d)) }]))
})

watch(
  viewport,
  (el, _, onCleanup) => {
    if (!el) return
    const observer = new ResizeObserver(() => (viewWidth.value = el.clientWidth))
    observer.observe(el)
    onCleanup(() => observer.disconnect())
  },
  { flush: 'post' },
)

// Open on the newest day, like the right edge of a calendar.
watch(
  [width, viewport],
  async () => {
    await nextTick()
    const el = viewport.value
    if (el) el.scrollLeft = el.scrollWidth
  },
  { flush: 'post' },
)

const grab = ref<{ x: number; left: number } | null>(null)
function startGrab(e: PointerEvent) {
  if (e.pointerType !== 'mouse' || e.button !== 0 || !viewport.value) return
  viewport.value.setPointerCapture(e.pointerId)
  grab.value = { x: e.clientX, left: viewport.value.scrollLeft }
}
function moveGrab(e: PointerEvent) {
  if (grab.value && viewport.value) viewport.value.scrollLeft = grab.value.left - (e.clientX - grab.value.x)
}
const endGrab = () => (grab.value = null)

const nextSleep = computed(() => {
  const a = summary.value
  if (!a) return null
  if (a.predictedSleepAt !== null) return clock(a.predictedSleepAt * 1000)
  return a.phase.currentOnsetHour === null ? null : hhmm(a.phase.currentOnsetHour)
})
const localDate = (iso: string) => new Date(`${iso}T00:00`)
const addDays = (d: Date, n: number) => new Date(d.getFullYear(), d.getMonth(), d.getDate() + n)

/** Each window as its first and last night; `days` counts them, so a window still open at the horizon keeps its end. */
const windows = computed(() =>
  (summary.value?.forecast ?? []).map((w) => {
    const first = localDate(w.start)
    return { ...w, first, last: addDays(first, w.days - 1) }
  }),
)
const upcoming = computed(() => windows.value.find((w) => w.isCurrent || w.daysUntil !== null) ?? null)
const when = (w: { isCurrent: boolean; daysUntil: number | null }) => (w.isCurrent ? t('sleep.current') : t('sleep.daysLater', { n: w.daysUntil ?? 0 }))

// 2023-01-01 was a Sunday, matching the month report beside this tab.
const weekdays = computed(() =>
  Array.from({ length: 7 }, (_, i) => new Intl.DateTimeFormat(locale.value, { weekday: 'narrow' }).format(new Date(2023, 0, 1 + i))),
)

/** From this month through the last forecast night, each day marked by whether it falls inside a window. */
const forecastMonths = computed(() => {
  const now = new Date()
  const today = new Date(now.getFullYear(), now.getMonth(), now.getDate())
  const last = windows.value.reduce((latest, w) => (w.last > latest ? w.last : latest), today)
  const nightOf = new Map<number, { first: boolean; last: boolean }>()
  for (const w of windows.value) {
    for (let d = w.first; d <= w.last; d = addDays(d, 1)) {
      nightOf.set(d.getTime(), { first: d.getTime() === w.first.getTime(), last: d.getTime() === w.last.getTime() })
    }
  }
  const format = new Intl.DateTimeFormat(locale.value, { year: 'numeric', month: 'long' })
  const months = []
  for (let m = new Date(today.getFullYear(), today.getMonth(), 1); m <= last; m = new Date(m.getFullYear(), m.getMonth() + 1, 1)) {
    const length = new Date(m.getFullYear(), m.getMonth() + 1, 0).getDate()
    const days = Array.from({ length }, (_, i) => {
      const date = new Date(m.getFullYear(), m.getMonth(), i + 1)
      const night = nightOf.get(date.getTime())
      const weekday = date.getDay()
      return {
        n: i + 1,
        past: date < today,
        today: date.getTime() === today.getTime(),
        night: !!night,
        roundStart: !!night && (night.first || weekday === 0),
        roundEnd: !!night && (night.last || weekday === 6),
      }
    })
    months.push({ key: m.getTime(), label: format.format(m), lead: m.getDay(), days })
  }
  return months
})

const monthPager = ref<HTMLElement | null>(null)
const monthIndex = ref(0)
const onMonthScroll = () => {
  const el = monthPager.value
  if (el) monthIndex.value = Math.round(el.scrollLeft / el.clientWidth)
}
const showMonth = (i: number) => monthPager.value?.scrollTo({ left: i * monthPager.value.clientWidth, behavior: 'smooth' })
const nightLabel = computed(() => {
  const n = data.value?.normalNight
  return n ? t('sleep.normalDays', { from: `${pad(n.from)}:00`, to: `${pad(n.to)}:00` }) : ''
})
</script>

<template>
  <p v-if="isPending" class="p-6 text-center text-zinc-400">{{ t('common.loading') }}</p>
  <p v-else-if="isError" class="p-6 text-center text-red-600">{{ t('common.loadFailed') }}</p>
  <div v-else-if="data" class="flex flex-col gap-4 px-3 pt-2 pb-[calc(1rem+env(safe-area-inset-bottom))]">
    <div class="tabs">
      <button v-for="mode in COLOR_MODES" :key="mode" :class="{ on: colorMode === mode }" @click="colorMode = mode">{{ modeLabel(mode) }}</button>
    </div>

    <div>
      <div class="mb-2 flex min-h-4 flex-wrap gap-x-3 gap-y-1 px-1 text-xs text-zinc-500">
        <template v-if="colorMode !== 'sky'">
          <span v-for="([upTo, color], i) in legend" :key="color" class="flex items-center gap-1">
            <i class="swatch" :style="{ background: color }" />
            {{ i === 0 ? `<${upTo}` : upTo === Infinity ? `≥${legend[i - 1]![0]}` : `${legend[i - 1]![0]}–${upTo}` }}{{ t('unit.hour') }}
          </span>
        </template>
      </div>
      <div class="chart" :style="{ height: `${PLOT_HEIGHT + DATE_ROW}px` }">
        <div
          ref="viewport"
          data-hscroll
          class="scroller"
          :class="{ grabbing: grab }"
          :style="{ right: `${AXIS_WIDTH}px` }"
          @pointerdown="startGrab"
          @pointermove="moveGrab"
          @pointerup="endGrab"
          @pointercancel="endGrab"
        >
          <svg :width="width" :height="PLOT_HEIGHT + DATE_ROW">
            <defs>
              <linearGradient id="sleep-sky" gradientUnits="userSpaceOnUse" x1="0" x2="0" y1="0" :y2="PLOT_HEIGHT">
                <stop v-for="s in skyStops" :key="s.offset" :offset="s.offset" :stop-color="s.color" />
              </linearGradient>
            </defs>
            <rect v-for="([from, to], i) in nightBands" :key="`n${i}`" x="0" :y="y(from)" :width="width" :height="y(to) - y(from)" fill="#dcfce7" />
            <line v-for="h in HOUR_LINES" :key="`h${h}`" x1="0" :x2="width" :y1="y(h)" :y2="y(h)" stroke="#e4e4e7" />
            <rect v-for="(b, i) in bars" :key="i" :x="b.x" :y="b.y" :width="b.w" :height="b.h" :fill="b.fill" rx="1" />
            <text v-for="l in dateLabels" :key="l.x" :x="l.x" :y="PLOT_HEIGHT + 12" font-size="9.5" fill="#a1a1aa" text-anchor="middle">{{ l.text }}</text>
          </svg>
        </div>
        <div class="axis" :style="{ width: `${AXIS_WIDTH}px`, height: `${PLOT_HEIGHT}px` }">
          <span v-for="h in HOUR_LINES" :key="h" :style="{ top: `${y(h)}px` }">{{ pad((CUT_HOUR + h) % 24) }}:00</span>
        </div>
      </div>
    </div>

    <div class="tabs">
      <button v-for="r in RANGES" :key="r.key" :class="{ on: rangeKey === r.key }" @click="rangeKey = r.key">
        {{ r.key === 'all' ? t('sleep.all') : r.key }}
      </button>
    </div>

    <div v-if="summary" class="grid grid-cols-2 gap-2">
      <template v-if="summary.rhythm.tau !== null">
        <div class="stat">
          <span class="label">{{ t('sleep.tau') }}</span><b>{{ summary.rhythm.tau.toFixed(2) }}<small>{{ t('unit.hour') }}</small></b>
        </div>
        <div class="stat">
          <span class="label">{{ t('sleep.drift') }}</span>
          <b>{{ summary.rhythm.driftMinPerDay! > 0 ? '+' : '' }}{{ one(summary.rhythm.driftMinPerDay!) }}<small>{{ t('unit.minute') }}</small></b>
        </div>
        <div v-if="summary.rhythm.rotationDays !== null" class="stat">
          <span class="label">{{ t('sleep.rotation') }}</span><b>{{ one(summary.rhythm.rotationDays) }}<small>{{ t('unit.day') }}</small></b>
        </div>
        <div class="stat">
          <span class="label">{{ t('sleep.regularity') }}</span><b>{{ summary.rhythm.rayleighR!.toFixed(2) }}</b>
        </div>
      </template>
      <div v-if="nextSleep" class="stat wide">
        <span class="label">{{ t('sleep.next') }}</span><b>{{ nextSleep }}</b>
      </div>
    </div>

    <section v-if="windows.length" class="rounded-xl border border-zinc-200 bg-white px-2 pt-3 pb-2">
      <header class="mb-2 flex items-baseline justify-between gap-2 px-1">
        <h3 class="text-sm font-semibold text-zinc-700">{{ nightLabel }}</h3>
        <span v-if="upcoming" class="text-sm whitespace-nowrap text-emerald-700 tabular-nums">
          {{ shortDate(upcoming.first.getTime()) }}–{{ shortDate(upcoming.last.getTime()) }} · {{ when(upcoming) }}
        </span>
      </header>
      <div class="flex items-center justify-between">
        <button class="month-nav" :aria-label="t('journal.prevMonth')" :disabled="monthIndex === 0" @click="showMonth(monthIndex - 1)">
          <ChevronLeft :size="20" />
        </button>
        <h4 class="text-sm font-semibold text-zinc-600">{{ forecastMonths[monthIndex]?.label }}</h4>
        <button
          class="month-nav"
          :aria-label="t('journal.nextMonth')"
          :disabled="monthIndex >= forecastMonths.length - 1"
          @click="showMonth(monthIndex + 1)"
        >
          <ChevronRight :size="20" />
        </button>
      </div>
      <div class="grid grid-cols-7 text-center text-[11px] text-zinc-400">
        <span v-for="(w, i) in weekdays" :key="i">{{ w }}</span>
      </div>
      <div ref="monthPager" data-hscroll class="month-pager" @scroll.passive="onMonthScroll">
        <div v-for="month in forecastMonths" :key="month.key" class="month grid grid-cols-7 content-start gap-y-1">
          <span v-for="n in month.lead" :key="`lead-${n}`" />
          <span
            v-for="d in month.days"
            :key="d.n"
            class="night-cell"
            :class="{ past: d.past, night: d.night, 'round-start': d.roundStart, 'round-end': d.roundEnd, today: d.today }"
          >
            {{ d.n }}
          </span>
        </div>
      </div>
    </section>
  </div>
</template>

<style scoped>
.stat {
  display: flex;
  flex-direction: column;
  gap: 2px;
  padding: 8px 10px;
  border: 1px solid #e4e4e7;
  border-radius: 12px;
  background: white;
}
.stat.wide {
  grid-column: span 2;
}
.label {
  font-size: 12px;
  color: #71717a;
}
.stat b {
  font: 700 18px ui-monospace, 'SF Mono', Menlo, monospace;
  color: #18181b;
}
.stat small {
  margin-left: 4px;
  font: 500 12px system-ui, sans-serif;
  color: #71717a;
}
.tabs {
  display: grid;
  grid-auto-columns: 1fr;
  grid-auto-flow: column;
  gap: 4px;
  padding: 3px;
  border-radius: 12px;
  background: #f4f4f5;
}
.tabs button {
  min-height: 40px;
  border-radius: 9px;
  color: #52525b;
  font-size: 14px;
  font-weight: 500;
}
.tabs button.on {
  background: white;
  color: #18181b;
  font-weight: 600;
  box-shadow: 0 1px 3px rgb(0 0 0 / 0.1);
}
.month-pager {
  display: flex;
  overflow-x: auto;
  scroll-snap-type: x mandatory;
  overscroll-behavior-x: contain;
  scrollbar-width: none;
}
.month {
  flex: 0 0 100%;
  scroll-snap-align: start;
}
.month-nav {
  display: inline-flex;
  width: 44px;
  height: 44px;
  align-items: center;
  justify-content: center;
  border-radius: 10px;
  color: #71717a;
}
.month-nav:disabled {
  opacity: 0.25;
}
.night-cell {
  display: flex;
  height: 36px;
  align-items: center;
  justify-content: center;
  color: #3f3f46;
  font: 500 13px ui-monospace, 'SF Mono', Menlo, monospace;
}
.night-cell.past {
  color: #a1a1aa;
}
.night-cell.night {
  background: #bbf7d0;
  color: #065f46;
}
.night-cell.round-start {
  border-top-left-radius: 10px;
  border-bottom-left-radius: 10px;
}
.night-cell.round-end {
  border-top-right-radius: 10px;
  border-bottom-right-radius: 10px;
}
.night-cell.today {
  box-shadow: inset 0 0 0 2px #4f46e5;
  border-radius: 10px;
}
.swatch {
  display: inline-block;
  width: 10px;
  height: 10px;
  border-radius: 3px;
}
.chart {
  position: relative;
}
.scroller {
  position: absolute;
  inset: 0;
  overflow-x: auto;
  overflow-y: hidden;
  overscroll-behavior-x: contain;
  scrollbar-width: none;
}
@media (pointer: fine) {
  .scroller {
    cursor: grab;
    user-select: none;
  }
  .scroller.grabbing {
    cursor: grabbing;
  }
}
.axis {
  position: absolute;
  top: 0;
  right: 0;
}
.axis span {
  position: absolute;
  right: 0;
  transform: translateY(-50%);
  font: 10px ui-monospace, 'SF Mono', Menlo, monospace;
  color: #a1a1aa;
}
</style>
