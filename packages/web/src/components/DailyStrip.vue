<script setup lang="ts">
import type { CardModel } from 'server/dashboard'
import { computed } from 'vue'

const props = defineProps<{ strip: NonNullable<CardModel['strip']> }>()

/** Last six days, newest first — the first cell is today. */
const cells = computed(() =>
  props.strip.values
    .map((value, i) => ({ value, state: props.strip.states[i]! }))
    .slice(-6)
    .reverse(),
)
</script>

<template>
  <div class="strip">
    <span v-for="(c, i) in cells" :key="i" class="cell" :class="[`s-${c.state}`, { today: i === 0 }]">
      <template v-if="typeof c.value === 'number'">{{ c.value }}</template>
      <i v-else-if="c.value !== null && c.state !== 'none' && c.state !== 'good-carry'" />
    </span>
  </div>
</template>

<style scoped>
.strip {
  display: flex;
  align-items: center;
  gap: 4px;
  opacity: 0.8;
  transform: scale(0.8);
  font-family: 'Space Grotesk', ui-sans-serif, sans-serif;
}
.cell {
  position: relative;
  width: 22px;
  height: 22px;
  display: inline-flex;
  align-items: center;
  justify-content: center;
  border: 1.5px solid #d1d5db;
  border-radius: 8px;
  background: #f3f4f6;
  color: #6b7280;
  font-size: 0.7rem;
  font-weight: 600;
}
.cell.today {
  transform: scale(1.5);
  margin-right: 5px;
  border-width: 2px;
}
.cell i {
  position: absolute;
  inset: 10%;
  border-radius: 6.4px;
  background: var(--fill);
}
.s-good,
.s-good-carry {
  --fill: #34d399;
  background: linear-gradient(135deg, #d1fae5 0%, #a7f3d0 100%);
  border-color: #34d399;
  color: #065f46;
}
.s-good-carry {
  opacity: 0.5;
  border-style: dashed;
}
.s-warning,
.s-pending {
  --fill: #fbbf24;
  background: #fde68a;
  border-color: #fbbf24;
  color: #92400e;
}
.s-danger {
  --fill: #f87171;
  background: #fecaca;
  border-color: #f87171;
  color: #991b1b;
}
</style>
