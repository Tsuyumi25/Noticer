<script setup lang="ts">
import { useInfiniteQuery, useQuery } from '@tanstack/vue-query'
import { CircleQuestionMark, Search, X } from 'lucide-vue-next'
import type { CardConfig } from 'server/config'
import type { EventRecord } from 'server/events'
import { PURE_CARD } from 'server/pure'
import { parseValueKey } from 'server/values'
import { computed, onMounted, onUnmounted, ref, watch } from 'vue'
import { api } from '../api.ts'
import { t } from '../i18n/index.ts'
import { configQuery } from '../queries.ts'
import { clock, date, dayName, startOfDay } from '../time.ts'
import type { ConflictEvent } from '../versions.ts'

const emit = defineEmits<{ edit: [event: ConflictEvent] }>()

const RECENT_DAYS = 7

const { data: config } = useQuery(configQuery)
const cards = computed(() => new Map((config.value?.cards ?? []).map((c) => [c.id, c as CardConfig])))

const { data: recent, isPending: recentPending } = useQuery({
  queryKey: ['events', 'recent'],
  queryFn: async () => {
    const now = Math.floor(Date.now() / 1000)
    const res = await api.events.$get({ query: { from: String(now - RECENT_DAYS * 86400), to: String(now + 1) } })
    if (!res.ok) throw new Error(`events: ${res.status}`)
    return (await res.json()).reverse()
  },
})

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

const searching = computed(() => query.value !== '')
const list = computed<EventRecord[] | undefined>(() => (searching.value ? search.data.value?.pages.flatMap((p) => p.events) : recent.value))
const pending = computed(() => (searching.value ? search.isPending.value : recentPending.value))

function valuesOf(event: EventRecord): string[] {
  const card = cards.value.get(event.cardId)
  const specs = card ? (config.value?.tagGroups[card.root]?.values ?? {}) : {}
  return Object.entries(event.facts).flatMap(([key, value]) => {
    const parsed = parseValueKey(key)
    if (!parsed || typeof value !== 'number') return []
    const decimals = specs[parsed.tag]?.decimals
    return [`${decimals === undefined ? value : value.toFixed(decimals)}${parsed.unit}`]
  })
}

const rows = computed(() => {
  const now = Date.now()
  let day = -1
  return (list.value ?? []).map((event) => {
    const ms = event.eventAt * 1000
    const start = startOfDay(ms)
    const header = start !== day ? `${dayName(ms, now)}${dayName(ms, now) === date(ms) ? '' : ` · ${date(ms)}`}` : null
    day = start
    const card = cards.value.get(event.cardId)
    return {
      event,
      header,
      emoji: event.cardId === PURE_CARD ? '📝' : (card?.emoji ?? '•'),
      tags: event.tags.filter((tag) => tag !== card?.root),
      values: valuesOf(event),
      note: event.note?.split('\n')[0] ?? '',
    }
  })
})

const end = ref<HTMLElement | null>(null)
const observer = new IntersectionObserver((entries) => {
  if (entries.some((e) => e.isIntersecting) && search.hasNextPage.value && !search.isFetchingNextPage.value) void search.fetchNextPage()
})
watch(end, (el, old) => {
  if (old) observer.unobserve(old)
  if (el) observer.observe(el)
})
onMounted(() => end.value && observer.observe(end.value))
onUnmounted(() => observer.disconnect())
</script>

<template>
  <aside class="flex min-h-0 flex-col overflow-hidden rounded-2xl bg-white shadow-lg">
    <div class="shrink-0 px-4 pt-4 pb-3">
      <h2 class="mb-3 text-[15px] font-bold">{{ t('desktop.recent') }}</h2>
      <label class="group relative flex h-11 items-center rounded-xl bg-zinc-100 ring-indigo-300 transition focus-within:bg-white focus-within:ring-2">
        <Search :size="18" class="pointer-events-none absolute left-3 text-zinc-400 group-focus-within:text-indigo-500" />
        <input
          v-model="typed"
          type="search"
          class="h-full w-full appearance-none bg-transparent pr-11 pl-10 text-sm outline-none placeholder:text-zinc-400 [&::-webkit-search-cancel-button]:hidden"
          :placeholder="t('desktop.searchPlaceholder')"
        />
        <button
          v-if="typed"
          class="absolute right-0 flex h-11 w-11 items-center justify-center rounded-xl text-zinc-400 hover:text-zinc-700"
          :aria-label="t('desktop.clearSearch')"
          @click="typed = ''"
        >
          <X :size="18" />
        </button>
      </label>
    </div>
    <div class="min-h-0 flex-1 overflow-y-auto pb-2">
      <p v-if="pending" class="px-4 py-6 text-center text-sm text-zinc-400">{{ t('common.loading') }}</p>
      <p v-else-if="!rows.length" class="px-4 py-6 text-center text-sm text-zinc-400">{{ t(searching ? 'finder.noResults' : 'desktop.noRecent') }}</p>
      <template v-for="row in rows" :key="row.event.id">
        <h3 v-if="row.header" class="sticky top-0 z-[1] bg-white/95 px-4 pt-3 pb-1 text-xs font-semibold text-zinc-500 backdrop-blur">{{ row.header }}</h3>
        <button class="row" @click="emit('edit', row.event)">
          <span class="font-mono text-[13px] font-semibold text-zinc-700">{{ clock(row.event.eventAt * 1000) }}</span>
          <span class="relative text-center text-lg leading-none">
            {{ row.emoji }}
            <CircleQuestionMark v-if="row.event.versions.length" :size="13" :stroke-width="2.75" class="absolute -top-1 -right-1 rounded-full bg-white text-orange-500" />
          </span>
          <span class="flex min-w-0 gap-1 overflow-hidden">
            <span v-for="tag in row.tags" :key="tag" class="shrink-0 rounded-md bg-zinc-100 px-1.5 py-0.5 text-xs text-zinc-700">{{ tag }}</span>
            <span v-for="v in row.values" :key="v" class="shrink-0 font-mono text-xs font-semibold text-indigo-700">{{ v }}</span>
          </span>
          <span class="truncate text-xs text-zinc-500">{{ row.note }}</span>
        </button>
      </template>
      <div v-if="searching" ref="end" class="h-4" />
    </div>
  </aside>
</template>

<style scoped>
.row {
  display: grid;
  grid-template-columns: 44px 26px auto minmax(0, 1fr);
  align-items: center;
  gap: 8px;
  width: 100%;
  min-height: 44px;
  padding: 0 16px;
  text-align: left;
}
.row:hover {
  background: #f5f3ff;
}
</style>
