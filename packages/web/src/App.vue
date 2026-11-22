<script setup lang="ts">
import { useQuery } from '@tanstack/vue-query'
import { BookOpen, House, Plus, Settings } from 'lucide-vue-next'
import { ref, type Component } from 'vue'
import { useRoute } from 'vue-router'
import QuickNoteSheet from './components/QuickNoteSheet.vue'
import { t, type MessageKey } from './i18n/index.ts'
import { conflictsQuery } from './queries.ts'
import { dayKey, parseDayKey, sameTimeOn } from './time.ts'
import { isDesktop } from './viewport.ts'

const { data: conflicts } = useQuery(conflictsQuery)

type Tab = { to: string; icon: Component; label: MessageKey }
const before: Tab[] = [
  { to: '/', icon: House, label: 'nav.home' },
  { to: '/journal', icon: BookOpen, label: 'nav.journal' },
]
const after: Tab[] = [{ to: '/settings', icon: Settings, label: 'nav.settings' }]
const quickNote = ref(false)

// On a past day of the journal, a note starts at that day's version of now: what you add there fills in that day.
const route = useRoute()
const quickNoteAt = ref<number | undefined>()
function openQuickNote() {
  const day = route.path === '/journal' ? parseDayKey(route.query.day) : null
  const now = Date.now()
  quickNoteAt.value = day && dayKey(day) < dayKey(new Date(now)) ? sameTimeOn(day, now) : undefined
  quickNote.value = true
}
</script>

<template>
  <header v-if="isDesktop" class="sticky top-0 z-10 flex h-14 items-center gap-1 border-b border-zinc-200 bg-white/95 px-4 backdrop-blur">
    <span class="mr-4 text-base font-bold">💧 Noticer</span>
    <RouterLink
      v-for="tab in [...before, ...after]"
      :key="tab.to"
      :to="tab.to"
      class="flex h-11 items-center gap-2 rounded-lg px-3 text-sm text-zinc-600 hover:bg-zinc-100"
      exact-active-class="!bg-indigo-50 !text-indigo-700 font-semibold"
    >
      <span class="relative">
        <component :is="tab.icon" :size="18" />
        <span
          v-if="tab.to === '/journal' && conflicts?.length"
          class="absolute -top-1.5 left-3 h-4 min-w-4 rounded-full bg-amber-500 px-1 text-center text-[10.5px] leading-4 font-bold text-white"
        >
          {{ conflicts.length }}
        </span>
      </span>
      {{ t(tab.label) }}
    </RouterLink>
    <span class="flex-1" />
    <button class="flex h-11 items-center gap-1.5 rounded-lg bg-indigo-600 px-3.5 text-sm font-semibold text-white" @click="openQuickNote">
      <Plus :size="18" />{{ t('nav.quickNote') }}
    </button>
  </header>
  <div :class="isDesktop ? '' : 'min-h-dvh pb-[calc(64px+env(safe-area-inset-bottom))]'">
    <RouterView />
  </div>
  <nav
    v-if="!isDesktop"
    class="fixed inset-x-0 bottom-0 z-10 flex border-t border-zinc-200 bg-white/95 pb-[env(safe-area-inset-bottom)] backdrop-blur"
  >
    <RouterLink
      v-for="tab in before"
      :key="tab.to"
      :to="tab.to"
      class="flex h-16 flex-1 flex-col items-center justify-center gap-1 text-xs text-zinc-500"
      exact-active-class="!text-indigo-600 font-semibold"
    >
      <span class="relative">
        <component :is="tab.icon" :size="22" />
        <span
          v-if="tab.to === '/journal' && conflicts?.length"
          class="absolute -top-1.5 left-4 h-4 min-w-4 rounded-full bg-amber-500 px-1 text-center text-[10.5px] leading-4 font-bold text-white"
        >
          {{ conflicts.length }}
        </span>
      </span>
      {{ t(tab.label) }}
    </RouterLink>
    <button class="flex h-16 flex-1 flex-col items-center justify-center gap-1 text-xs text-zinc-500" @click="openQuickNote">
      <span class="flex h-7 w-11 items-center justify-center rounded-full bg-indigo-600 text-white"><Plus :size="20" /></span>
      {{ t('nav.quickNote') }}
    </button>
    <RouterLink
      v-for="tab in after"
      :key="tab.to"
      :to="tab.to"
      class="flex h-16 flex-1 flex-col items-center justify-center gap-1 text-xs text-zinc-500"
      exact-active-class="!text-indigo-600 font-semibold"
    >
      <component :is="tab.icon" :size="22" />
      {{ t(tab.label) }}
    </RouterLink>
  </nav>
  <QuickNoteSheet v-if="quickNote" :at="quickNoteAt" @close="quickNote = false" />
</template>
