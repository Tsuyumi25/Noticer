<script setup lang="ts">
import type { CardModel } from 'server/dashboard'
import { computed } from 'vue'
import { ACCENT, BACKGROUND, formatHours, hasStatusIcon, WAVE_SECONDS } from '../status.ts'
import DailyStrip from './DailyStrip.vue'
import StatusCorner from './StatusCorner.vue'
import WaterSurface from './WaterSurface.vue'

const props = defineProps<{ card: CardModel }>()

const now = computed(() => formatHours(props.card.nowHours))
const max = computed(() => formatHours(props.card.maxHours))

/** Countdown cards get a corner symbol; everything else gets a status word. */
const corner = computed(() => {
  const { mode, status } = props.card
  if (mode === 'deadline' && hasStatusIcon(status)) return { icon: status }
  if (mode === null) return { word: '沒有門檻' }
  if (status === 'unknown') return { word: '無記錄' }
  if (mode === 'cooldown') return { word: status === 'good' ? '可以了' : '太近' }
  return { word: '快到了' }
})
</script>

<template>
  <div
    class="card"
    :class="{ pulse: card.status === 'danger' }"
    :style="{ '--accent': ACCENT[card.status], background: BACKGROUND[card.status] }"
  >
    <WaterSurface :height="100 - card.progress" :seconds="WAVE_SECONDS[card.status]" />
    <StatusCorner v-bind="corner" />
    <div class="body">
      <div class="name">{{ card.name }}</div>
      <div class="content">
        <span class="emoji">{{ card.emoji }}</span>
        <div class="time">
          <div class="label">{{ card.summary }}</div>
          <div class="now">{{ now.value }}<small>{{ now.unit }}</small></div>
          <template v-if="card.maxHours != null">
            <div class="rule" />
            <div class="max">{{ max.value }}<small>{{ max.unit }}</small></div>
          </template>
        </div>
      </div>
      <DailyStrip v-if="card.strip" :strip="card.strip" />
    </div>
  </div>
</template>

<style scoped>
.card {
  position: relative;
  overflow: hidden;
  height: 125px;
  min-width: 0;
  border-radius: 12px;
  border: 2px solid var(--accent);
  box-shadow: rgba(15, 23, 42, 0.18) 0 4px 12px;
}
.pulse {
  animation: pulse 2s ease-in-out infinite;
}
@keyframes pulse {
  0%, 100% { box-shadow: 0 0 0 0 rgba(239, 68, 68, 0.45), rgba(15, 23, 42, 0.18) 0 4px 12px; }
  50% { box-shadow: 0 0 0 6px rgba(239, 68, 68, 0), rgba(15, 23, 42, 0.18) 0 4px 12px; }
}
.body {
  position: relative;
  height: 100%;
  display: flex;
  flex-direction: column;
  align-items: center;
  justify-content: space-between;
  padding: 8px 6px 7px;
}
.name {
  font-size: 12px;
  font-weight: 600;
  line-height: 1.3;
}
.content {
  flex: 1;
  width: 100%;
  display: flex;
  align-items: center;
  padding: 0 10%;
}
.emoji {
  flex: 1;
  text-align: center;
  font-size: 24px;
  line-height: 1;
}
.time {
  flex: 3;
  min-width: 0;
  display: flex;
  flex-direction: column;
  align-items: center;
  gap: 2px;
  line-height: 1;
}
.label {
  font-size: 11px;
  color: #64748b;
}
.now {
  color: var(--accent);
  font: 700 20px ui-monospace, 'SF Mono', Menlo, monospace;
  white-space: nowrap;
}
.max {
  color: #374151;
  font: 12px ui-monospace, 'SF Mono', Menlo, monospace;
}
small {
  font-size: 11px;
  margin-left: 1px;
}
.rule {
  width: 48px;
  height: 1px;
  background: #374151;
  opacity: 0.2;
}
</style>
