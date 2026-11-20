<script setup lang="ts">
import type { ValueInput } from 'server/facts'
import { computed, ref, type Component } from 'vue'
import { t } from '../i18n/index.ts'

/** The keypad that replaces the sheet's footer while one tag's value is being set; `row` is a card's own row in place of the usual amounts. */
const props = defineProps<{ input: ValueInput; label: string; value: number | null; row?: Component }>()
const emit = defineEmits<{ done: [value: number | null]; remove: []; cancel: [] }>()

const base = ref(props.value)
/** Digits typed since the pad opened; null until the first key. */
const typed = ref<string | null>(null)

const format = (v: number) => v.toFixed(props.input.decimals)
const current = computed(() => (typed.value !== null ? (typed.value === '' ? null : Number(typed.value)) : base.value))
const shown = computed(() => typed.value ?? (base.value === null ? '' : format(base.value)))

function key(d: string) {
  const s = typed.value ?? ''
  if (d === '.' && (props.input.decimals === 0 || s.includes('.'))) return
  const next = (s === '' && d === '.' ? '0' : s) + d
  const dot = next.indexOf('.')
  if (dot >= 0 && next.length - dot - 1 > props.input.decimals) return
  if (next.replace('.', '').length <= 7) typed.value = next
}

function backspace() {
  typed.value = (typed.value ?? shown.value).slice(0, -1)
}

function setBase(v: number) {
  base.value = v
  typed.value = null
}
</script>

<template>
  <div class="shrink-0 border-t border-zinc-200 bg-white px-4 pt-2">
    <div class="flex items-baseline justify-between">
      <span class="font-semibold">{{ label }}</span>
      <span class="text-xs text-zinc-500">{{ input.unit }} · {{ t(input.keep === 'sum' ? 'pad.sum' : 'pad.latest') }}</span>
    </div>
    <div class="text-center text-[34px] leading-tight font-bold tabular-nums" :class="shown === '' ? 'text-zinc-300' : 'text-indigo-700'">
      {{ shown === '' ? '—' : shown }}<span class="ml-1 text-base font-medium text-zinc-500">{{ input.unit }}</span>
    </div>
    <div v-if="row" class="row">
      <component :is="row" :value="current" :fallback="input.default" :decimals="input.decimals" @set="setBase" />
    </div>
    <div v-else-if="input.candidates.length" class="row">
      <button v-for="c in input.candidates" :key="c" class="fine" :class="{ on: typed === null && base === c }" @click="emit('done', c)">{{ format(c) }}</button>
    </div>
    <div class="keys">
      <button v-for="n in [1, 2, 3]" :key="n" @click="key(String(n))">{{ n }}</button>
      <button class="op" @click="typed = ''">AC</button>
      <button v-for="n in [4, 5, 6]" :key="n" @click="key(String(n))">{{ n }}</button>
      <button class="op" @click="backspace">⌫</button>
      <button v-for="n in [7, 8, 9]" :key="n" @click="key(String(n))">{{ n }}</button>
      <button class="op" @click="emit('done', null)">{{ t('pad.skip') }}</button>
      <button :disabled="input.decimals === 0" class="disabled:opacity-30" @click="key('.')">.</button>
      <button @click="key('0')">0</button>
      <button @click="key('00')">00</button>
      <button class="op text-red-600" @click="emit('remove')">{{ t('pad.remove') }}</button>
    </div>
    <div class="grid grid-cols-2 gap-3 pt-3 pb-[calc(0.75rem+env(safe-area-inset-bottom))]">
      <button class="h-12 rounded-xl bg-zinc-100 font-semibold" @click="emit('cancel')">{{ t('common.cancel') }}</button>
      <button class="h-12 rounded-xl bg-indigo-600 font-semibold text-white" @click="emit('done', current)">{{ t('common.ok') }}</button>
    </div>
  </div>
</template>

<style scoped>
.row {
  display: flex;
  gap: 8px;
  margin: 4px 0 8px;
}
.row :deep(.fine) {
  flex: 1;
  height: 44px;
  border: 1px solid #e5e7eb;
  border-radius: 10px;
  background: #f8fafc;
  font-size: 15px;
  font-variant-numeric: tabular-nums;
}
.row :deep(.fine.on) {
  border-color: #a5b4fc;
  background: #eef2ff;
  color: #3730a3;
  font-weight: 600;
}
.keys {
  display: grid;
  grid-template-columns: repeat(4, 1fr);
  grid-auto-rows: 46px;
  gap: 8px;
}
.keys button {
  border-radius: 12px;
  background: #f4f4f5;
  font-size: 22px;
}
.keys .op {
  background: #e0e7ff;
  color: #3730a3;
  font-size: 17px;
}
.keys .op.text-red-600 {
  color: #dc2626;
}
</style>
