<script setup lang="ts">
import { useQuery } from '@tanstack/vue-query'
import { ChevronDown, Settings, X } from 'lucide-vue-next'
import type { CalendarDay } from 'server/review'
import { computed, nextTick, onMounted, onUnmounted, ref, watch } from 'vue'
import { api } from '../api.ts'
import { locale, t } from '../i18n/index.ts'
import { useSheetDrag } from '../sheetDrag.ts'
import { isDesktop } from '../viewport.ts'
import { dayKey } from '../time.ts'
import SleepAnalysis from '../plugins/sleep/SleepAnalysis.vue'
import DayEventsSheet from './DayEventsSheet.vue'
import RulesSheet from './RulesSheet.vue'

/** `sleep`: the card is half of the sleep pair, so the sheet opens on the rhythm analysis with the months beside it. */
const props = defineProps<{ cardId: string; sleep?: boolean }>()
const emit = defineEmits<{ close: [] }>()

const centered = isDesktop.value
const { sheet, sheetStyle, backdrop, animated, leave, isLeaveEnd, onTouchStart, onTouchMove, onTouchEnd } = useSheetDrag({
  onRequestClose: () => leave(),
  centered,
  onLeft: () => emit('close'),
  // The rhythm chart scrolls sideways; a pull starting on it stays a scroll.
  canDrag: (e) => selected.value === null && !(e.target as Element).closest('[data-hscroll]'),
})

const { data, isPending, isError } = useQuery({
  queryKey: computed(() => ['calendar', props.cardId]),
  queryFn: async () => {
    const res = await api.cards[':cardId'].calendar.$get({ param: { cardId: props.cardId } })
    if (!res.ok) throw new Error(`calendar: ${res.status}`)
    return res.json()
  },
})

const todayKey = dayKey(new Date())

// 2023-01-01 was a Sunday.
const weekdays = computed(() =>
  Array.from({ length: 7 }, (_, i) => new Intl.DateTimeFormat(locale.value, { weekday: 'narrow' }).format(new Date(2023, 0, 1 + i))),
)

interface Month {
  key: string
  label: string
  /** Empty cells before the 1st, so it lands under its weekday. */
  lead: number
  days: (CalendarDay & { day: number })[]
}

/** Oldest month first, like a photo library: scrolling up goes back in time. */
const months = computed<Month[]>(() => {
  const byMonth = new Map<string, Month>()
  const format = new Intl.DateTimeFormat(locale.value, { year: 'numeric', month: 'long' })
  for (const d of data.value?.days ?? []) {
    const key = d.date.slice(0, 7)
    let month = byMonth.get(key)
    if (!month) {
      const first = new Date(`${key}-01T00:00`)
      month = { key, label: format.format(first), lead: first.getDay(), days: [] }
      byMonth.set(key, month)
    }
    month.days.push({ ...d, day: Number(d.date.slice(8)) })
  }
  return [...byMonth.values()]
})

function show(value: CalendarDay['value']): string {
  if (value === null || value === false || value === 0) return ''
  if (value === true) return '✓'
  if (typeof value === 'number') return value.toFixed(data.value?.card.decimals ?? 0)
  return value
}

const showDelta = (d: number) => `${d > 0 ? '+' : d < 0 ? '−' : '±'}${Math.abs(d).toFixed(data.value?.card.decimals ?? 0)}`

const selected = ref<string | null>(null)
const editingRules = ref(false)
const tab = computed(() => (props.sleep ? 'analysis' : 'calendar'))

// The months open at the bottom, on this month, each time the tab is shown; later refetches leave the scroll alone.
const scroller = ref<HTMLElement | null>(null)
let anchored = false
watch(
  [tab, () => months.value.length],
  async ([current, count]) => {
    if (current !== 'calendar') return void (anchored = false)
    if (anchored || count === 0) return
    anchored = true
    await nextTick()
    if (scroller.value) scroller.value.scrollTop = scroller.value.scrollHeight
  },
  { immediate: true, flush: 'post' },
)

function onTransitionEnd(e: TransitionEvent) {
  if (isLeaveEnd(e)) emit('close')
}

function onKeydown(e: KeyboardEvent) {
  if (e.key === 'Escape' && selected.value === null && !editingRules.value) leave()
}
onMounted(() => window.addEventListener('keydown', onKeydown))
onUnmounted(() => window.removeEventListener('keydown', onKeydown))
</script>

<template>
  <Teleport to="body">
    <div class="fixed inset-0 z-50">
      <div class="absolute inset-0 bg-black" :class="{ 'sheet-animated': animated }" :style="{ opacity: backdrop }" @click="centered && leave()" />
      <section
        ref="sheet"
        :class="[centered ? (sleep ? 'center-dialog flex-col' : 'center-dialog narrow flex-col') : 'full-sheet', { 'sheet-animated': animated }]"
        :style="sheetStyle"
        @touchstart="onTouchStart"
        @touchmove="onTouchMove"
        @touchend="onTouchEnd"
        @touchcancel="onTouchEnd"
        @transitionend="onTransitionEnd"
      >
        <div v-if="!centered" class="mx-auto mt-2 h-1 w-10 shrink-0 rounded-full bg-zinc-300" />
        <header class="flex shrink-0 items-center gap-1 py-1 pr-1 pl-1">
          <button class="inline-flex h-11 w-11 items-center justify-center rounded-lg text-zinc-500" :aria-label="t('common.close')" @click="leave">
            <X v-if="centered" :size="22" /><ChevronDown v-else :size="24" />
          </button>
          <h2 v-if="data" class="flex-1 text-lg font-semibold">{{ data.card.emoji }} {{ data.card.name }}</h2>
          <button
            v-if="!sleep"
            class="ml-auto inline-flex h-11 w-11 items-center justify-center rounded-lg text-zinc-500"
            :aria-label="t('review.settings')"
            @click="editingRules = true"
          >
            <Settings :size="22" />
          </button>
        </header>

        <div ref="scroller" class="min-h-0 flex-1 overflow-y-auto overscroll-contain">
          <SleepAnalysis v-if="tab === 'analysis'" class="mx-auto max-w-2xl" />
          <p v-else-if="isPending" class="p-6 text-center text-zinc-400">{{ t('common.loading') }}</p>
          <p v-else-if="isError" class="p-6 text-center text-red-600">{{ t('common.loadFailed') }}</p>
          <div v-else class="mx-auto flex max-w-2xl flex-col gap-6 px-3 pt-2 pb-[calc(1rem+env(safe-area-inset-bottom))]">
            <section v-for="month in months" :key="month.key">
              <h3 class="mb-2 px-1 text-base font-semibold text-zinc-800">{{ month.label }}</h3>
              <div class="grid grid-cols-7 gap-1 pb-1 text-center text-xs text-zinc-400">
                <span v-for="(w, i) in weekdays" :key="i">{{ w }}</span>
              </div>
              <div class="grid grid-cols-7 gap-1">
                <span v-for="n in month.lead" :key="`lead-${n}`" />
                <button
                  v-for="d in month.days"
                  :key="d.date"
                  class="cell"
                  :class="[`s-${d.state}`, { today: d.date === todayKey }]"
                  @click="selected = d.date"
                >
                  <span class="text-[15px] leading-tight font-medium text-zinc-900 tabular-nums">{{ d.day }}</span>
                  <span class="value">{{ show(d.value) }}</span>
                  <span v-if="d.delta !== null" class="text-[10px] leading-none opacity-70">{{ showDelta(d.delta) }}</span>
                </button>
              </div>
            </section>
          </div>
        </div>
      </section>

      <RulesSheet v-if="editingRules" :card-id="cardId" @close="editingRules = false" />
      <DayEventsSheet v-if="selected && data" :card-id="cardId" :card-tag="data.card.name" :date="selected" @close="selected = null" />
    </div>
  </Teleport>
</template>

<style scoped>
.cell {
  display: flex;
  min-height: 52px;
  flex-direction: column;
  align-items: center;
  justify-content: center;
  gap: 1px;
  border-radius: 10px;
  color: #3f3f46;
}
.value {
  min-height: 14px;
  max-width: 100%;
  overflow: hidden;
  font-size: 12px;
  font-weight: 600;
  line-height: 14px;
  font-variant-numeric: tabular-nums;
  white-space: nowrap;
}
.s-good {
  background: #d1fae5;
  color: #065f46;
}
.s-logged {
  background: #e0e7ff;
  color: #3730a3;
}
.s-good-carry {
  border: 1.5px dashed #6ee7b7;
  color: #047857;
}
.s-warning,
.s-pending {
  background: #fde68a;
  color: #92400e;
}
.s-danger {
  background: #fecaca;
  color: #991b1b;
}
.today {
  box-shadow: inset 0 0 0 2px #4f46e5;
}
</style>
