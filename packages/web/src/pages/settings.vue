<script setup lang="ts">
import { useQuery } from '@tanstack/vue-query'
import { Check, ChevronRight, Plus } from 'lucide-vue-next'
import { computed, ref } from 'vue'
import { useRoute, useRouter } from 'vue-router'
import { api } from '../api.ts'
import CardBuilderSheet from '../components/CardBuilderSheet.vue'
import RulesSheet from '../components/RulesSheet.vue'
import { locale, LOCALES, setLocale, t, type Locale } from '../i18n/index.ts'
import { isDesktop } from '../viewport.ts'

const locales = Object.entries(LOCALES) as [Locale, (typeof LOCALES)[Locale]][]

const { data: cards } = useQuery({
  queryKey: ['cards'],
  queryFn: async () => {
    const res = await api.cards.$get()
    if (!res.ok) throw new Error(`cards: ${res.status}`)
    return res.json()
  },
})

const route = useRoute()
const router = useRouter()
const editing = computed(() => (typeof route.query.card === 'string' ? route.query.card : null))
const openCard = (cardId: string) => router.push({ query: { card: cardId } })
const building = ref(false)
function closeCard() {
  if (window.history.state?.back) router.back()
  else router.replace({ query: {} })
}
</script>

<template>
  <main class="mx-auto flex max-w-2xl flex-col bg-zinc-50 pb-6" :class="isDesktop ? 'min-h-full' : 'min-h-dvh'">
    <header class="sticky top-0 border-b border-zinc-200 bg-white/90 px-4 py-3 backdrop-blur">
      <h1 class="text-lg font-semibold">{{ t('nav.settings') }}</h1>
    </header>

    <section class="mt-4">
      <h2 class="px-4 pb-1 text-sm text-zinc-500">{{ t('settings.cards') }}</h2>
      <ul class="divide-y divide-zinc-100 border-y border-zinc-200 bg-white">
        <li v-for="card in cards ?? []" :key="card.id">
          <button
            class="flex h-12 w-full items-center justify-between px-4 disabled:text-zinc-400"
            :disabled="card.builtin"
            @click="openCard(card.id)"
          >
            <span>{{ card.emoji }} {{ card.name }}</span>
            <span v-if="card.builtin" class="text-sm">{{ t('settings.builtin') }}</span>
            <ChevronRight v-else :size="20" class="text-zinc-400" />
          </button>
        </li>
        <li>
          <button class="flex h-12 w-full items-center gap-2 px-4 text-indigo-600" @click="building = true">
            <Plus :size="20" />{{ t('settings.addCard') }}
          </button>
        </li>
      </ul>
    </section>

    <section class="mt-6">
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

    <CardBuilderSheet v-if="building" @close="building = false" />
    <RulesSheet v-if="editing" :key="editing" :card-id="editing" @close="closeCard" />
  </main>
</template>
