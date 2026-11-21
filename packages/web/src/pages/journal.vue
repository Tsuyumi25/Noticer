<script setup lang="ts">
import { useQuery, useQueryClient } from '@tanstack/vue-query'
import { CalendarDays, ChevronLeft, ChevronRight } from 'lucide-vue-next'
import type { CardConfig } from 'server/config'
import { PURE_CARD } from 'server/pure'
import { parseValueKey } from 'server/values'
import { computed, ref, watch } from 'vue'
import { useRoute, useRouter } from 'vue-router'
import { api } from '../api.ts'
import CheckinSheet, { type SheetEvent } from '../components/CheckinSheet.vue'
import QuickNoteSheet from '../components/QuickNoteSheet.vue'
import JournalCalendar from '../components/JournalCalendar.vue'
import { useDaySwipe } from '../daySwipe.ts'
import { t, tn } from '../i18n/index.ts'
import { cardColor, tagColors } from '../tagColors.ts'
import { clock, date, dayKey } from '../time.ts'

const GAP_SECONDS = 2 * 3600

const route = useRoute()
const router = useRouter()

const day = computed(() => {
  const raw = route.query.day
  const parsed = typeof raw === 'string' && /^\d{4}-\d{2}-\d{2}$/.test(raw) ? new Date(`${raw}T00:00`) : null
  const base = parsed && !Number.isNaN(parsed.getTime()) ? parsed : new Date()
  return new Date(base.getFullYear(), base.getMonth(), base.getDate())
})
const dayAt = (n: number) => new Date(day.value.getFullYear(), day.value.getMonth(), day.value.getDate() + n)
const shiftDay = (n: number) => dayKey(dayAt(n))
const isToday = computed(() => dayKey(day.value) >= dayKey(new Date()))
const goTo = (key: string) => router.replace({ query: { day: key } })

function eventsOf(start: Date) {
  return {
    queryKey: ['events', dayKey(start)],
    queryFn: async () => {
      const from = start.getTime() / 1000
      const to = new Date(start.getFullYear(), start.getMonth(), start.getDate() + 1).getTime() / 1000
      const res = await api.events.$get({ query: { from: String(from), to: String(to) } })
      if (!res.ok) throw new Error(`events: ${res.status}`)
      return res.json()
    },
  }
}

const { data: events, isPending, isError } = useQuery(computed(() => eventsOf(day.value)))

/** Days each way loaded ahead, so flipping several in a row never waits on the network. */
const PREFETCH_DAYS = 3
const queryClient = useQueryClient()
watch(
  day,
  () => {
    const today = dayKey(new Date())
    for (let n = 1; n <= PREFETCH_DAYS; n++) {
      queryClient.prefetchQuery(eventsOf(dayAt(-n)))
      if (shiftDay(n) <= today) queryClient.prefetchQuery(eventsOf(dayAt(n)))
    }
  },
  { immediate: true },
)

const pane = ref<HTMLElement | null>(null)
const swipe = useDaySwipe(pane, { canGoForward: () => !isToday.value, go: (step) => goTo(shiftDay(step)) })

const { data: config } = useQuery({
  queryKey: ['config'],
  queryFn: async () => {
    const res = await api.config.$get()
    if (!res.ok) throw new Error(`config: ${res.status}`)
    return res.json()
  },
})
const cards = computed(() => new Map((config.value?.cards ?? []).map((c) => [c.id, c as CardConfig])))
const colors = computed(() => (config.value ? tagColors(config.value) : new Map<string, string>()))

interface Chip {
  name: string
  amount: string
  unit: string
}

/** Values and the config's choices; facts kept from the old app that nothing models stay hidden. */
function chipsOf(card: CardConfig | undefined, facts: Record<string, string | number | boolean>): Chip[] {
  const specs = card ? config.value?.tagGroups[card.root]?.values ?? {} : {}
  return Object.entries(facts).flatMap(([key, value]): Chip[] => {
    const parsed = parseValueKey(key)
    if (parsed && typeof value === 'number') {
      const decimals = specs[parsed.tag]?.decimals
      return [{ name: parsed.tag, amount: decimals === undefined ? String(value) : value.toFixed(decimals), unit: parsed.unit }]
    }
    const input = config.value?.factInputs[key]
    if (!input) return []
    const label = input.options.find((o) => o.value === value)?.label
    return [{ name: input.name, amount: label ? `${value} ${label}` : String(value), unit: '' }]
  })
}

const rows = computed(() =>
  (events.value ?? []).map((event, i, all) => {
    const card = cards.value.get(event.cardId)
    const quick = event.cardId === PURE_CARD
    const tags = event.tags.filter((tag) => tag !== card?.root).map((label) => ({ label, color: colors.value.get(label) }))
    const previous = all[i - 1]
    const gap = previous ? event.eventAt - previous.eventAt : 0
    return {
      event,
      card,
      quick,
      tags,
      chips: chipsOf(card, event.facts),
      color: tags.find((tag) => tag.color)?.color ?? (card && config.value ? cardColor(config.value, card) : '#d4d4d8'),
      gapHours: gap >= GAP_SECONDS ? Math.round(gap / 3600) : 0,
    }
  }),
)

const editing = ref<{ card: CardConfig; event: SheetEvent } | null>(null)
const editingNote = ref<SheetEvent | null>(null)
function edit(row: (typeof rows.value)[number]) {
  if (row.quick) editingNote.value = row.event
  else if (row.card) editing.value = { card: row.card, event: row.event }
}

const calendar = ref(false)
function pickDay(key: string) {
  calendar.value = false
  goTo(key)
}
</script>

<template>
  <main class="mx-auto flex min-h-dvh max-w-2xl flex-col overflow-x-clip bg-zinc-100">
    <header class="sticky top-0 z-10 flex items-center justify-between border-b border-zinc-200 bg-white/90 px-1 py-1.5 backdrop-blur">
      <button class="nav" :aria-label="t('journal.prevDay')" @click="goTo(shiftDay(-1))"><ChevronLeft :size="22" /></button>
      <h1 class="text-[17px] font-semibold">{{ date(day.getTime()) }}</h1>
      <button class="nav" :aria-label="t('journal.nextDay')" :disabled="isToday" @click="goTo(shiftDay(1))"><ChevronRight :size="22" /></button>
    </header>

    <div ref="pane" class="pane" :style="swipe.style.value">
      <p v-if="isPending" class="p-6 text-center text-zinc-400">{{ t('common.loading') }}</p>
      <p v-else-if="isError" class="p-6 text-center text-red-600">{{ t('common.loadFailed') }}</p>
      <p v-else-if="!rows.length" class="p-6 text-center text-zinc-400">{{ t('journal.empty') }}</p>

      <ol v-else class="timeline">
        <template v-for="row in rows" :key="row.event.id">
          <li v-if="row.gapHours" class="gap" aria-hidden="true">{{ tn('time.hours', row.gapHours) }}</li>
          <li class="row" :style="{ '--c': row.color }" role="button" tabindex="0" @click="edit(row)" @keydown.enter="edit(row)">
            <div class="time">
              {{ clock(row.event.eventAt * 1000) }}
              <span v-if="row.event.timeOffset < 0" class="late">{{ t('journal.backdated') }}</span>
            </div>
            <div class="rail">
              <span class="line" />
              <span class="node">{{ row.quick ? '📝' : (row.card?.emoji ?? '•') }}</span>
            </div>
            <div class="body">
              <div v-if="row.tags.length || row.chips.length" class="flex flex-wrap gap-1">
                <span
                  v-for="tag in row.tags"
                  :key="tag.label"
                  class="tag"
                  :style="tag.color ? { background: `${tag.color}22`, color: tag.color } : undefined"
                >
                  {{ tag.label }}
                </span>
                <span v-for="chip in row.chips" :key="chip.name" class="vchip">
                  <span class="vn">{{ chip.name }}</span>
                  <span class="va">{{ chip.amount }}<small v-if="chip.unit">{{ chip.unit }}</small></span>
                </span>
              </div>
              <p v-if="row.event.note" class="note">{{ row.event.note }}</p>
            </div>
          </li>
        </template>
      </ol>
    </div>

    <button class="fab" :aria-label="t('journal.calendar')" @click="calendar = true"><CalendarDays :size="24" /></button>

    <JournalCalendar v-if="calendar" :day="day" @pick="pickDay" @close="calendar = false" />
    <CheckinSheet
      v-if="editing"
      :key="editing.event.id"
      :card="{ id: editing.card.id, name: editing.card.name, emoji: editing.card.emoji }"
      :event="editing.event"
      @close="editing = null"
    />
    <QuickNoteSheet v-if="editingNote" :key="editingNote.id" :event="editingNote" @close="editingNote = null" />
  </main>
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
/* The browser keeps vertical scrolling; horizontal swipes are ours. */
.pane {
  flex: 1;
  touch-action: pan-y;
}
.timeline {
  padding: 6px 10px 96px;
}
.row {
  position: relative;
  display: flex;
  gap: 8px;
  min-height: 44px;
  margin-left: 2px;
  padding: 5px 0 5px 6px;
  border-left: 3px solid var(--c);
  border-radius: 3px;
  cursor: pointer;
}
.row:active {
  background: rgb(0 0 0 / 0.04);
}
.time {
  display: flex;
  width: 46px;
  flex: none;
  flex-direction: column;
  align-items: flex-end;
  gap: 2px;
  padding-top: 4px;
  font: 13px ui-monospace, 'SF Mono', Menlo, monospace;
  color: #71717a;
}
.late {
  display: inline-flex;
  height: 17px;
  align-items: center;
  padding: 0 5px;
  border-radius: 5px;
  background: #fef3c7;
  color: #92400e;
  font: 700 10.5px system-ui, sans-serif;
}
.rail {
  position: relative;
  width: 30px;
  flex: none;
}
.line {
  position: absolute;
  top: 0;
  bottom: -10px;
  left: 14px;
  width: 2px;
  background: #e4e4e7;
}
.row:last-child .line {
  bottom: auto;
  height: 16px;
}
.node {
  position: absolute;
  top: 2px;
  left: 0;
  display: flex;
  width: 30px;
  height: 30px;
  align-items: center;
  justify-content: center;
  border: 2px solid #e4e4e7;
  border-radius: 50%;
  background: white;
  font-size: 15px;
}
.body {
  min-width: 0;
  flex: 1;
  padding: 4px 0 2px;
}
.tag {
  display: inline-flex;
  align-items: center;
  padding: 1px 8px;
  border-radius: 999px;
  background: #e4e4e7;
  color: #3f3f46;
  font-size: 13px;
}
.vchip {
  display: inline-flex;
  align-items: stretch;
  overflow: hidden;
  border: 1.5px solid #e5e7eb;
  border-radius: 9px;
  background: white;
  color: #374151;
  font-size: 12.5px;
  font-weight: 500;
}
.vn {
  padding: 2px 7px;
}
.va {
  padding: 2px 7px;
  border-left: 1px solid #e5e7eb;
  background: #f8fafc;
  color: #3730a3;
  font: 700 12.5px ui-monospace, 'SF Mono', Menlo, monospace;
}
.va small {
  margin-left: 1px;
  color: #6b7280;
  font: 400 10px ui-monospace, 'SF Mono', Menlo, monospace;
}
.note {
  margin-top: 4px;
  color: #3f3f46;
  font-size: 14px;
  white-space: pre-wrap;
  overflow-wrap: anywhere;
}
.gap {
  display: flex;
  align-items: center;
  gap: 6px;
  padding: 2px 14px;
  color: #a1a1aa;
  font-size: 11px;
}
.gap::before,
.gap::after {
  content: '';
  height: 1px;
  flex: 1;
  background: currentColor;
  opacity: 0.4;
}
.fab {
  position: fixed;
  right: max(16px, calc((100vw - 42rem) / 2 + 16px));
  bottom: calc(64px + env(safe-area-inset-bottom) + 28px);
  z-index: 20;
  display: flex;
  width: 56px;
  height: 56px;
  align-items: center;
  justify-content: center;
  border-radius: 16px;
  background: #4f46e5;
  color: white;
  box-shadow: 0 4px 14px rgb(79 70 229 / 0.35);
}
</style>
