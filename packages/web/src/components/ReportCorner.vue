<script setup lang="ts">
import { useQuery } from '@tanstack/vue-query'
import { ChartColumn } from 'lucide-vue-next'
import { computed } from 'vue'
import { t } from '../i18n/index.ts'
import { configQuery } from '../queries.ts'

const { data: config } = useQuery(configQuery)
const side = computed(() => config.value?.strip.side ?? 'right')
const weight = computed(() => config.value?.strip.weight ?? 'thick')
</script>

<template>
  <button class="report" :class="[`side-${side}`, `weight-${weight}`]" :aria-label="t('card.report')">
    <ChartColumn :size="16" />
  </button>
</template>

<style scoped>
.report {
  position: absolute;
  bottom: 0;
  z-index: 1;
  display: flex;
  width: 56px;
  height: 33px;
  align-items: center;
  justify-content: center;
  border: 0 solid #d1d5db;
  border-top-width: var(--bw);
  background: #f3f4f6;
  color: #6b7280;
  opacity: 0.8;
}
.report::after {
  content: '';
  position: absolute;
  right: 0;
  bottom: 0;
  left: 0;
  height: 44px;
}
.weight-thick {
  --bw: 2.4px;
}
.weight-thin {
  --bw: 1.2px;
}
.side-right {
  right: 0;
  border-left-width: var(--bw);
  border-top-left-radius: 9px;
}
.side-left {
  left: 0;
  border-right-width: var(--bw);
  border-top-right-radius: 9px;
}
.report:focus-visible {
  outline: 2px solid #4f46e5;
  outline-offset: -2px;
}
@media (hover: hover) {
  .report {
    transition: background-color 0.15s, border-color 0.15s, color 0.15s, opacity 0.15s;
  }
  .report:hover {
    border-color: #a5b4fc;
    background: #eef2ff;
    color: #4338ca;
    opacity: 1;
  }
}
</style>
