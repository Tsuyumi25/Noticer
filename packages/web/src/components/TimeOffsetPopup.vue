<script setup lang="ts">
import { useQuery } from '@tanstack/vue-query'
import { RotateCcw } from 'lucide-vue-next'
import { computed, nextTick, onMounted, ref } from 'vue'
import { api } from '../api.ts'
import { dashboardQuery } from '../queries.ts'
import { t, tn } from '../i18n/index.ts'
import { absoluteTime, clock, DAY, date, dayName, floorMinute, MINUTE, relativeTime, startOfDay, weekday } from '../time.ts'

/** The picked time in ms, or null for "now". */
const props = defineProps<{ modelValue: number | null }>()
const emit = defineEmits<{ 'update:modelValue': [value: number | null]; close: [] }>()

const now = floorMinute(Date.now())
const draft = ref(props.modelValue ?? now)
const view = ref<'events' | 'input'>('events')

// ---------- events view ----------
const SLOT = 15 * MINUTE
const since = startOfDay(now) - 3 * DAY

const { data: dashboard } = useQuery(dashboardQuery)
const { data: events } = useQuery({
  queryKey: ['events', 'timeline', since],
  queryFn: async () => {
    const res = await api.events.$get({ query: { from: String(since / 1000), to: String(now / 1000 + 60) } })
    if (!res.ok) throw new Error(`events: ${res.status}`)
    return res.json()
  },
})

const cardNames = computed(() => {
  const d = dashboard.value
  const map = new Map<string, { name: string; emoji: string }>()
  if (!d) return map
  for (const c of [...d.urgent, ...d.others]) map.set(c.id, c)
  if (d.sleep) {
    map.set(d.sleep.sleepCard.id, d.sleep.sleepCard)
    map.set(d.sleep.wakeCard.id, d.sleep.wakeCard)
  }
  return map
})

const slots = computed(() => {
  const byslot = new Map<number, { at: number; label: string }[]>()
  for (const e of events.value ?? []) {
    const at = e.eventAt * 1000
    const key = Math.floor(at / SLOT) * SLOT
    const card = cardNames.value.get(e.cardId)
    byslot.set(key, [...(byslot.get(key) ?? []), { at, label: `${card?.emoji ?? '•'} ${card?.name ?? e.cardId} ${clock(at)}` }])
  }
  const rows: { at: number; day: string | null; hour: boolean; events: { at: number; label: string }[] }[] = []
  let lastDay = ''
  for (let at = Math.floor(now / SLOT) * SLOT; at >= since; at -= SLOT) {
    const name = dayName(at, now)
    const full = date(at)
    const day = name === full ? full : t('time.dayHeader', { name, date: full })
    rows.push({ at, day: day === lastDay ? null : day, hour: new Date(at).getMinutes() === 0, events: byslot.get(at) ?? [] })
    lastDay = day
  }
  return rows
})

const timeline = ref<HTMLElement | null>(null)
async function revealSelected(block: ScrollLogicalPosition = 'nearest') {
  await nextTick()
  timeline.value?.querySelector('.slot.selected')?.scrollIntoView({ block })
}

// ---------- input view ----------
const SEGMENTS = [
  { len: 4, min: 2000, max: 2100, unit: 'year', amount: 'time.years' },
  { len: 2, min: 1, max: 12, unit: 'month', amount: 'time.months' },
  { len: 2, min: 1, max: 31, unit: 'day', amount: 'time.days' },
  { len: 2, min: 0, max: 23, unit: 'hour', amount: 'time.hours' },
  { len: 2, min: 0, max: 59, unit: 'minute', amount: 'time.minutes' },
] as const
const HOUR = 3

const segment = ref(HOUR)
/** Digits typed into the focused segment as an absolute value; null when not typing. */
const typed = ref<string | null>(null)
/** A pending relative change of the focused segment, e.g. −3. */
const expr = ref<{ sign: 1 | -1; digits: string } | null>(null)

const parts = (ms: number) => {
  const d = new Date(ms)
  return [d.getFullYear(), d.getMonth() + 1, d.getDate(), d.getHours(), d.getMinutes()]
}
function fromParts([y, mo, d, h, mi]: number[]): number {
  const lastDay = new Date(y!, mo!, 0).getDate()
  return new Date(y!, mo! - 1, Math.min(d!, lastDay), h, mi).getTime()
}
/** Moves a time by n of a segment's unit; days, hours and minutes carry across midnight. */
function shift(ms: number, seg: number, n: number): number {
  if (seg >= 2) return ms + n * [0, 0, DAY, 60 * MINUTE, MINUTE][seg]!
  const p = parts(ms)
  if (seg === 0) p[0]! += n
  else {
    const months = p[0]! * 12 + p[1]! - 1 + n
    p[0] = Math.floor(months / 12)
    p[1] = (((months % 12) + 12) % 12) + 1
  }
  return fromParts(p)
}

const preview = computed(() => (expr.value?.digits ? shift(draft.value, segment.value, expr.value.sign * Number(expr.value.digits)) : draft.value))

function commit() {
  if (expr.value) {
    draft.value = preview.value
    expr.value = null
  }
  if (typed.value) {
    const { min, max } = SEGMENTS[segment.value]!
    const p = parts(draft.value)
    p[segment.value] = Math.min(max, Math.max(min, Number(typed.value)))
    draft.value = fromParts(p)
  }
  typed.value = null
}

function focus(seg: number) {
  commit()
  segment.value = Math.min(SEGMENTS.length - 1, Math.max(0, seg))
}

function digit(d: string) {
  if (expr.value) {
    if (expr.value.digits.length < 4) expr.value.digits += d
    return
  }
  const { len, max } = SEGMENTS[segment.value]!
  typed.value = (typed.value ?? '') + d
  // Done once the segment is full, or when no further digit could still fit (3 in the month field means 03).
  if (typed.value.length >= len || (len === 2 && Number(typed.value) * 10 > max)) {
    commit()
    if (segment.value < SEGMENTS.length - 1) segment.value++
  }
}

function sign(s: 1 | -1) {
  if (expr.value && !expr.value.digits) {
    expr.value.sign = s
    return
  }
  commit()
  expr.value = { sign: s, digits: '' }
}

function segmentText(i: number, value: number): string {
  if (i === segment.value && expr.value) return `${expr.value.sign < 0 ? '−' : '+'}${expr.value.digits || '_'}`
  if (i === segment.value && typed.value !== null) return typed.value.padEnd(SEGMENTS[i]!.len, '_')
  return i === 0 ? String(value) : String(value).padStart(2, '0')
}

// ---------- shared ----------
function setDraft(ms: number) {
  commit()
  draft.value = ms
  if (view.value === 'events') revealSelected()
}

function switchView(v: 'events' | 'input') {
  commit()
  view.value = v
  if (v === 'input') segment.value = HOUR
  else revealSelected('center')
}

function done() {
  commit()
  emit('update:modelValue', draft.value >= now ? null : draft.value)
  emit('close')
}

const hint = computed(() => {
  const e = expr.value
  if (!e) return ''
  const seg = SEGMENTS[segment.value]!
  if (!e.digits) return t(e.sign < 0 ? 'time.askEarlier' : 'time.askLater', { unit: t(`time.unit.${seg.unit}`) })
  return t(e.sign < 0 ? 'time.hintEarlier' : 'time.hintLater', { amount: tn(seg.amount, Number(e.digits)) })
})

onMounted(() => revealSelected('center'))
</script>

<template>
  <Teleport to="body">
    <div class="popup">
      <header class="flex h-12 shrink-0 items-center justify-between pr-2 pl-4">
        <h2 class="text-[17px] font-semibold">{{ t('time.title') }}</h2>
        <div class="switch">
          <button :class="{ on: view === 'events' }" @click="switchView('events')">{{ t('time.events') }}</button>
          <button :class="{ on: view === 'input' }" @click="switchView('input')">{{ t('time.input') }}</button>
        </div>
      </header>

      <div class="grid shrink-0 grid-cols-[64px_1fr_64px] items-center px-2 pb-3">
        <button
          class="flex h-11 flex-col items-center justify-center text-xs text-zinc-500 disabled:opacity-30"
          :disabled="preview === now && !expr"
          :aria-label="t('time.backToNow')"
          @click="setDraft(now)"
        >
          <RotateCcw :size="16" />{{ t('time.now') }}
        </button>
        <div class="text-center">
          <div class="text-[28px] leading-tight font-bold">{{ relativeTime(preview, now) }}</div>
          <div class="text-[15px] text-zinc-500">{{ absoluteTime(preview, now) }}</div>
          <div v-if="hint" class="text-[13px] text-indigo-700">{{ hint }}</div>
          <div v-if="preview > now" class="text-[13px] text-red-600">{{ t('time.future') }}</div>
        </div>
      </div>

      <div class="grid shrink-0 grid-cols-4 gap-2 px-4 pb-3">
        <button v-for="m in [-5, -1, 1, 5]" :key="m" class="fine" @click="setDraft(draft + m * MINUTE)">
          {{ m < 0 ? '−' : '+' }}{{ t('time.fine', { n: Math.abs(m) }) }}
        </button>
      </div>

      <div v-if="view === 'events'" ref="timeline" class="min-h-0 flex-1 overflow-y-auto overscroll-contain px-4">
        <template v-for="s in slots" :key="s.at">
          <div v-if="s.day" class="day">{{ s.day }}</div>
          <div class="slot" :class="{ hour: s.hour, selected: draft >= s.at && draft < s.at + SLOT }" @click="setDraft(s.at)">
            <span class="w-11 shrink-0 text-xs tabular-nums">{{ clock(s.at) }}</span>
            <button v-for="e in s.events" :key="e.at" class="event" @click.stop="setDraft(e.at)">{{ e.label }}</button>
          </div>
        </template>
      </div>

      <div v-else class="flex min-h-0 flex-1 flex-col justify-end gap-3 overflow-y-auto px-4 pb-3">
        <div class="flex items-center justify-center tabular-nums">
          <template v-for="(value, i) in parts(draft)" :key="i">
            <button
              class="segment"
              :class="{ on: i === segment && !expr, relative: i === segment && expr }"
              @click="focus(i)"
            >
              {{ segmentText(i, value) }}
            </button>
            <span v-if="i < 2" class="px-px text-xl text-zinc-400">/</span>
            <span v-else-if="i === 2" class="px-1.5 text-xs text-zinc-400">{{ weekday(draft) }}</span>
            <span v-else-if="i === 3" class="px-px text-xl text-zinc-400">:</span>
          </template>
        </div>
        <div class="keys">
          <button v-for="n in [1, 2, 3]" :key="n" @click="digit(String(n))">{{ n }}</button>
          <button class="op" @click="sign(-1)">−</button>
          <button v-for="n in [4, 5, 6]" :key="n" @click="digit(String(n))">{{ n }}</button>
          <button class="op" @click="sign(1)">＋</button>
          <button v-for="n in [7, 8, 9]" :key="n" @click="digit(String(n))">{{ n }}</button>
          <button class="eq" @click="commit()">＝</button>
          <button class="op" :aria-label="t('time.prevUnit')" @click="focus(segment - 1)">←</button>
          <button @click="digit('0')">0</button>
          <button class="op" :aria-label="t('time.nextUnit')" @click="focus(segment + 1)">→</button>
        </div>
      </div>

      <footer class="grid shrink-0 grid-cols-2 gap-3 border-t border-zinc-200 px-4 pt-3 pb-[calc(0.75rem+env(safe-area-inset-bottom))]">
        <button class="h-12 rounded-xl bg-zinc-100 font-semibold" @click="emit('close')">{{ t('common.cancel') }}</button>
        <button class="h-12 rounded-xl bg-indigo-600 font-semibold text-white" @click="done">{{ t('common.done') }}</button>
      </footer>
    </div>
  </Teleport>
</template>

<style scoped>
.popup {
  position: fixed;
  inset: 0;
  z-index: 60;
  display: flex;
  flex-direction: column;
  padding-top: env(safe-area-inset-top);
  background: white;
}
.switch {
  display: grid;
  grid-template-columns: 1fr 1fr;
  padding: 3px;
  border-radius: 10px;
  background: #f4f4f5;
}
.switch button {
  position: relative;
  min-width: 52px;
  height: 34px;
  border-radius: 8px;
  color: #6b7280;
  font-size: 14px;
}
.switch button::after {
  content: '';
  position: absolute;
  inset: -5px 0;
}
.switch button.on {
  background: white;
  color: #111827;
  font-weight: 600;
  box-shadow: 0 1px 3px rgb(0 0 0 / 0.1);
}
.fine {
  height: 44px;
  border: 1px solid #e5e7eb;
  border-radius: 10px;
  background: #f8fafc;
  font-size: 15px;
}
.day {
  position: sticky;
  top: 0;
  z-index: 1;
  padding: 8px 0 4px;
  border-bottom: 1px solid #f1f5f9;
  background: white;
  color: #374151;
  font-size: 13px;
  font-weight: 600;
}
.slot {
  display: flex;
  align-items: center;
  gap: 8px;
  min-height: 40px;
  cursor: pointer;
  padding: 2px 4px;
  border-bottom: 1px dashed #f1f5f9;
  color: #9ca3af;
}
.slot.hour {
  color: #374151;
  font-weight: 600;
}
.slot.selected {
  border-radius: 8px;
  background: #eef2ff;
  color: #4338ca;
  font-weight: 700;
}
.event {
  min-height: 34px;
  padding: 0 10px;
  border: 1px solid #fed7aa;
  border-radius: 999px;
  background: #fff7ed;
  color: #9a3412;
  font-size: 13px;
  font-weight: 400;
}
.segment {
  min-width: 40px;
  height: 48px;
  padding: 0 3px;
  border-radius: 8px;
  color: #111827;
  font-size: 22px;
  font-weight: 700;
}
.segment.on {
  background: #eef2ff;
  color: #4338ca;
}
.segment.relative {
  background: #fef3c7;
  color: #92400e;
}
.keys {
  display: grid;
  grid-template-columns: repeat(4, 1fr);
  grid-auto-rows: clamp(44px, 6.5dvh, 56px);
  gap: 8px;
}
.keys button {
  border-radius: 12px;
  background: #f4f4f5;
  font-size: 22px;
}
.keys .op {
  background: #e0e7ff;
  color: #3730a3;
}
.keys .eq {
  grid-row: span 2;
  background: #4f46e5;
  color: white;
  font-size: 26px;
}
</style>
