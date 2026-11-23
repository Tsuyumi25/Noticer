<script setup lang="ts">
import { useQuery, useQueryClient } from '@tanstack/vue-query'
import { ChevronLeft, ChevronRight, CircleQuestionMark, LayoutDashboard } from 'lucide-vue-next'
import type { CardConfig } from 'server/config'
import { PURE_CARD } from 'server/pure'
import { parseValueKey } from 'server/values'
import { computed, nextTick, ref, watch } from 'vue'
import { useRoute, useRouter } from 'vue-router'
import { api } from '../api.ts'
import EventEditor from '../components/EventEditor.vue'
import type { ConflictEvent } from '../versions.ts'
import AttachmentIcon from '../components/AttachmentIcon.vue'
import { isVideo, isVisual, previewUrl } from '../attachments.ts'
import { openViewer } from '../viewer.ts'
import JournalFinder from '../components/JournalFinder.vue'
import { configQuery } from '../queries.ts'
import { usePageSwipe } from '../pageSwipe.ts'
import { t, tn } from '../i18n/index.ts'
import { cardColor, tagColors } from '../tagColors.ts'
import { clock, date, dayKey, parseDayKey } from '../time.ts'
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

const { data: config } = useQuery(configQuery)
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
  <div :class="isDesktop ? 'grid h-[calc(100dvh-56px)] grid-cols-[320px_minmax(0,1fr)_400px] bg-zinc-100' : 'contents'">
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
            <li class="row" :class="{ flash: flash === row.event.id, sel: editingDocked && editing?.id === row.event.id }" :data-event="row.event.id" :style="{ '--c': row.color }" role="button" tabindex="0" @click="openEvent(row.event)" @keydown.enter="openEvent(row.event)">
              <div class="time">
                {{ clock(row.event.eventAt * 1000) }}
                <span v-if="row.event.timeOffset < 0" class="late">{{ t('journal.backdated') }}</span>
              </div>
              <div class="rail">
                <span class="line" />
                <span class="node">
                  {{ row.quick ? '📝' : (row.card?.emoji ?? '•') }}
                  <CircleQuestionMark v-if="row.event.versions.length" class="versions" :size="17" :stroke-width="2.5" />
                </span>
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
                <div v-if="row.event.attachments.length" class="mt-1.5 flex flex-wrap gap-1.5">
                  <button
                    v-for="(a, i) in row.event.attachments"
                    :key="a.id"
                    class="attachment"
                    :class="{ file: !isVisual(a) }"
                    :aria-label="a.name"
                    @click.stop="openViewer(row.event.attachments, i, { within: viewerArea })"
                  >
                    <img v-if="isVisual(a)" :src="previewUrl(a)" alt="" loading="lazy" class="size-full rounded-lg object-cover" />
                    <template v-else><AttachmentIcon :attachment="a" :size="16" /><span class="truncate">{{ a.name }}</span></template>
                    <span v-if="isVideo(a) && isVisual(a)" class="play">▶</span>
                  </button>
                </div>
              </div>
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
  padding: 6px 10px 96px;
}
.row.flash {
  animation: flash 1.6s ease-out;
}
@keyframes flash {
  0%,
  40% {
    background: #fef08a;
  }
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
.row.sel {
  background: #eef2ff;
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
.versions {
  position: absolute;
  top: -6px;
  right: -7px;
  border-radius: 50%;
  background: white;
  color: #f59e0b;
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
.attachment {
  position: relative;
  width: 64px;
  height: 64px;
}
.attachment.file {
  display: inline-flex;
  align-items: center;
  gap: 4px;
  width: auto;
  max-width: 100%;
  height: 44px;
  padding: 0 10px;
  border-radius: 10px;
  background: #f4f4f5;
  color: #52525b;
  font-size: 13px;
}
.attachment .play {
  position: absolute;
  inset: 0;
  display: flex;
  align-items: center;
  justify-content: center;
  color: white;
  text-shadow: 0 0 6px rgb(0 0 0 / 0.6);
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
