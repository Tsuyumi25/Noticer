<script setup lang="ts">
import { useQuery } from '@tanstack/vue-query'
import { computed, onMounted, onUnmounted } from 'vue'
import { api } from '../api.ts'
import { t } from '../i18n/index.ts'
import { clock, date as formatDate } from '../time.ts'

const props = defineProps<{ cardId: string; cardTag: string; date: string }>()
const emit = defineEmits<{ close: [] }>()

const start = computed(() => new Date(`${props.date}T00:00`))
const range = computed(() => {
  const s = start.value
  return { from: s.getTime() / 1000, to: new Date(s.getFullYear(), s.getMonth(), s.getDate() + 1).getTime() / 1000 }
})

const { data: events, isPending } = useQuery({
  queryKey: computed(() => ['events', 'card', props.cardId, props.date]),
  queryFn: async () => {
    const { from, to } = range.value
    const res = await api.cards[':cardId'].events.$get({ param: { cardId: props.cardId }, query: { from: String(from), to: String(to) } })
    if (!res.ok) throw new Error(`events: ${res.status}`)
    return res.json()
  },
})

const { data: inputs } = useQuery({
  queryKey: computed(() => ['cardInputs', props.cardId]),
  queryFn: async () => {
    const res = await api.cards[':cardId'].inputs.$get({ param: { cardId: props.cardId } })
    if (!res.ok) throw new Error(`inputs: ${res.status}`)
    return res.json()
  },
})

function factLabel(key: string, value: string | number | boolean): string {
  const input = inputs.value?.find((i) => i.key === key)
  if (!input) return `${key} ${value}`
  if (input.kind === 'choice') return `${value} ${input.options.find((o) => o.value === value)?.label ?? ''}`.trim()
  return `${input.name} ${value} ${input.unit}`
}

function onKeydown(e: KeyboardEvent) {
  if (e.key !== 'Escape') return
  e.stopImmediatePropagation()
  emit('close')
}
onMounted(() => window.addEventListener('keydown', onKeydown, true))
onUnmounted(() => window.removeEventListener('keydown', onKeydown, true))
</script>

<template>
  <Teleport to="body">
    <div class="fixed inset-0 z-50 flex items-end bg-black/40" @click.self="emit('close')">
      <section class="flex max-h-[75dvh] w-full flex-col rounded-t-2xl bg-white pb-[env(safe-area-inset-bottom)]">
        <div class="mx-auto mt-2 h-1 w-10 shrink-0 rounded-full bg-zinc-300" />
        <h2 class="shrink-0 px-4 pt-2 pb-1 text-base font-semibold">
          {{ formatDate(start.getTime(), true) }}
        </h2>
        <div class="min-h-0 flex-1 overflow-y-auto overscroll-contain">
          <p v-if="isPending" class="p-6 text-center text-zinc-400">{{ t('common.loading') }}</p>
          <p v-else-if="!events?.length" class="p-6 text-center text-zinc-400">{{ t('review.dayEmpty') }}</p>
          <ol v-else class="divide-y divide-zinc-100">
            <li v-for="event in events" :key="event.id" class="flex gap-3 px-4 py-3">
              <time class="w-12 shrink-0 pt-0.5 text-sm text-zinc-500 tabular-nums">
                {{ clock(event.eventAt * 1000) }}<span v-if="event.timeOffset < 0" class="text-amber-500">*</span>
              </time>
              <div class="min-w-0 flex-1 space-y-1">
                <div class="flex flex-wrap gap-1">
                  <span v-for="tag in event.tags.filter((x) => x !== cardTag)" :key="tag" class="rounded-full bg-zinc-100 px-2 py-0.5 text-sm">{{ tag }}</span>
                </div>
                <p v-if="event.note" class="text-sm whitespace-pre-wrap text-zinc-700">{{ event.note }}</p>
                <p v-if="Object.keys(event.facts).length" class="flex flex-wrap gap-x-3 text-sm text-zinc-600">
                  <span v-for="(value, key) in event.facts" :key="key">{{ factLabel(String(key), value) }}</span>
                </p>
              </div>
            </li>
          </ol>
        </div>
        <div class="shrink-0 border-t border-zinc-200 px-4 pt-3 pb-3">
          <button class="h-12 w-full rounded-xl bg-zinc-100 font-semibold" @click="emit('close')">{{ t('common.close') }}</button>
        </div>
      </section>
    </div>
  </Teleport>
</template>
