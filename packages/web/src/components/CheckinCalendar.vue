<script setup lang="ts">
import { useQuery } from '@tanstack/vue-query'
import { ChevronLeft, ChevronRight } from 'lucide-vue-next'
import { parseValueKey } from 'server/values'
import { computed, ref } from 'vue'
import { api } from '../api.ts'
import { locale, t } from '../i18n/index.ts'
import { configQuery } from '../queries.ts'
import { clock, dayKey, dayName } from '../time.ts'

const props = defineProps<{ cardId: string; at: number | null }>()
const emit = defineEmits<{ pick: [at: number | null] }>()

const now = Date.now()
const shown = new Date(props.at ?? now)
const month = ref(new Date(shown.getFullYear(), shown.getMonth(), 1))
const isThisMonth = computed(() => month.value.getFullYear() === new Date(now).getFullYear() && month.value.getMonth() === new Date(now).getMonth())
const shift = (n: number) => (month.value = new Date(month.value.getFullYear(), month.value.getMonth() + n, 1))

const { data: events } = useQuery({
  queryKey: computed(() => ['calendar', 'month', props.cardId, month.value.getTime()]),
  queryFn: async () => {
    const from = month.value.getTime() / 1000
    const to = new Date(month.value.getFullYear(), month.value.getMonth() + 1, 1).getTime() / 1000
    const res = await api.cards[':cardId'].events.$get({ param: { cardId: props.cardId }, query: { from: String(from), to: String(to) } })
    if (!res.ok) throw new Error(`card events: ${res.status}`)
    return res.json()
  },
})
const { data: config } = useQuery(configQuery)
const root = computed(() => config.value?.cards.find((c) => c.id === props.cardId)?.root)

const counts = computed(() => {
  const map = new Map<string, number>()
  for (const e of events.value ?? []) {
    const key = dayKey(new Date(e.eventAt * 1000))
    map.set(key, (map.get(key) ?? 0) + 1)
  }
  return map
})

const title = computed(() => new Intl.DateTimeFormat(locale.value, { year: 'numeric', month: 'long' }).format(month.value))
const weekdays = computed(() =>
  Array.from({ length: 7 }, (_, i) => new Intl.DateTimeFormat(locale.value, { weekday: 'narrow' }).format(new Date(2023, 0, 1 + i))),
)
const days = computed(() => {
  const m = month.value
  const length = new Date(m.getFullYear(), m.getMonth() + 1, 0).getDate()
  return Array.from({ length }, (_, i) => new Date(m.getFullYear(), m.getMonth(), i + 1))
})
const today = dayKey(new Date(now))
const selected = computed(() => dayKey(new Date(props.at ?? Date.now())))

function pick(day: Date) {
  const current = Date.now()
  if (props.at === null && dayKey(day) === dayKey(new Date(current))) return emit('pick', null)
  const base = new Date(props.at ?? current)
  emit('pick', Math.min(current, new Date(day.getFullYear(), day.getMonth(), day.getDate(), base.getHours(), base.getMinutes()).getTime()))
}

const dayEvents = computed(() =>
  (events.value ?? [])
    .filter((e) => dayKey(new Date(e.eventAt * 1000)) === selected.value)
    .map((e) => ({
      id: e.id,
      time: clock(e.eventAt * 1000),
      tags: e.tags.filter((tag) => tag !== root.value),
      values: Object.entries(e.facts).flatMap(([key, value]) => {
        const parsed = parseValueKey(key)
        return parsed && typeof value === 'number' ? [`${value}${parsed.unit}`] : []
      }),
      note: e.note,
    })),
)
</script>

<template>
  <aside class="flex w-[380px] shrink-0 flex-col border-l border-zinc-200 bg-zinc-50">
    <div class="flex h-14 shrink-0 items-center justify-between px-2">
      <button class="flex h-11 w-11 items-center justify-center rounded-xl text-zinc-500 hover:bg-zinc-200" :aria-label="t('journal.prevMonth')" @click="shift(-1)">
        <ChevronLeft :size="20" />
      </button>
      <span class="text-[15px] font-semibold">{{ title }}</span>
      <button
        class="flex h-11 w-11 items-center justify-center rounded-xl text-zinc-500 hover:bg-zinc-200 disabled:opacity-30"
        :aria-label="t('journal.nextMonth')"
        :disabled="isThisMonth"
        @click="shift(1)"
      >
        <ChevronRight :size="20" />
      </button>
    </div>
    <div class="shrink-0 px-3 pb-3">
      <div class="grid grid-cols-7 pb-1 text-center text-[11px] text-zinc-400">
        <span v-for="(w, i) in weekdays" :key="i">{{ w }}</span>
      </div>
      <div class="grid grid-cols-7 gap-1">
        <span v-for="n in days[0]!.getDay()" :key="`lead-${n}`" />
        <button
          v-for="d in days"
          :key="d.getDate()"
          class="day"
          :class="{ has: counts.has(dayKey(d)), sel: dayKey(d) === selected, today: dayKey(d) === today }"
          :disabled="dayKey(d) > today"
          @click="pick(d)"
        >
          {{ d.getDate() }}
          <b v-if="counts.get(dayKey(d))">{{ counts.get(dayKey(d)) }}</b>
        </button>
      </div>
    </div>
    <h3 class="shrink-0 border-t border-zinc-200 px-4 pt-3 pb-1 text-xs font-semibold text-zinc-500">{{ dayName(new Date(`${selected}T00:00`).getTime(), now) }}</h3>
    <div class="min-h-0 flex-1 overflow-y-auto px-4 pb-4">
      <p v-if="!dayEvents.length" class="py-3 text-sm text-zinc-400">{{ t('journal.empty') }}</p>
      <div v-for="e in dayEvents" :key="e.id" class="border-b border-zinc-200 py-2 last:border-0">
        <div class="flex flex-wrap items-center gap-1.5">
          <span class="font-mono text-[13px] font-semibold text-zinc-700">{{ e.time }}</span>
          <span v-for="tag in e.tags" :key="tag" class="rounded-md bg-white px-1.5 py-0.5 text-xs text-zinc-700">{{ tag }}</span>
          <span v-for="v in e.values" :key="v" class="font-mono text-xs font-semibold text-indigo-700">{{ v }}</span>
        </div>
        <p v-if="e.note" class="mt-1 text-xs whitespace-pre-wrap text-zinc-500">{{ e.note }}</p>
      </div>
    </div>
  </aside>
</template>

<style scoped>
.day {
  display: flex;
  flex-direction: column;
  align-items: center;
  justify-content: center;
  height: 44px;
  border: 1.5px solid #e4e4e7;
  border-radius: 9px;
  background: white;
  font-size: 12.5px;
  line-height: 1.15;
  color: #3f3f46;
}
.day b {
  font: 700 11.5px ui-monospace, monospace;
  color: #4338ca;
}
.day.has {
  border-color: #c7d2fe;
  background: #eef2ff;
}
.day.today {
  box-shadow: inset 0 0 0 1.5px #6366f1;
}
.day.sel {
  border-color: #b45309;
  background: #fffbeb;
}
.day:disabled {
  opacity: 0.35;
}
</style>
