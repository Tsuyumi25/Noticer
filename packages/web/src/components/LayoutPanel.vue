<script setup lang="ts">
import type { Layout } from 'server/config'
import { computed, onMounted, onUnmounted } from 'vue'
import { arranging, pinsDropped } from '../arranging.ts'
import { t, type MessageKey } from '../i18n/index.ts'
import { useLayoutSave } from '../layoutSave.ts'
import StripOptions from './StripOptions.vue'

const props = defineProps<{ layout: Layout }>()

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
  {
    field: 'align',
    label: 'layout.align',
    options: [
      { value: 'left', label: 'layout.alignLeft' },
      { value: 'center', label: 'layout.alignCenter' },
      { value: 'right', label: 'layout.alignRight' },
    ],
  },
])

type Scale = 'cardScale' | 'maxScale'
const sliders = computed(() => [
  { key: 'cardScale' as Scale, label: 'layout.cardScale' as MessageKey, min: 0.8 },
  ...(props.layout.arrangement === 'stack' ? [{ key: 'maxScale' as Scale, label: 'layout.maxScale' as MessageKey, min: 1 }] : []),
])

const { show, save } = useLayoutSave()

function choose(field: Choice['field'], value: string) {
  save({ ...props.layout, [field]: value } as Layout)
}

const stacked = computed(() => props.layout.arrangement === 'stack')

function onKeydown(e: KeyboardEvent) {
  if (e.key === 'Escape') arranging.value = false
}
onMounted(() => window.addEventListener('keydown', onKeydown))
onUnmounted(() => window.removeEventListener('keydown', onKeydown))
</script>

<template>
  <aside :aria-label="t('layout.title')" class="flex min-h-0 flex-col overflow-hidden rounded-2xl bg-white shadow-lg">
    <h2 class="shrink-0 px-4 pt-4 pb-3 text-[15px] font-bold">{{ t('layout.title') }}</h2>
    <div class="min-h-0 flex-1 overflow-y-auto overscroll-contain px-4 pb-4">
      <template v-if="stacked">
        <p class="text-sm text-zinc-500">{{ t('layout.editHint') }}</p>
        <p v-if="pinsDropped" class="mt-2 rounded-lg bg-amber-50 px-3 py-2 text-sm text-amber-800">{{ t('layout.pinsDropped') }}</p>
      </template>
      <template v-for="(p, i) in picks" :key="p.field">
        <p class="mb-2 text-xs font-semibold text-zinc-500" :class="i > 0 || stacked ? 'mt-4' : ''">{{ t(p.label) }}</p>
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
          @change="save({ ...layout, [s.key]: Number(($event.target as HTMLInputElement).value) })"
        />
      </div>
      <p class="mt-5 mb-3 border-t border-zinc-100 pt-4 text-sm font-semibold text-zinc-700">{{ t('strip.title') }}</p>
      <StripOptions />
    </div>
  </aside>
</template>
