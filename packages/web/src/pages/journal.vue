<script setup lang="ts">
import { useQuery, useQueryClient } from '@tanstack/vue-query'
import { ChevronLeft, ChevronRight, LayoutDashboard } from 'lucide-vue-next'
import type { EventRecord } from 'server/events'
import { computed, nextTick, ref, watch } from 'vue'
import { useRoute, useRouter } from 'vue-router'
import { api } from '../api.ts'
import EventCard from '../components/EventCard.vue'
import EventEditor from '../components/EventEditor.vue'
import EventMenu from '../components/EventMenu.vue'
import type { ConflictEvent } from '../versions.ts'
import JournalFinder from '../components/JournalFinder.vue'
import { usePageSwipe } from '../pageSwipe.ts'
import { t, tn } from '../i18n/index.ts'
import { date, dayKey, parseDayKey } from '../time.ts'
import { isDesktop } from '../viewport.ts'

const GAP_SECONDS = 2 * 3600

const route = useRoute()
const router = useRouter()

const day = computed(() => {
  const base = parseDayKey(route.query.day) ?? new Date()
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
const swipe = usePageSwipe(pane, { canGo: (step) => step === -1 || !isToday.value, go: (step) => goTo(shiftDay(step)) })

const rows = computed(() =>
  (events.value ?? []).map((event, i, all) => {
    const previous = all[i - 1]
    const gap = previous ? event.eventAt - previous.eventAt : 0
    return { event, gapHours: gap >= GAP_SECONDS ? Math.round(gap / 3600) : 0 }
  }),
)

const viewerArea = ref<HTMLElement | null>(null)
const editing = ref<ConflictEvent | null>(null)
const editingDocked = ref(false)
const editor = ref<InstanceType<typeof EventEditor> | null>(null)
const next = ref<ConflictEvent | null>(null)
function openEvent(event: ConflictEvent) {
  if (editing.value?.id === event.id) return
  if (editing.value && editingDocked.value && editor.value?.dirty) {
    next.value = event
    editor.value.requestClose()
    return
  }
  editingDocked.value = isDesktop.value
  editing.value = event
}
function closeEditor() {
  editing.value = null
  const waiting = next.value
  next.value = null
  if (waiting) openEvent(waiting)
}

const menu = ref<{ event: EventRecord; x: number; y: number } | null>(null)
function onDeleted(id: number) {
  if (editing.value?.id !== id) return
  next.value = null
  editing.value = null
}

const finding = ref(false)
function pickDay(key: string) {
  goTo(key)
}

/** The entry a search result or gallery picture pointed at: its day opens and it lights up once in view. */
const flash = ref<number | null>(null)
function jump(eventId: number, eventAt: number) {
  flash.value = eventId
  goTo(dayKey(new Date(eventAt * 1000)))
}
watch([flash, rows], async ([id]) => {
  if (id === null || !rows.value.some((r) => r.event.id === id)) return
  await nextTick()
  document.querySelector(`[data-event="${id}"]`)?.scrollIntoView({ block: 'center' })
  setTimeout(() => {
    if (flash.value === id) flash.value = null
  }, 1600)
})
</script>

<template>
  <div :class="isDesktop ? 'grid h-full grid-cols-[320px_minmax(0,1fr)_400px] bg-zinc-100' : 'contents'">
    <aside v-if="isDesktop" class="col-start-1 row-start-1 min-h-0 border-r border-zinc-200">
      <JournalFinder docked :day="day" :viewer-area="viewerArea" @pick="pickDay" @jump="jump" @resolve="openEvent" />
    </aside>
    <main
      class="flex flex-col overflow-x-clip bg-zinc-100"
      :class="isDesktop ? 'col-start-2 row-start-1 min-h-0 overflow-y-auto' : 'mx-auto min-h-dvh max-w-2xl'"
    >
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
            <li>
              <EventCard
                :event="row.event"
                :flash="flash === row.event.id"
                :selected="editingDocked && editing?.id === row.event.id"
                :viewer-area="viewerArea"
                @open="openEvent(row.event)"
                @menu="(x, y) => (menu = { event: row.event, x, y })"
              />
            </li>
          </template>
        </ol>
      </div>

      <template v-if="!isDesktop">
        <button class="fab" :aria-label="t('journal.finder')" @click="finding = true"><LayoutDashboard :size="24" /></button>
        <JournalFinder v-if="finding" :day="day" @pick="pickDay" @jump="jump" @resolve="openEvent" @close="finding = false" />
      </template>
      <EventEditor v-if="editing && !editingDocked" :key="editing.id" :event="editing" @close="closeEditor" />
    </main>
    <aside v-if="isDesktop" class="relative col-start-3 row-start-1 min-h-0 border-l border-zinc-200 bg-white">
      <EventEditor v-if="editing && editingDocked" ref="editor" :key="editing.id" :event="editing" docked @close="closeEditor" />
      <p v-else class="p-8 text-center text-sm text-zinc-400">{{ t('journal.pickHint') }}</p>
    </aside>
    <EventMenu v-if="menu" :event="menu.event" :x="menu.x" :y="menu.y" @close="menu = null" @edit="openEvent(menu.event)" @deleted="onDeleted" />
    <div v-if="isDesktop" ref="viewerArea" class="pointer-events-none relative z-20 col-[2/4] row-start-1" />
  </div>
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
  padding: 2px 10px 96px;
}
.gap {
  display: flex;
  align-items: center;
  gap: 6px;
  padding: 2px 4px;
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
