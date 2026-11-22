<script setup lang="ts">
import { useQuery } from '@tanstack/vue-query'
import type { CardModel } from 'server/dashboard'
import { computed, nextTick, onUnmounted, ref, watch } from 'vue'
import { configQuery } from '../queries.ts'
import { arrangeStrip } from '../strip.ts'

const props = defineProps<{ strip: NonNullable<CardModel['strip']> }>()
const { data: config } = useQuery(configQuery)
const style = computed(() => config.value?.strip)

const shown = ref(props.strip.values.length)
const shrink = ref(1)
const root = ref<HTMLElement | null>(null)

const parts = computed(() => style.value && arrangeStrip(props.strip, style.value, shown.value))
const total = (days: { grow: number }[]) => days.reduce((sum, d) => sum + d.grow, 0)

const spills = () =>
  [...(root.value?.querySelectorAll<HTMLElement>('.day') ?? [])].some((el) => {
    const text = el.firstElementChild as HTMLElement | null
    if (!text) return false
    const pad = parseFloat(getComputedStyle(el).paddingLeft) + parseFloat(getComputedStyle(el).paddingRight)
    return text.offsetWidth > el.clientWidth - pad + 0.5
  })
let pass = 0
async function fit() {
  const mine = ++pass
  shown.value = props.strip.values.length
  shrink.value = 1
  await nextTick()
  while (mine === pass && spills() && shown.value > 1) {
    shown.value--
    await nextTick()
  }
  while (mine === pass && spills() && shrink.value > 0.5) {
    shrink.value -= 0.1
    await nextTick()
  }
}

let width = 0
const observer = new ResizeObserver(([entry]) => {
  if (!entry || entry.contentRect.width === width) return
  width = entry.contentRect.width
  void fit()
})
watch(root, (el, old) => {
  if (old) observer.unobserve(old)
  if (el) observer.observe(el)
})
onUnmounted(() => observer.disconnect())
watch([() => props.strip, style], () => void fit(), { deep: true })
</script>

<template>
  <div v-if="style && parts" ref="root" class="strip" :class="[`look-${style.look}`, `weight-${style.weight}`, `side-${style.side}`]" :style="{ '--shrink': shrink }">
    <span class="day today" :class="`s-${parts.today.state}`" :style="{ flexGrow: parts.today.grow }"><span>{{ parts.today.text }}</span></span>
    <div class="past" :style="{ flexGrow: total(parts.groups.flat()) }">
      <div
        v-for="(group, i) in parts.groups"
        :key="i"
        class="group"
        :class="style.look === 'blend' && `s-${group[0]!.state}`"
        :style="{ flexGrow: total(group) }"
      >
        <span v-for="(day, j) in group" :key="j" class="day" :class="`s-${day.state}`" :style="{ flexGrow: day.grow }"><span>{{ day.text }}</span></span>
      </div>
    </div>
  </div>
</template>

<style scoped>
.strip {
  display: flex;
  align-items: center;
  gap: 4px;
  width: 100%;
  opacity: 0.8;
  font-family: 'Space Grotesk', ui-sans-serif, sans-serif;
  font-weight: 600;
}
.weight-thick {
  --bw: 2.4px;
}
.weight-thin {
  --bw: 1.2px;
}
.past,
.group {
  display: flex;
  align-items: center;
  flex: 1 1 0;
  min-width: 0;
}
.past {
  gap: 2px;
}
.side-right .today {
  order: 1;
}
.day {
  display: inline-flex;
  align-items: center;
  justify-content: center;
  flex: 1 1 0;
  min-width: 0;
  height: 18px;
  padding: 0 3px;
  white-space: nowrap;
  font-size: calc(9px * var(--shrink));
  color: var(--ink);
  background: var(--bg);
  border: 0 solid var(--line);
}
.today {
  height: 26px;
  padding: 0 5px;
  font-size: calc(13.5px * var(--shrink));
  border-width: var(--bw);
  border-radius: 6.4px;
}
.look-cells .group .day {
  border-width: var(--bw);
  border-radius: 5px;
}
.look-thin .group .day {
  border-width: var(--bw);
  margin-left: calc(-1 * var(--bw));
}
.look-thin .group .day:first-child {
  margin-left: 0;
  border-radius: 6.4px 0 0 6.4px;
}
.look-thin .group .day:last-child {
  border-radius: 0 6.4px 6.4px 0;
}
.look-thin .group .day:only-child {
  border-radius: 6.4px;
}
.look-blend .group {
  height: 18px;
  border: var(--bw) solid var(--line);
  border-radius: 6.4px;
  background: var(--bg);
}
.look-blend .group .day {
  height: 100%;
  background: none;
}
.s-good,
.s-good-carry {
  --bg: linear-gradient(135deg, #d1fae5 0%, #a7f3d0 100%);
  --line: #34d399;
  --ink: #065f46;
}
.s-good-carry {
  opacity: 0.5;
  border-style: dashed;
}
.look-blend .group .s-good-carry {
  opacity: 1;
}
.s-logged {
  --bg: #e0e7ff;
  --line: #a5b4fc;
  --ink: #3730a3;
}
.s-warning,
.s-pending {
  --bg: #fde68a;
  --line: #fbbf24;
  --ink: #92400e;
}
.s-danger {
  --bg: #fecaca;
  --line: #f87171;
  --ink: #991b1b;
}
.s-none {
  --bg: #f3f4f6;
  --line: #d1d5db;
  --ink: #6b7280;
}
</style>
