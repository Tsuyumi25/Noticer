<script setup lang="ts">
import { computed } from 'vue'

/** A translated sentence whose `{name}` placeholders are filled by the named slots. */
const props = defineProps<{ text: string }>()

const parts = computed(() =>
  props.text
    .split(/(\{\w+\})/)
    .filter(Boolean)
    .map((p) => {
      const slot = /^\{(\w+)\}$/.exec(p)?.[1]
      return slot ? { slot } : { text: p }
    }),
)
</script>

<template>
  <template v-for="(p, i) in parts" :key="i">
    <slot v-if="p.slot" :name="p.slot" />
    <template v-else>{{ p.text }}</template>
  </template>
</template>
