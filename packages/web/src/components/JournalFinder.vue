<script setup lang="ts">
import { useInfiniteQuery, useQuery } from '@tanstack/vue-query'
import { CalendarDays, CircleQuestionMark, Images, Play, Search } from 'lucide-vue-next'
import { PURE_CARD } from 'server/pure'
import { computed, nextTick, onMounted, onUnmounted, ref, watch, type Component } from 'vue'
import { api } from '../api.ts'
import { isVideo, isVisual, previewUrl } from '../attachments.ts'
import { locale, t, tn, type MessageKey } from '../i18n/index.ts'
import { configQuery, conflictsQuery } from '../queries.ts'
import { clock } from '../time.ts'
import { usePageSwipe } from '../pageSwipe.ts'
import { useSheetDrag } from '../sheetDrag.ts'
import { openViewer } from '../viewer.ts'
import AttachmentIcon from './AttachmentIcon.vue'
import JournalCalendar from './JournalCalendar.vue'
import type { ConflictEvent } from '../versions.ts'

/** Finding a picture, a day or an entry: the gallery opens first; the calendar, search and any conflicts sit beside it, a swipe away. */
const props = defineProps<{ day: Date }>()
const emit = defineEmits<{ pick: [day: string]; jump: [eventId: number, eventAt: number]; resolve: [event: ConflictEvent]; close: [] }>()

type Tab = 'calendar' | 'search' | 'gallery' | 'conflicts'
const { data: conflicts } = useQuery(conflictsQuery)
const tabs = computed(() => {
  const all: { key: Tab; icon: Component; label: MessageKey }[] = [
    { key: 'gallery', icon: Images, label: 'finder.gallery' },
    { key: 'calendar', icon: CalendarDays, label: 'journal.calendar' },
    { key: 'search', icon: Search, label: 'finder.search' },
  ]
  if (conflicts.value?.length) all.push({ key: 'conflicts', icon: CircleQuestionMark, label: 'finder.conflicts' })
  return all
})
const tab = ref<Tab>('gallery')
watch(tabs, (list) => {
  if (!list.some((x) => x.key === tab.value)) tab.value = list.at(-1)!.key
})

// Swiping sideways turns to the tab beside this one.
const pane = ref<HTMLElement | null>(null)
const tabIndex = computed(() => tabs.value.findIndex((x) => x.key === tab.value))
const swipe = usePageSwipe(pane, {
  canGo: (step) => tabs.value[tabIndex.value + step] !== undefined,
  go: async (step) => {
    tab.value = tabs.value[tabIndex.value + step]!.key
    await nextTick()
  },
})

const { sheet, sheetStyle, backdrop, animated, leave, isLeaveEnd, onTouchStart, onTouchMove, onTouchEnd } = useSheetDrag({ onRequestClose: () => leave() })
// The sheet keeps its rounded top at rest; only its slide comes from the drag.
const slide = computed(() => ({ transform: sheetStyle.value.transform }))
function onTransitionEnd(e: TransitionEvent) {
  if (isLeaveEnd(e)) emit('close')
}
/** The journal moves to what was picked while the sheet slides away. */
function pick(day: string) {
  emit('pick', day)
  leave()
}
function jump(eventId: number, eventAt: number) {
  emit('jump', eventId, eventAt)
  leave()
}

const { data: config } = useQuery(configQuery)
const cards = computed(() => new Map((config.value?.cards ?? []).map((c) => [c.id, c])))
const emojiOf = (cardId: string) => (cardId === PURE_CARD ? '📝' : (cards.value.get(cardId)?.emoji ?? '•'))

// ---------- search ----------
const typed = ref('')
const query = ref('')
let debounce: ReturnType<typeof setTimeout> | undefined
watch(typed, (text) => {
  clearTimeout(debounce)
  debounce = setTimeout(() => (query.value = text.trim()), 250)
})
const search = useInfiniteQuery({
  queryKey: computed(() => ['search', query.value]),
  enabled: computed(() => query.value !== ''),
  initialPageParam: null as string | null,
  queryFn: async ({ pageParam }) => {
    const res = await api.search.$get({ query: { q: query.value, ...(pageParam ? { after: pageParam } : {}) } })
    if (!res.ok) throw new Error(`search: ${res.status}`)
    return res.json()
  },
  getNextPageParam: (last) => (last.next ? `${last.next.eventAt}:${last.next.id}` : null),
})
const found = computed(() => search.data.value?.pages.flatMap((p) => p.events))
const total = computed(() => search.data.value?.pages[0]?.total ?? null)
const searching = computed(() => search.isFetching.value)
// The next page loads as the end of the list comes near.
const end = ref<HTMLElement | null>(null)
const observer = new IntersectionObserver((entries) => {
  if (entries.some((e) => e.isIntersecting) && search.hasNextPage.value && !search.isFetchingNextPage.value) void search.fetchNextPage()
}, { rootMargin: '600px' })
watch(end, (el, old) => {
  if (old) observer.unobserve(old)
  if (el) observer.observe(el)
})
onUnmounted(() => observer.disconnect())
const dateTime = (at: number) =>
  `${new Intl.DateTimeFormat(locale.value, { year: 'numeric', month: 'numeric', day: 'numeric' }).format(at * 1000)} ${clock(at * 1000)}`
/** Splits text around the searched word so the matches can be marked. */
const pieces = (text: string) => {
  const q = query.value
  if (!q) return [{ text, hit: false }]
  return text.split(q).flatMap((part, i) => (i === 0 ? [{ text: part, hit: false }] : [{ text: q, hit: true }, { text: part, hit: false }]))
}
const shownTags = (cardId: string, tags: string[]) => tags.filter((tag) => tag !== cards.value.get(cardId)?.root)
const vFocus = { mounted: (el: HTMLElement) => el.focus() }

// ---------- gallery ----------
const { data: media } = useQuery({
  queryKey: ['media'],
  enabled: computed(() => tab.value === 'gallery'),
  queryFn: async () => {
    const res = await api.media.$get()
    if (!res.ok) throw new Error(`media: ${res.status}`)
    return res.json()
  },
})
const months = computed(() => {
  const format = new Intl.DateTimeFormat(locale.value, { year: 'numeric', month: 'long' })
  const groups: { title: string; items: { index: number; item: NonNullable<typeof media.value>[number] }[] }[] = []
  ;(media.value ?? []).forEach((item, index) => {
    const title = format.format(item.eventAt * 1000)
    if (groups.at(-1)?.title !== title) groups.push({ title, items: [] })
    groups.at(-1)!.items.push({ index, item })
  })
  return groups
})
function view(index: number) {
  const list = media.value ?? []
  void openViewer(list, index, {
    showInJournal: (at) => {
      const item = list[at]
      if (item) jump(item.eventId, item.eventAt)
    },
  })
}

function onKeydown(e: KeyboardEvent) {
  if (e.key === 'Escape' && !document.querySelector('.pswp')) leave()
}
onMounted(() => window.addEventListener('keydown', onKeydown))
onUnmounted(() => window.removeEventListener('keydown', onKeydown))
</script>

<template>
  <Teleport to="body">
    <div class="fixed inset-0 z-40 flex items-end">
      <div class="absolute inset-0 bg-black" :class="{ 'sheet-animated': animated }" :style="{ opacity: backdrop }" @click="leave()" />
      <section
        ref="sheet"
        role="dialog"
        :aria-label="t(tabs.find((x) => x.key === tab)!.label)"
        class="relative mx-auto flex h-[calc(100dvh-56px)] w-full max-w-2xl flex-col rounded-t-2xl bg-white pt-1 shadow-xl"
        :class="{ 'sheet-animated': animated }"
        :style="slide"
        @touchstart="onTouchStart"
        @touchmove="onTouchMove"
        @touchend="onTouchEnd"
        @touchcancel="onTouchEnd"
        @transitionend="onTransitionEnd"
      >
        <div class="mx-auto mt-1 mb-1.5 h-1 w-10 shrink-0 rounded-full bg-zinc-300" />
        <div class="seg mx-3 mb-2 shrink-0" role="tablist">
          <button v-for="x in tabs" :key="x.key" role="tab" :aria-selected="tab === x.key" :class="{ on: tab === x.key }" @click="tab = x.key">
            <component :is="x.icon" :size="18" />{{ t(x.label) }}
          </button>
        </div>

        <div ref="pane" class="flex min-h-0 flex-1 touch-pan-y flex-col" :style="swipe.style.value">
          <JournalCalendar v-if="tab === 'calendar'" :day="props.day" @pick="pick" />

          <template v-else-if="tab === 'search'">
            <div class="shrink-0 px-3 pb-2">
              <input v-model="typed" v-focus type="search" class="h-11 w-full rounded-xl border border-zinc-300 px-3 text-base" :aria-label="t('finder.search')" />
            </div>
            <div class="min-h-0 flex-1 touch-pan-y overflow-y-auto overscroll-contain pb-[env(safe-area-inset-bottom)]">
              <p v-if="query && !searching && found?.length === 0" class="py-10 text-center text-sm text-zinc-400">{{ t('finder.noResults') }}</p>
              <p v-else-if="total" class="px-3 pb-1 text-xs text-zinc-500">{{ tn('finder.results', total) }}</p>
              <button v-for="e in found ?? []" :key="e.id" class="result" @click="jump(e.id, e.eventAt)">
                <span class="node">{{ emojiOf(e.cardId) }}</span>
                <span class="min-w-0">
                  <span class="block text-xs text-zinc-500">{{ dateTime(e.eventAt) }}</span>
                  <span v-if="shownTags(e.cardId, e.tags).length" class="mt-0.5 flex flex-wrap gap-1">
                    <span v-for="tag in shownTags(e.cardId, e.tags)" :key="tag" class="tag">
                      <template v-for="(p, i) in pieces(tag)" :key="i"><mark v-if="p.hit">{{ p.text }}</mark><template v-else>{{ p.text }}</template></template>
                    </span>
                  </span>
                  <span v-if="e.note" class="note">
                    <template v-for="(p, i) in pieces(e.note)" :key="i"><mark v-if="p.hit">{{ p.text }}</mark><template v-else>{{ p.text }}</template></template>
                  </span>
                </span>
              </button>
              <div ref="end" class="h-px" />
            </div>
          </template>

          <div v-else-if="tab === 'conflicts'" class="min-h-0 flex-1 touch-pan-y overflow-y-auto overscroll-contain pb-[env(safe-area-inset-bottom)]">
            <button v-for="e in conflicts ?? []" :key="e.id" class="result" @click="emit('resolve', e)">
              <span class="node">{{ emojiOf(e.cardId) }}</span>
              <span class="min-w-0">
                <span class="block text-xs text-zinc-500">{{ dateTime(e.eventAt) }}</span>
                <span v-if="shownTags(e.cardId, e.tags).length" class="mt-0.5 flex flex-wrap gap-1">
                  <span v-for="tag in shownTags(e.cardId, e.tags)" :key="tag" class="tag">{{ tag }}</span>
                </span>
                <span v-if="e.note" class="note">{{ e.note }}</span>
              </span>
            </button>
          </div>

          <div v-else class="min-h-0 flex-1 touch-pan-y overflow-y-auto overscroll-contain pb-[env(safe-area-inset-bottom)]">
            <p v-if="media && media.length === 0" class="py-10 text-center text-sm text-zinc-400">{{ t('finder.noMedia') }}</p>
            <section v-for="m in months" :key="m.title">
              <h3 class="month">{{ m.title }}</h3>
              <div class="wall">
                <button v-for="{ index, item } in m.items" :key="item.id" :aria-label="item.name" @click="view(index)">
                  <img v-if="isVisual(item)" :src="previewUrl(item)" alt="" loading="lazy" decoding="async" />
                  <span v-else-if="!isVideo(item)" class="flex size-full flex-col items-center justify-center gap-1 px-1 text-zinc-500">
                    <AttachmentIcon :attachment="item" :size="22" /><span class="w-full truncate text-center text-[11px]">{{ item.name }}</span>
                  </span>
                  <span v-if="isVideo(item)" class="play"><Play :size="20" /></span>
                </button>
              </div>
            </section>
          </div>
        </div>
      </section>
    </div>
  </Teleport>
</template>

<style scoped>
.seg {
  display: flex;
  padding: 3px;
  border-radius: 12px;
  background: #f4f4f5;
}
.seg button {
  display: flex;
  flex: 1 1 auto;
  height: 40px;
  align-items: center;
  justify-content: center;
  gap: 5px;
  padding: 0 6px;
  white-space: nowrap;
  border-radius: 9px;
  color: #52525b;
  font-size: 14px;
}
.seg button.on {
  background: white;
  color: #18181b;
  font-weight: 600;
  box-shadow: 0 1px 3px rgb(0 0 0 / 0.12);
}
.result {
  display: grid;
  width: 100%;
  grid-template-columns: 30px 1fr;
  gap: 8px;
  padding: 10px 12px;
  border-bottom: 1px solid #f4f4f5;
  text-align: left;
}
.node {
  display: grid;
  width: 30px;
  height: 30px;
  place-items: center;
  border-radius: 9999px;
  background: white;
  box-shadow: 0 0 0 1px #e4e4e7;
  font-size: 15px;
}
.tag {
  padding: 1px 8px;
  border-radius: 8px;
  background: #eef2ff;
  color: #4338ca;
  font-size: 13px;
}
.note {
  display: block;
  margin-top: 3px;
  color: #3f3f46;
  font-size: 14px;
  white-space: pre-wrap;
  overflow-wrap: anywhere;
}
mark {
  border-radius: 3px;
  background: #fde68a;
  color: inherit;
}
.month {
  position: sticky;
  top: 0;
  z-index: 1;
  padding: 8px 12px 6px;
  background: rgb(255 255 255 / 0.95);
  color: #52525b;
  font-size: 13px;
  font-weight: 600;
}
.wall {
  display: grid;
  grid-template-columns: repeat(3, minmax(0, 1fr));
  gap: 2px;
}
.wall button {
  position: relative;
  aspect-ratio: 1;
  overflow: hidden;
  background: #e4e4e7;
}
.wall img {
  display: block;
  width: 100%;
  height: 100%;
  object-fit: cover;
}
.play {
  position: absolute;
  inset: 0;
  display: flex;
  align-items: center;
  justify-content: center;
  color: white;
  filter: drop-shadow(0 0 4px rgb(0 0 0 / 0.6));
}
</style>
