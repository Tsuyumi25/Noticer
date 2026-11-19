<script setup lang="ts">
import { useQuery } from '@tanstack/vue-query'
import { ChevronLeft } from 'lucide-vue-next'
import type { CalendarDay } from 'server/review'
import { computed, ref } from 'vue'
import { useRoute, useRouter } from 'vue-router'
import { api } from '../../api.ts'
import DayEventsSheet from '../../components/DayEventsSheet.vue'
import { locale, t } from '../../i18n/index.ts'

const route = useRoute('/cards/[id]')
const router = useRouter()
const cardId = computed(() => route.params.id)

const { data, isPending, isError } = useQuery({
  queryKey: computed(() => ['calendar', cardId.value]),
  queryFn: async () => {
    const res = await api.cards[':cardId'].calendar.$get({ param: { cardId: cardId.value } })
    if (!res.ok) throw new Error(`calendar: ${res.status}`)
    return res.json()
  },
})

const todayKey = new Date().toLocaleDateString('sv-SE')

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

/** Newest month first: scrolling down goes back in time. */
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
  return [...byMonth.values()].reverse()
})

function show(value: CalendarDay['value']): string {
  if (value === null || value === false || value === 0) return ''
  if (value === true) return '✓'
  if (typeof value === 'number') return value.toFixed(data.value?.card.decimals ?? 0)
  return value
}

const showDelta = (d: number) => `${d > 0 ? '+' : d < 0 ? '−' : '±'}${Math.abs(d).toFixed(data.value?.card.decimals ?? 0)}`

const selected = ref<string | null>(null)

function back() {
  if (window.history.state?.back) router.back()
  else router.push('/')
}
</script>

<template>
  <main class="mx-auto flex min-h-dvh max-w-2xl flex-col">
    <header class="sticky top-0 z-10 flex h-14 items-center gap-1 border-b border-zinc-200 bg-white/90 px-1 backdrop-blur">
      <button class="inline-flex h-11 w-11 items-center justify-center rounded-lg text-zinc-500" :aria-label="t('review.back')" @click="back">
        <ChevronLeft :size="24" />
      </button>
      <h1 v-if="data" class="text-lg font-semibold">{{ data.card.emoji }} {{ data.card.name }}</h1>
    </header>

    <p v-if="isPending" class="p-6 text-center text-zinc-400">{{ t('common.loading') }}</p>
    <p v-else-if="isError" class="p-6 text-center text-red-600">{{ t('common.loadFailed') }}</p>

    <div v-else class="flex flex-col gap-6 px-3 py-4">
      <section v-for="month in months" :key="month.key">
        <h2 class="mb-2 px-1 text-base font-semibold text-zinc-800">{{ month.label }}</h2>
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
            <span class="text-[15px] leading-tight font-medium tabular-nums">{{ d.day }}</span>
            <span class="value">{{ show(d.value) }}</span>
            <span v-if="d.delta !== null" class="text-[10px] leading-none opacity-70">{{ showDelta(d.delta) }}</span>
          </button>
        </div>
      </section>
    </div>

    <DayEventsSheet v-if="selected && data" :card-id="cardId" :card-tag="data.card.name" :date="selected" @close="selected = null" />
  </main>
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
