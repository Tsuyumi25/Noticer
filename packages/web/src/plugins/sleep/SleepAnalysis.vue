<script setup lang="ts">
import { useQuery } from '@tanstack/vue-query'
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

/** Upper bounds in hours, shortest first; past the last one is the longest colour. */
const DURATION_COLORS: [number, string][] = [
  [3, '#c4b5fd'],
  [5, '#7dd3fc'],
  [7, '#2dd4bf'],
  [9, '#2563eb'],
  [Infinity, '#1e3a8a'],
]
const colorOf = (hours: number) => DURATION_COLORS.find(([upTo]) => hours < upTo)![1]

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

const startOfLocalDay = (seconds: number) => {
  const d = new Date(seconds * 1000)
  return new Date(d.getFullYear(), d.getMonth(), d.getDate()).getTime()
}
const shortDate = (ms: number) => new Intl.DateTimeFormat(locale.value, { month: 'numeric', day: 'numeric' }).format(ms)
const pad = (n: number) => String(n).padStart(2, '0')
const hhmm = (hour: number) => `${pad(Math.floor(hour) % 24)}:${pad(Math.round((hour % 1) * 60) % 60)}`
const one = (n: number) => (Math.round(n * 10) / 10).toFixed(1)

/** Each local day from the window's first to today, oldest first. */
const days = computed(() => {
  const today = startOfLocalDay(Date.now() / 1000)
  const first = data.value?.blocks[0] ? startOfLocalDay(data.value.blocks[0].onset) : today
  const list: number[] = []
  // Stepping by calendar date keeps daylight-saving days at their own length.
  for (let d = new Date(first); d.getTime() <= today; d.setDate(d.getDate() + 1)) list.push(d.getTime())
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
    const day = startOfLocalDay(b.onset)
    const start = (b.onset * 1000 - day) / 3_600_000
    const end = start + (b.offset - b.onset) / 3600
    const fill = colorOf(b.durationHours)
    put(day, start, Math.min(24, end), fill)
    if (end > 24) put(startOfLocalDay(b.offset), 0, end - 24, fill)
  }
  return out
})

/** The normal night as bands on the 00–24 axis; a night across midnight becomes two. */
const nightBands = computed(() => {
  const night = data.value?.normalNight
  if (!night) return []
  return night.from < night.to ? [[night.from, night.to]] : [[0, night.to], [night.from, 24]]
})

const dateLabels = computed(() => {
  const step = Math.max(1, Math.ceil(36 / slot.value))
  return days.value.flatMap((d, i) => (i % step ? [] : [{ x: i * slot.value + slot.value / 2, text: shortDate(d) }]))
})

// Open on the newest day, like the right edge of a calendar.
watch(
  [width, viewport],
  async () => {
    await nextTick()
    const el = viewport.value
    if (!el) return
    viewWidth.value = el.clientWidth
    el.scrollLeft = el.scrollWidth
  },
  { flush: 'post' },
)

const nextSleep = computed(() => {
  const a = summary.value
  if (!a) return null
  if (a.predictedSleepAt !== null) return clock(a.predictedSleepAt * 1000)
  return a.phase.currentOnsetHour === null ? null : hhmm(a.phase.currentOnsetHour)
})
const normal = computed(() => summary.value?.forecast.find((w) => w.isCurrent || w.daysUntil !== null) ?? null)
const day = (iso: string) => shortDate(new Date(`${iso}T00:00`).getTime())
const when = (w: { isCurrent: boolean; daysUntil: number | null }) => (w.isCurrent ? t('sleep.current') : t('sleep.daysLater', { n: w.daysUntil ?? 0 }))
const nightLabel = computed(() => {
  const n = data.value?.normalNight
  return n ? t('sleep.normalDays', { from: `${pad(n.from)}:00`, to: `${pad(n.to)}:00` }) : ''
})
</script>

<template>
  <p v-if="isPending" class="p-6 text-center text-zinc-400">{{ t('common.loading') }}</p>
  <p v-else-if="isError" class="p-6 text-center text-red-600">{{ t('common.loadFailed') }}</p>
  <div v-else-if="data" class="flex flex-col gap-4 px-3 pt-2 pb-[calc(1rem+env(safe-area-inset-bottom))]">
    <div>
      <div class="mb-2 flex flex-wrap gap-x-3 gap-y-1 px-1 text-xs text-zinc-500">
        <span v-for="([upTo, color], i) in DURATION_COLORS" :key="color" class="flex items-center gap-1">
          <i class="swatch" :style="{ background: color }" />
          {{ i === 0 ? `<${upTo}` : upTo === Infinity ? `>${DURATION_COLORS[i - 1]![0]}` : `${DURATION_COLORS[i - 1]![0]}–${upTo}` }}{{ t('unit.hour') }}
        </span>
      </div>
      <div class="chart" :style="{ height: `${PLOT_HEIGHT + DATE_ROW}px` }">
        <div ref="viewport" data-hscroll class="scroller" :style="{ right: `${AXIS_WIDTH}px` }">
          <svg :width="width" :height="PLOT_HEIGHT + DATE_ROW">
            <rect v-for="([from, to], i) in nightBands" :key="`n${i}`" x="0" :y="y(from)" :width="width" :height="y(to) - y(from)" fill="#dcfce7" />
            <line v-for="h in HOUR_LINES" :key="`h${h}`" x1="0" :x2="width" :y1="y(h)" :y2="y(h)" stroke="#e4e4e7" />
            <rect v-for="(b, i) in bars" :key="i" :x="b.x" :y="b.y" :width="b.w" :height="b.h" :fill="b.fill" rx="1" />
            <text v-for="l in dateLabels" :key="l.x" :x="l.x" :y="PLOT_HEIGHT + 12" font-size="9.5" fill="#a1a1aa" text-anchor="middle">{{ l.text }}</text>
          </svg>
        </div>
        <div class="axis" :style="{ width: `${AXIS_WIDTH}px`, height: `${PLOT_HEIGHT}px` }">
          <span v-for="h in HOUR_LINES" :key="h" :style="{ top: `${y(h)}px` }">{{ pad(h % 24) }}:00</span>
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
      <div v-if="normal" class="stat wide">
        <span class="label">{{ t('sleep.backToNormal') }}</span>
        <b>{{ day(normal.start) }}–{{ day(normal.end) }}<small>{{ when(normal) }}</small></b>
      </div>
    </div>

    <section v-if="summary?.forecast.length">
      <h3 class="mb-2 px-1 text-sm font-semibold text-zinc-700">{{ nightLabel }}</h3>
      <ul class="divide-y divide-zinc-100 rounded-xl border border-zinc-200 bg-white">
        <li v-for="w in summary.forecast" :key="w.start" class="flex min-h-11 items-center gap-2 px-3 text-sm">
          <span class="flex-1 tabular-nums">{{ day(w.start) }} – {{ day(w.end) }}</span>
          <span class="rounded-full bg-emerald-50 px-2 py-0.5 text-xs text-emerald-700">{{ w.days }}{{ t('unit.day') }}</span>
          <span class="w-16 text-right text-zinc-500">{{ when(w) }}</span>
        </li>
      </ul>
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
