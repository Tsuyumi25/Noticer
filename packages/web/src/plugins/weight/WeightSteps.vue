<script setup lang="ts">
/** Weighing lands near the last weight, so the keypad nudges from it instead of offering usual amounts. */
const props = defineProps<{ value: number | null; fallback: number | null; decimals: number }>()
const emit = defineEmits<{ set: [value: number] }>()

const STEPS = [-0.5, -0.1, 0.1, 0.5]
const label = (s: number) => `${s < 0 ? '−' : '+'}${Math.abs(s)}`
const nudge = (s: number) => emit('set', Math.max(0, Number(((props.value ?? props.fallback ?? 0) + s).toFixed(props.decimals))))
</script>

<template>
  <button v-for="s in STEPS" :key="s" class="fine" @click="nudge(s)">{{ label(s) }}</button>
</template>
