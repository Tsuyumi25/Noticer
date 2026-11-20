<script setup lang="ts">
import { useQuery } from '@tanstack/vue-query'
import { ChevronLeft, ChevronRight } from 'lucide-vue-next'
import { computed, onMounted, onUnmounted, ref } from 'vue'
import { api } from '../api.ts'
import { locale, t } from '../i18n/index.ts'
import { dayKey } from '../time.ts'

const props = defineProps<{ day: Date }>()
const emit = defineEmits<{ pick: [day: string]; close: [] }>()

const month = ref(new Date(props.day.getFullYear(), props.day.getMonth(), 1))
const today = new Date()
const todayKey = dayKey(today)
const thisMonth = new Date(today.getFullYear(), today.getMonth(), 1).getTime()

const shift = (n: number) => (month.value = new Date(month.value.getFullYear(), month.value.getMonth() + n, 1))

const title = computed(() => new Intl.DateTimeFormat(locale.value, { year: 'numeric', month: 'long' }).format(month.value))

// Weeks start on Monday; 2024-01-01 was one.
const weekdays = computed(() =>
  Array.from({ length: 7 }, (_, i) => new Intl.DateTimeFormat(locale.value, { weekday: 'narrow' }).format(new Date(2024, 0, 1 + i))),
)

/** Six full weeks around the month. */
const cells = computed(() => {
  const first = month.value
  const start = new Date(first.getFullYear(), first.getMonth(), 1 - ((first.getDay() + 6) % 7))
  return Array.from({ length: 42 }, (_, i) => new Date(start.getFullYear(), start.getMonth(), start.getDate() + i))
})

const { data: counts } = useQuery({
  queryKey: computed(() => ['events', 'month', dayKey(month.value)]),
  queryFn: async () => {
    const from = cells.value[0]!.getTime() / 1000
    const last = cells.value[41]!
    const to = new Date(last.getFullYear(), last.getMonth(), last.getDate() + 1).getTime() / 1000
    const res = await api.events.$get({ query: { from: String(from), to: String(to) } })
    if (!res.ok) throw new Error(`events: ${res.status}`)
    const perDay = new Map<string, number>()
    for (const e of await res.json()) {
      const key = dayKey(new Date(e.eventAt * 1000))
      perDay.set(key, (perDay.get(key) ?? 0) + 1)
    }
    return perDay
  },
})

const selected = computed(() => dayKey(props.day))

function onKeydown(e: KeyboardEvent) {
  if (e.key === 'Escape') emit('close')
}
onMounted(() => window.addEventListener('keydown', onKeydown))
onUnmounted(() => window.removeEventListener('keydown', onKeydown))
</script>

<template>
  <Teleport to="body">
    <div class="fixed inset-0 z-40 flex items-end bg-black/30" @click.self="emit('close')">
      <section
        role="dialog"
        :aria-label="t('journal.calendar')"
        class="mx-auto w-full max-w-2xl rounded-t-2xl bg-white px-2 pt-1 pb-[calc(0.75rem+env(safe-area-inset-bottom))] shadow-xl"
      >
        <header class="flex items-center justify-between">
          <button class="nav" :aria-label="t('journal.prevMonth')" @click="shift(-1)"><ChevronLeft :size="22" /></button>
          <h2 class="text-[17px] font-semibold">{{ title }}</h2>
          <button class="nav" :aria-label="t('journal.nextMonth')" :disabled="month.getTime() >= thisMonth" @click="shift(1)">
            <ChevronRight :size="22" />
          </button>
        </header>
        <div class="grid grid-cols-7 gap-0.5">
          <span v-for="w in weekdays" :key="w" class="pb-1 text-center text-[11px] text-zinc-400">{{ w }}</span>
          <button
            v-for="cell in cells"
            :key="cell.getTime()"
            class="cell"
            :class="{
              out: cell.getMonth() !== month.getMonth(),
              on: dayKey(cell) === selected,
              today: dayKey(cell) === todayKey,
            }"
            :disabled="dayKey(cell) > todayKey"
            @click="emit('pick', dayKey(cell))"
          >
            <b>{{ cell.getDate() }}</b>
            <i>{{ counts?.get(dayKey(cell)) ?? '' }}</i>
          </button>
        </div>
      </section>
    </div>
  </Teleport>
</template>

<style scoped>
.nav {
  display: inline-flex;
  width: 44px;
  height: 44px;
  align-items: center;
  justify-content: center;
  border-radius: 10px;
  color: #71717a;
}
.nav:disabled {
  opacity: 0.25;
}
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
.cell.out {
  color: #a1a1aa;
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
