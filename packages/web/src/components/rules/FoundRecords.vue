<script setup lang="ts">
import { ChevronRight, ListChecks } from 'lucide-vue-next'
import { computed } from 'vue'
import { t } from '../../i18n/index.ts'
import { useRules } from './context.ts'

const { data, draft, tab, picker, findOf, counted } = useRules()

const found = computed(() => counted(findOf(draft.value, tab.value)).length)
</script>

<template>
  <section class="mx-4 mt-6">
    <button
      class="flex min-h-14 w-full items-center gap-3 rounded-xl border border-zinc-200 bg-white px-4"
      @click="picker = { kind: 'records', tab }"
    >
      <span class="inline-flex h-8 w-8 shrink-0 items-center justify-center rounded-lg bg-zinc-100 text-zinc-600"><ListChecks :size="18" /></span>
      <span class="flex-1 text-left">{{ t('rules.find.found') }}</span>
      <span class="flex items-center gap-1 text-zinc-500 tabular-nums">
        {{ t('rules.find.foundValue', { n: found, total: data.events.length }) }}<ChevronRight :size="18" class="text-zinc-400" />
      </span>
    </button>
  </section>
</template>
