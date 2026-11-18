<script setup lang="ts">
defineProps<{ height: number; seconds: number }>()

const WAVES = [
  { viewBox: '0 0 800 200', speed: 1, reverse: false, d: 'M0,20 C67,35 133,5 200,20 C267,35 333,5 400,20 C467,35 533,5 600,20 C667,35 733,5 800,20 L800,200 L0,200 Z' },
  { viewBox: '0 0 600 200', speed: 1.7, reverse: true, d: 'M0,16 C50,24 100,8 150,16 C200,24 250,8 300,16 C350,24 400,8 450,16 C500,24 550,8 600,16 L600,200 L0,200 Z' },
  { viewBox: '0 0 400 200', speed: 2.3, reverse: false, d: 'M0,14 C33,19 67,6 100,11 C133,18 167,5 200,14 C233,20 267,9 300,12 C333,16 367,4 400,14 L400,200 L0,200 Z' },
]
</script>

<template>
  <div class="water" :style="{ height: `${height}%` }">
    <svg
      v-for="(w, i) in WAVES"
      :key="i"
      class="wave"
      :viewBox="w.viewBox"
      preserveAspectRatio="none"
      :style="{ animationDuration: `${seconds * w.speed}s`, animationDirection: w.reverse ? 'reverse' : 'normal' }"
    >
      <path :d="w.d" />
    </svg>
  </div>
</template>

<style scoped>
.water {
  position: absolute;
  left: 0;
  right: 0;
  bottom: 0;
  pointer-events: none;
}
.wave {
  position: absolute;
  left: 0;
  bottom: 0;
  width: 200%;
  height: calc(100% + 12px);
  fill: var(--accent);
  opacity: 0.1;
  animation: drift linear infinite;
}
@keyframes drift {
  from { transform: translateX(0); }
  to { transform: translateX(-50%); }
}
</style>
