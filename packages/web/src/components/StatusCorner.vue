<script setup lang="ts">
import { Check, OctagonAlert, TriangleAlert } from 'lucide-vue-next'
import type { CardStatus } from '../status.ts'

defineProps<{ icon?: CardStatus; word?: string }>()

const ICONS = { good: Check, warning: TriangleAlert, danger: OctagonAlert } as const
</script>

<template>
  <component :is="ICONS[icon as keyof typeof ICONS]" v-if="icon && icon in ICONS" class="corner icon" :size="17" :stroke-width="2.75" />
  <span v-else-if="word" class="corner word">{{ word }}</span>
</template>

<style scoped>
.corner {
  position: absolute;
  top: 6px;
  right: 7px;
  z-index: 1;
  color: var(--accent);
}
.word {
  padding: 0 4px;
  font-size: 10.5px;
  font-weight: 700;
  line-height: 15px;
  border: 1px solid color-mix(in srgb, var(--accent) 60%, transparent);
  border-radius: 6px;
  background: color-mix(in srgb, #fff 80%, transparent);
}
</style>
