<script setup lang="ts">
import { useMutation, useQuery, useQueryClient } from '@tanstack/vue-query'
import type { Config, StripStyle } from 'server/config'
import { api } from '../api.ts'
import { t, type MessageKey } from '../i18n/index.ts'
import { configQuery } from '../queries.ts'

const { data: config } = useQuery(configQuery)

const choices: { field: keyof StripStyle; label: MessageKey; options: { value: string; label: MessageKey }[] }[] = [
  {
    field: 'look',
    label: 'strip.look',
    options: [
      { value: 'blend', label: 'strip.lookBlend' },
      { value: 'thin', label: 'strip.lookThin' },
      { value: 'cells', label: 'strip.lookCells' },
    ],
  },
  {
    field: 'weight',
    label: 'strip.weight',
    options: [
      { value: 'thick', label: 'strip.weightThick' },
      { value: 'thin', label: 'strip.weightThin' },
    ],
  },
  {
    field: 'side',
    label: 'strip.side',
    options: [
      { value: 'left', label: 'strip.sideLeft' },
      { value: 'right', label: 'strip.sideRight' },
    ],
  },
]

const queryClient = useQueryClient()
const save = useMutation({
  mutationFn: async (next: StripStyle) => {
    const res = await api.strip.$put({ json: next })
    if (!res.ok) throw new Error(`strip: ${res.status}`)
  },
  onError: () => queryClient.invalidateQueries({ queryKey: ['config'] }),
})

function choose(field: keyof StripStyle, value: string) {
  if (!config.value) return
  const next = { ...config.value.strip, [field]: value } as StripStyle
  queryClient.setQueryData<Config>(['config'], (old) => old && { ...old, strip: next })
  save.mutate(next)
}
</script>

<template>
  <div v-if="config" class="space-y-3">
    <div v-for="choice in choices" :key="choice.field">
      <p class="mb-1.5 text-xs font-semibold text-zinc-500">{{ t(choice.label) }}</p>
      <div class="flex rounded-xl bg-zinc-100 p-1">
        <button
          v-for="o in choice.options"
          :key="o.value"
          class="h-11 flex-1 rounded-lg text-sm"
          :class="config.strip[choice.field] === o.value ? 'bg-white font-semibold text-zinc-900 shadow-sm' : 'text-zinc-600'"
          @click="choose(choice.field, o.value)"
        >
          {{ t(o.label) }}
        </button>
      </div>
    </div>
  </div>
</template>
