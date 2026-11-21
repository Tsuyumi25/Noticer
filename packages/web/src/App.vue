<script setup lang="ts">
import { BookOpen, House, Plus, Settings } from 'lucide-vue-next'
import { ref, type Component } from 'vue'
import QuickNoteSheet from './components/QuickNoteSheet.vue'
import { t, type MessageKey } from './i18n/index.ts'

type Tab = { to: string; icon: Component; label: MessageKey }
const before: Tab[] = [
  { to: '/', icon: House, label: 'nav.home' },
  { to: '/journal', icon: BookOpen, label: 'nav.journal' },
]
const after: Tab[] = [{ to: '/settings', icon: Settings, label: 'nav.settings' }]
const quickNote = ref(false)
</script>

<template>
  <div class="min-h-dvh pb-[calc(64px+env(safe-area-inset-bottom))]">
    <RouterView />
  </div>
  <nav
    class="fixed inset-x-0 bottom-0 z-10 flex border-t border-zinc-200 bg-white/95 pb-[env(safe-area-inset-bottom)] backdrop-blur"
  >
    <RouterLink
      v-for="tab in before"
      :key="tab.to"
      :to="tab.to"
      class="flex h-16 flex-1 flex-col items-center justify-center gap-1 text-xs text-zinc-500"
      exact-active-class="!text-indigo-600 font-semibold"
    >
      <component :is="tab.icon" :size="22" />
      {{ t(tab.label) }}
    </RouterLink>
    <button class="flex h-16 flex-1 flex-col items-center justify-center gap-1 text-xs text-zinc-500" @click="quickNote = true">
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
  <QuickNoteSheet v-if="quickNote" @close="quickNote = false" />
</template>
