<script setup lang="ts">
import { Check } from 'lucide-vue-next'
import { locale, LOCALES, setLocale, t, type Locale } from '../i18n/index.ts'

const locales = Object.entries(LOCALES) as [Locale, (typeof LOCALES)[Locale]][]
</script>

<template>
  <main class="mx-auto flex min-h-dvh max-w-2xl flex-col bg-zinc-50">
    <header class="sticky top-0 border-b border-zinc-200 bg-white/90 px-4 py-3 backdrop-blur">
      <h1 class="text-lg font-semibold">{{ t('nav.settings') }}</h1>
    </header>

    <section class="mt-4">
      <h2 class="px-4 pb-1 text-sm text-zinc-500">{{ t('settings.language') }}</h2>
      <ul class="divide-y divide-zinc-100 border-y border-zinc-200 bg-white">
        <li v-for="[code, info] in locales" :key="code">
          <button class="flex h-12 w-full items-center justify-between px-4" :lang="code" @click="setLocale(code)">
            {{ info.name }}
            <Check v-if="locale === code" :size="20" class="text-indigo-600" />
          </button>
        </li>
      </ul>
    </section>
  </main>
</template>
