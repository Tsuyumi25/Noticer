<script setup lang="ts">
import { RotateCcw } from 'lucide-vue-next'
import type { CardInput } from 'server/facts'
import { computed, ref, watch } from 'vue'
import { t } from '../i18n/index.ts'

type NumberInputConfig = Extract<CardInput, { kind: 'number' }>

const props = defineProps<{ input: NumberInputConfig; modelValue: number | null }>()
const emit = defineEmits<{ 'update:modelValue': [value: number | null] }>()

const last = typeof props.input.last === 'number' ? props.input.last : null
const draft = ref(props.modelValue)
/** Digits typed as a new absolute value; null when not typing. */
const typed = ref<string | null>(null)
/** A pending change relative to the draft, e.g. −0.4. */
const expr = ref<{ sign: 1 | -1; digits: string } | null>(null)

const fit = (v: number) => Math.min(props.input.max, Math.max(props.input.min, Number(v.toFixed(props.input.decimals))))
const format = (v: number) => v.toFixed(props.input.decimals)
const anchor = () => draft.value ?? last ?? (typeof props.input.initial === 'number' ? props.input.initial : props.input.min)

// Whatever the keys show is the value the sheet saves; = only settles a pending expression.
const preview = computed(() => {
  if (expr.value?.digits) return fit(anchor() + expr.value.sign * Number(expr.value.digits))
  if (typed.value) return fit(Number(typed.value))
  if (typed.value === '') return null
  return draft.value
})
watch(preview, (v) => emit('update:modelValue', v))

function commit() {
  draft.value = preview.value
  typed.value = null
  expr.value = null
}

function set(v: number | null) {
  draft.value = v
  typed.value = null
  expr.value = null
}

function append(s: string, d: string): string {
  if (d === '.' && (props.input.decimals === 0 || s.includes('.'))) return s
  const next = (s === '' && d === '.' ? '0' : s) + d
  const dot = next.indexOf('.')
  if (dot >= 0 && next.length - dot - 1 > props.input.decimals) return s
  return next.length > 6 ? s : next
}

function key(d: string) {
  if (expr.value) expr.value.digits = append(expr.value.digits, d)
  else typed.value = append(typed.value ?? '', d)
}

function sign(s: 1 | -1) {
  if (expr.value && !expr.value.digits) {
    expr.value.sign = s
    return
  }
  commit()
  expr.value = { sign: s, digits: '' }
}

function clear() {
  draft.value = null
  expr.value = null
  typed.value = ''
}

function step(s: number) {
  commit()
  draft.value = fit(anchor() + s)
}

const steps = computed(() => [...props.input.steps].reverse().map((s) => -s).concat(props.input.steps))
const stepLabel = (s: number) => `${s < 0 ? '−' : '+'}${Math.abs(s)}`

const shown = computed(() => (typed.value ? typed.value : preview.value === null ? '—' : format(preview.value)))

const hint = computed(() => {
  const e = expr.value
  if (e) {
    if (!e.digits) return t(e.sign < 0 ? 'fact.askMinus' : 'fact.askPlus')
    return `${format(anchor())} ${e.sign < 0 ? '−' : '+'} ${e.digits} = ${format(preview.value!)}`
  }
  if (last === null || preview.value === null) return ''
  const d = preview.value - last
  return t('fact.last', { value: `${format(last)} · ${d > 0 ? '+' : d < 0 ? '−' : '±'}${format(Math.abs(d))}` })
})
</script>

<template>
  <section class="mt-3 mb-1">
    <p class="text-sm text-zinc-500">
      {{ input.name }} · {{ input.unit }}<span :class="input.required && preview === null ? 'text-red-600' : ''"> · {{ t(input.required ? 'fact.required' : 'fact.optional') }}</span>
    </p>
    <div class="grid grid-cols-[56px_1fr_56px] items-center pb-2">
      <button
        class="flex h-11 flex-col items-center justify-center text-xs text-zinc-500 disabled:opacity-30"
        :disabled="last === null"
        :aria-label="t('fact.backToLast')"
        @click="set(last)"
      >
        <RotateCcw :size="16" />{{ t('fact.lastButton') }}
      </button>
      <div class="text-center">
        <div class="text-[36px] leading-tight font-bold tabular-nums" :class="typed ? 'text-indigo-700' : preview === null ? 'text-zinc-300' : ''">
          {{ shown }}<span class="ml-1 text-base font-medium text-zinc-500">{{ input.unit }}</span>
        </div>
        <div class="min-h-5 text-[13px]" :class="expr ? 'text-amber-800' : 'text-zinc-500'">{{ hint }}</div>
      </div>
    </div>
    <div class="grid gap-2" :style="{ gridTemplateColumns: `repeat(${steps.length}, 1fr)` }">
      <button v-for="s in steps" :key="s" class="fine" @click="step(s)">{{ stepLabel(s) }}</button>
    </div>
    <div v-if="input.presets?.length" class="mt-2 flex gap-2">
      <button v-for="p in input.presets" :key="p" class="preset" :class="{ on: preview === p && !typed && !expr }" @click="set(p)">
        {{ p }}
      </button>
    </div>
    <div class="keys">
      <button v-for="n in [1, 2, 3]" :key="n" @click="key(String(n))">{{ n }}</button>
      <button class="op" @click="sign(-1)">−</button>
      <button v-for="n in [4, 5, 6]" :key="n" @click="key(String(n))">{{ n }}</button>
      <button class="op" @click="sign(1)">＋</button>
      <button v-for="n in [7, 8, 9]" :key="n" @click="key(String(n))">{{ n }}</button>
      <button class="eq" @click="commit()">＝</button>
      <button :disabled="input.decimals === 0" class="disabled:opacity-30" @click="key('.')">.</button>
      <button @click="key('0')">0</button>
      <button class="op" :aria-label="t('fact.clear')" @click="clear">AC</button>
    </div>
  </section>
</template>

<style scoped>
.fine {
  height: 44px;
  border: 1px solid #e5e7eb;
  border-radius: 10px;
  background: #f8fafc;
  font-size: 15px;
  font-variant-numeric: tabular-nums;
}
.preset {
  flex: 1;
  height: 44px;
  border: 1px solid #e5e7eb;
  border-radius: 10px;
  font-variant-numeric: tabular-nums;
}
.preset.on {
  border-color: #a5b4fc;
  background: #eef2ff;
  color: #3730a3;
  font-weight: 600;
}
.keys {
  display: grid;
  grid-template-columns: repeat(4, 1fr);
  grid-auto-rows: 48px;
  gap: 8px;
  margin-top: 10px;
}
.keys button {
  border-radius: 12px;
  background: #f4f4f5;
  font-size: 22px;
}
.keys .op {
  background: #e0e7ff;
  color: #3730a3;
}
.keys .eq {
  grid-row: span 2;
  background: #4f46e5;
  color: white;
  font-size: 26px;
}
</style>
