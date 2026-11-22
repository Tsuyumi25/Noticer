<script setup lang="ts">
import { useMutation, useQueryClient } from '@tanstack/vue-query'
import type { Config, Layout } from 'server/config'
import { computed, onMounted, onUnmounted, ref } from 'vue'
import { api } from '../api.ts'
import { t, type MessageKey } from '../i18n/index.ts'
import StripOptions from './StripOptions.vue'

const props = defineProps<{ layout: Layout }>()
const emit = defineEmits<{ close: [] }>()

type Choice = { field: 'arrangement' | 'align'; options: { value: string; label: MessageKey }[]; label: MessageKey }
const picks = computed<Choice[]>(() => [
  {
    field: 'arrangement',
    label: 'layout.arrangement',
    options: [
      { value: 'stack', label: 'layout.stack' },
      { value: 'sections', label: 'layout.sections' },
    ],
  },
  ...(props.layout.arrangement === 'stack'
    ? [
        {
          field: 'align' as const,
          label: 'layout.align' as MessageKey,
          options: [
            { value: 'left', label: 'layout.alignLeft' as MessageKey },
            { value: 'center', label: 'layout.alignCenter' as MessageKey },
            { value: 'right', label: 'layout.alignRight' as MessageKey },
          ],
        },
      ]
    : []),
])

type Scale = 'cardScale' | 'maxScale'
const sliders = computed(() => [
  { key: 'cardScale' as Scale, label: 'layout.cardScale' as MessageKey, min: 0.8 },
  ...(props.layout.arrangement === 'stack' ? [{ key: 'maxScale' as Scale, label: 'layout.maxScale' as MessageKey, min: 1 }] : []),
])

const queryClient = useQueryClient()
const show = (next: Layout) => queryClient.setQueryData<Config>(['config'], (config) => config && { ...config, layout: next })
const save = useMutation({
  mutationFn: async (next: Layout) => {
    const res = await api.layout.$put({ json: next })
    if (!res.ok) throw new Error(`layout: ${res.status}`)
  },
  onError: () => queryClient.invalidateQueries({ queryKey: ['config'] }),
})

function choose(field: Choice['field'], value: string) {
  const next = { ...props.layout, [field]: value } as Layout
  show(next)
  save.mutate(next)
}

const root = ref<HTMLElement | null>(null)
function onPointerDown(e: PointerEvent) {
  if (root.value && !root.value.contains(e.target as Node) && !(e.target as Element).closest('[data-layout-toggle]')) emit('close')
}
function onKeydown(e: KeyboardEvent) {
  if (e.key === 'Escape') emit('close')
}
onMounted(() => {
  document.addEventListener('pointerdown', onPointerDown)
  window.addEventListener('keydown', onKeydown)
})
onUnmounted(() => {
  document.removeEventListener('pointerdown', onPointerDown)
  window.removeEventListener('keydown', onKeydown)
})
</script>

<template>
  <div
    ref="root"
    role="dialog"
    :aria-label="t('layout.title')"
    class="absolute top-14 right-0 z-20 max-h-[calc(100%-3.5rem)] w-80 overflow-y-auto overscroll-contain rounded-2xl bg-white p-4 shadow-xl"
  >
    <template v-for="(p, i) in picks" :key="p.field">
      <p class="mb-2 text-xs font-semibold text-zinc-500" :class="{ 'mt-4': i > 0 }">{{ t(p.label) }}</p>
      <div class="flex rounded-xl bg-zinc-100 p-1">
        <button
          v-for="o in p.options"
          :key="o.value"
          class="h-11 flex-1 rounded-lg text-sm"
          :class="layout[p.field] === o.value ? 'bg-white font-semibold text-zinc-900 shadow-sm' : 'text-zinc-600'"
          @click="choose(p.field, o.value)"
        >
          {{ t(o.label) }}
        </button>
      </div>
    </template>
    <div v-for="s in sliders" :key="s.key" class="mt-4">
      <p class="mb-1 flex items-baseline justify-between text-xs font-semibold text-zinc-500">
        {{ t(s.label) }}
        <span class="font-mono text-sm text-indigo-700">{{ t('layout.times', { n: layout[s.key].toFixed(2) }) }}</span>
      </p>
      <input
        type="range"
        :min="s.min"
        max="1.6"
        step="0.05"
        class="h-11 w-full accent-indigo-600"
        :value="layout[s.key]"
        @input="show({ ...layout, [s.key]: Number(($event.target as HTMLInputElement).value) })"
        @change="save.mutate({ ...layout, [s.key]: Number(($event.target as HTMLInputElement).value) })"
      />
    </div>
    <p class="mt-5 mb-3 border-t border-zinc-100 pt-4 text-sm font-semibold text-zinc-700">{{ t('strip.title') }}</p>
    <StripOptions />
  </div>
</template>
