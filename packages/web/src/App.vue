<script setup lang="ts">
import { BookOpen, House, Settings } from 'lucide-vue-next'
import type { Component } from 'vue'
import { t, type MessageKey } from './i18n/index.ts'

const tabs: { to: string; icon: Component; label: MessageKey }[] = [
  { to: '/', icon: House, label: 'nav.home' },
  { to: '/journal', icon: BookOpen, label: 'nav.journal' },
  { to: '/settings', icon: Settings, label: 'nav.settings' },
]
</script>

<template>
  <div class="min-h-dvh pb-[calc(64px+env(safe-area-inset-bottom))]">
    <RouterView />
  </div>
  <nav
    class="fixed inset-x-0 bottom-0 z-10 flex border-t border-zinc-200 bg-white/95 pb-[env(safe-area-inset-bottom)] backdrop-blur"
  >
    <RouterLink
      v-for="tab in tabs"
      :key="tab.to"
      :to="tab.to"
      class="flex h-16 flex-1 flex-col items-center justify-center gap-1 text-xs text-zinc-500"
      exact-active-class="!text-indigo-600 font-semibold"
    >
      <component :is="tab.icon" :size="22" />
      {{ t(tab.label) }}
    </RouterLink>
  </nav>
</template>
