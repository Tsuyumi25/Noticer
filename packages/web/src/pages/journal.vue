<script setup lang="ts">
import { useQuery } from '@tanstack/vue-query'
import { computed } from 'vue'
import { useRoute } from 'vue-router'
import { api } from '../api.ts'
import { locale, LOCALES, setLocale, t, type Locale } from '../i18n/index.ts'
import { clock, date } from '../time.ts'

const route = useRoute()

const dayKey = (date: Date) => date.toLocaleDateString('sv-SE')

const day = computed(() => {
  const raw = route.query.day
  const parsed = typeof raw === 'string' && /^\d{4}-\d{2}-\d{2}$/.test(raw) ? new Date(`${raw}T00:00`) : null
  const base = parsed && !Number.isNaN(parsed.getTime()) ? parsed : new Date()
  return new Date(base.getFullYear(), base.getMonth(), base.getDate())
})

const prevDay = computed(() => dayKey(new Date(day.value.getFullYear(), day.value.getMonth(), day.value.getDate() - 1)))
const nextDay = computed(() => dayKey(new Date(day.value.getFullYear(), day.value.getMonth(), day.value.getDate() + 1)))

const label = computed(() => date(day.value.getTime()))

const { data: events, isPending, isError } = useQuery({
  queryKey: computed(() => ['events', dayKey(day.value)]),
  queryFn: async () => {
    const from = day.value.getTime() / 1000
    const res = await api.events.$get({ query: { from: String(from), to: String(from + 86400) } })
    if (!res.ok) throw new Error(`events: ${res.status}`)
    return res.json()
  },
})
</script>

<template>
  <main class="mx-auto flex min-h-dvh max-w-2xl flex-col">
    <header class="sticky top-0 flex items-center justify-between border-b border-zinc-200 bg-white/90 px-2 py-2 backdrop-blur">
      <RouterLink :to="{ query: { day: prevDay } }" class="inline-flex h-11 w-11 items-center justify-center rounded-lg text-xl text-zinc-500 hover:bg-zinc-100" :aria-label="t('journal.prevDay')">‹</RouterLink>
      <h1 class="text-lg font-semibold tabular-nums">{{ label }}</h1>
      <RouterLink :to="{ query: { day: nextDay } }" class="inline-flex h-11 w-11 items-center justify-center rounded-lg text-xl text-zinc-500 hover:bg-zinc-100" :aria-label="t('journal.nextDay')">›</RouterLink>
    </header>

    <p v-if="isPending" class="p-6 text-center text-zinc-400">{{ t('common.loading') }}</p>
    <p v-else-if="isError" class="p-6 text-center text-red-600">{{ t('common.loadFailed') }}</p>
    <p v-else-if="!events?.length" class="p-6 text-center text-zinc-400">{{ t('journal.empty') }}</p>

    <ol v-else class="divide-y divide-zinc-100">
      <li v-for="event in events" :key="event.id" class="flex gap-3 px-4 py-3">
        <time class="w-12 shrink-0 pt-0.5 text-sm text-zinc-500 tabular-nums" :title="event.timeOffset < 0 ? t('journal.backdated') : undefined">
          {{ clock(event.eventAt * 1000) }}<span v-if="event.timeOffset < 0" class="text-amber-500">*</span>
        </time>
        <div class="min-w-0 flex-1 space-y-1">
          <div class="flex flex-wrap gap-1">
            <span v-for="tag in event.tags" :key="tag" class="rounded-full bg-zinc-100 px-2 py-0.5 text-sm">{{ tag }}</span>
          </div>
          <p v-if="event.note" class="text-sm whitespace-pre-wrap text-zinc-700">{{ event.note }}</p>
          <dl v-if="Object.keys(event.facts).length" class="flex flex-wrap gap-x-3 text-xs text-zinc-500">
            <div v-for="(value, key) in event.facts" :key="key" class="flex gap-1">
              <dt>{{ key }}</dt>
              <dd class="font-medium text-zinc-700">{{ value }}</dd>
            </div>
          </dl>
        </div>
      </li>
    </ol>

    <footer class="mt-auto flex items-center justify-center gap-1 border-t border-zinc-100 px-4 py-3 text-sm text-zinc-500">
      <span class="mr-1">{{ t('settings.language') }}</span>
      <button
        v-for="(info, code) in LOCALES"
        :key="code"
        class="h-11 rounded-lg px-3"
        :class="locale === code ? 'bg-zinc-100 font-semibold text-zinc-800' : ''"
        :lang="code"
        @click="setLocale(code as Locale)"
      >
        {{ info.name }}
      </button>
    </footer>
  </main>
</template>
