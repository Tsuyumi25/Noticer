<script setup lang="ts">
import type { SleepCard } from 'server/dashboard'
import { computed } from 'vue'
import { ACCENT, BACKGROUND, formatHours, hasStatusIcon, WAVE_SECONDS } from '../status.ts'
import StatusCorner from './StatusCorner.vue'
import type { SheetCard } from './CheckinSheet.vue'
import WaterSurface from './WaterSurface.vue'
const props = defineProps<{ sleep: SleepCard }>()
defineEmits<{ open: [card: SheetCard] }>()

const halves = computed(() => {
  const s = props.sleep
  const lit = s.state === 'awake' ? 0 : s.state === 'asleep' ? 1 : -1
  return [
    { ...s.sleepCard, lit: lit === 0, backfill: '或者補記睡眠時間？', ask: '現在是睡著？' },
    { ...s.wakeCard, lit: lit === 1, backfill: '或者補記起床時間？', ask: '現在是醒著？' },
  ]
})

const now = computed(() => formatHours(props.sleep.hours))
const max = computed(() => formatHours(props.sleep.maxHours))

const extra = computed(() => {
  const s = props.sleep
  if (s.state !== 'awake') return []
  const lines: string[] = []
  if (s.lastSleepHours != null) lines.push(`昨晚睡了 ${formatHours(s.lastSleepHours).value}時`)
  if (s.predictedSleepAt != null) {
    const at = new Date(s.predictedSleepAt * 1000).toLocaleTimeString('zh-TW', { hour: '2-digit', minute: '2-digit', hour12: false })
    lines.push(`預測 ${at} 想睡`)
  }
  return lines
})

const corner = computed(() => {
  const { state, status, hours } = props.sleep
  if (state === 'awake') return hasStatusIcon(status) ? { icon: status } : { word: '快到了' }
  if (status === 'pending') return { word: '太短' }
  if (status === 'good') return { word: '睡夠了' }
  return { word: (hours ?? 0) >= 10 ? '太長' : '偏短' }
})
</script>

<template>
  <div class="card" :style="{ '--accent': ACCENT[sleep.status], '--bg': BACKGROUND[sleep.status] }">
    <div class="row">
      <div
        v-for="(h, i) in halves"
        :key="i"
        class="half cursor-pointer"
        :class="{ lit: h.lit, other: sleep.state !== 'unknown' && !h.lit }"
        @click="$emit('open', { id: h.id, name: h.name, emoji: h.emoji })"
      >
        <template v-if="h.lit">
          <WaterSurface :height="100 - sleep.progress" :seconds="WAVE_SECONDS[sleep.status]" />
          <StatusCorner v-bind="corner" />
        </template>
        <div class="body">
          <div class="name">{{ h.name }}</div>
          <div class="content">
            <span class="emoji">{{ h.emoji }}</span>
            <div v-if="h.lit" class="time">
              <div class="label">{{ sleep.state === 'awake' ? '已醒' : '已睡' }}</div>
              <div class="now">{{ now.value }}<small>{{ now.unit }}</small></div>
              <div class="rule" />
              <div class="max">{{ max.value }}<small>{{ max.unit }}</small></div>
            </div>
            <div v-else class="side">
              <div class="hint">{{ sleep.state === 'unknown' ? h.ask : h.backfill }}</div>
              <div v-for="line in extra" :key="line" class="sub">{{ line }}</div>
            </div>
          </div>
        </div>
      </div>
    </div>
  </div>
</template>

<style scoped>
.card {
  height: 125px;
  overflow: hidden;
  border-radius: 12px;
  border: 2px solid var(--accent);
  background: color-mix(in srgb, var(--accent) 12%, #fff);
  box-shadow: rgba(15, 23, 42, 0.18) 0 4px 12px;
}
.row {
  height: 100%;
  display: grid;
  grid-template-columns: 1fr 1fr;
  gap: 6px;
  padding: 5px;
}
.half {
  position: relative;
  overflow: hidden;
  border-radius: 8px;
  background: var(--bg);
}
.other .name,
.other .emoji {
  opacity: 0.45;
  filter: grayscale(0.6);
}
.body {
  position: relative;
  height: 100%;
  display: flex;
  flex-direction: column;
  align-items: center;
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
  gap: 4px;
  padding: 0 6%;
}
.emoji {
  flex: 1;
  text-align: center;
  font-size: 24px;
  line-height: 1;
}
.time,
.side {
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
.hint {
  font-size: 11.5px;
  line-height: 1.35;
  color: #475569;
  text-align: center;
}
.other .hint {
  color: #64748b;
}
.sub {
  margin-top: 2px;
  font-size: 10.5px;
  line-height: 1.3;
  color: #475569;
  text-align: center;
}
</style>
