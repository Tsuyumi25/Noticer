<script setup lang="ts">
import { useQuery } from '@tanstack/vue-query'
import { computed, nextTick, ref, watch } from 'vue'
import { api } from '../api.ts'
import { locale } from '../i18n/index.ts'
import { dayKey } from '../time.ts'

/** Every month with entries up to this one, oldest on top like the month report; it opens on the day being read. */
const props = defineProps<{ day: Date }>()
const emit = defineEmits<{ pick: [day: string] }>()

const todayKey = dayKey(new Date())
const selected = computed(() => dayKey(props.day))

// Weeks start on Sunday, as in the month report; 2023-01-01 was one.
const weekdays = computed(() =>
  Array.from({ length: 7 }, (_, i) => new Intl.DateTimeFormat(locale.value, { weekday: 'narrow' }).format(new Date(2023, 0, 1 + i))),
)

const { data: counts } = useQuery({
  queryKey: ['days'],
  queryFn: async () => {
    const res = await api.days.$get()
    if (!res.ok) throw new Error(`days: ${res.status}`)
    return new Map((await res.json()).map((d) => [d.date, d.count]))
  },
})

interface Month {
  key: string
  label: string
  /** Empty cells before the 1st, so it lands under its weekday. */
  lead: number
  days: string[]
}

const months = computed<Month[]>(() => {
  if (!counts.value) return []
  const format = new Intl.DateTimeFormat(locale.value, { year: 'numeric', month: 'long' })
  const now = new Date()
  const first = [...counts.value.keys()][0] ?? todayKey
  const list: Month[] = []
  for (let m = new Date(`${first.slice(0, 7)}-01T00:00`); m <= now; m = new Date(m.getFullYear(), m.getMonth() + 1, 1)) {
    const length = new Date(m.getFullYear(), m.getMonth() + 1, 0).getDate()
    list.push({
      key: dayKey(m).slice(0, 7),
      label: format.format(m),
      lead: m.getDay(),
      days: Array.from({ length }, (_, i) => dayKey(new Date(m.getFullYear(), m.getMonth(), i + 1))),
    })
  }
  return list
})

// Opens on the day being read: this month sits at the bottom, an older day in the middle.
const scroller = ref<HTMLElement | null>(null)
watch(
  () => months.value.length,
  async (count, before) => {
    if (count === 0 || before) return
    await nextTick()
    const el = scroller.value
    if (!el) return
    if (selected.value.slice(0, 7) === todayKey.slice(0, 7)) el.scrollTop = el.scrollHeight
    else el.querySelector(`[data-day="${selected.value}"]`)?.scrollIntoView({ block: 'center' })
  },
  { immediate: true, flush: 'post' },
)
</script>

<template>
  <div ref="scroller" class="min-h-0 flex-1 touch-pan-y overflow-y-auto overscroll-contain px-3 pb-[calc(1rem+env(safe-area-inset-bottom))]">
    <section v-for="month in months" :key="month.key" class="pt-4 first:pt-1">
      <h3 class="mb-2 px-1 text-base font-semibold text-zinc-800">{{ month.label }}</h3>
      <div class="grid grid-cols-7 gap-0.5 pb-1 text-center text-[11px] text-zinc-400">
        <span v-for="(w, i) in weekdays" :key="i">{{ w }}</span>
      </div>
      <div class="grid grid-cols-7 gap-0.5">
        <span v-for="n in month.lead" :key="`lead-${n}`" />
        <button
          v-for="d in month.days"
          :key="d"
          class="cell"
          :class="{ on: d === selected, today: d === todayKey }"
          :data-day="d"
          :disabled="d > todayKey"
          @click="emit('pick', d)"
        >
          <b>{{ Number(d.slice(8)) }}</b>
          <i>{{ counts?.get(d) ?? '' }}</i>
        </button>
      </div>
    </section>
  </div>
</template>

<style scoped>
.cell {
  display: flex;
  min-height: 46px;
  flex-direction: column;
  align-items: center;
  justify-content: center;
  gap: 2px;
  border-radius: 10px;
  color: #3f3f46;
}
.cell b {
  font: 500 14px ui-monospace, 'SF Mono', Menlo, monospace;
}
.cell i {
  min-height: 12px;
  font: 600 10px ui-monospace, 'SF Mono', Menlo, monospace;
  font-style: normal;
  opacity: 0.6;
}
.cell:disabled {
  opacity: 0.3;
}
.cell.today {
  box-shadow: inset 0 0 0 1.5px #a5b4fc;
}
.cell.on {
  background: #4f46e5;
  color: white;
}
</style>
