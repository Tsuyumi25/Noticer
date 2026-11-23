<script setup lang="ts">
import { Settings2 } from 'lucide-vue-next'
import type { Layout } from 'server/config'
import type { CardModel, Dashboard } from 'server/dashboard'
import { computed, onMounted, onUnmounted, ref } from 'vue'
import { fillRows, fitScale, pyramidRows, sizeStep, stepScale } from '../board.ts'
import { t } from '../i18n/index.ts'
import { vLongPress } from '../longPress.ts'
import type { SheetCard } from './CheckinSheet.vue'
import LayoutPopover from './LayoutPopover.vue'
import SleepCard from './SleepCard.vue'
import WaterCard from './WaterCard.vue'

const props = defineProps<{ dashboard: Dashboard; layout: Layout }>()
const emit = defineEmits<{ open: [card: SheetCard]; review: [cardId: string] }>()

const CARD_W = 186
const CARD_H = 125
const SLEEP_W = CARD_W * 2 + 10
const GAP = 10
const ROW = CARD_H + GAP
const HEADING = 26
const SECTION_GAP = 16
const GRID_MIN = 176

const root = ref<HTMLElement | null>(null)
const width = ref(0)
const height = ref(0)
const observer = new ResizeObserver(([entry]) => {
  if (!entry) return
  width.value = entry.contentRect.width
  height.value = entry.contentRect.height
})
onMounted(() => root.value && observer.observe(root.value))
onUnmounted(() => observer.disconnect())

const cards = computed(() => [...props.dashboard.urgent, ...props.dashboard.others])
const sleep = computed(() => props.dashboard.sleep)
const measured = computed(() => width.value > 0 && height.value > 0)

const sections = computed(() => {
  const parts = [
    ...(sleep.value ? [{ slots: 2 }] : []),
    ...[props.dashboard.urgent, props.dashboard.others].filter((list) => list.length).map((list) => ({ slots: list.length })),
  ]
  const columnsAt = (scale: number) => Math.max(2, Math.floor((width.value / scale + GAP) / (GRID_MIN + GAP)))
  const heightAt = (scale: number) =>
    parts.reduce((sum, part) => sum + HEADING + Math.ceil(part.slots / columnsAt(scale)) * ROW - GAP + SECTION_GAP, 0)
  const scale = fitScale(height.value, heightAt, props.layout.cardScale)
  return { scale, columns: columnsAt(scale) }
})

type Item = { kind: 'card'; card: CardModel } | { kind: 'sleep' }
const sized = computed(() => {
  const items: (Item & { scale: number; w: number; h: number; step: number })[] = []
  const add = (item: Item, step: ReturnType<typeof sizeStep>, base: number) => {
    const scale = stepScale(step, props.layout.maxScale)
    items.push({ ...item, step, scale, w: base * scale, h: CARD_H * scale })
  }
  if (sleep.value) add({ kind: 'sleep' }, sizeStep(sleep.value.status, null, null), SLEEP_W)
  for (const card of cards.value) add({ kind: 'card', card }, sizeStep(card.status, card.nowHours, card.maxHours), CARD_W)
  const ordered = items.map((item, i) => ({ item, i })).sort((a, b) => b.item.step - a.item.step || a.i - b.i).map((x) => x.item)
  const urgent = ordered.filter((item) => item.step > 0).length
  const rowsAt = (scale: number) => {
    const room = width.value / scale
    const counts = pyramidRows(
      ordered.length,
      Math.floor((room + GAP) / (CARD_W + GAP)),
      Math.max(1, Math.floor((height.value / scale - 20 + GAP) / ROW)),
      urgent,
    )
    let next = 0
    return fillRows(ordered.map((item) => item.w), counts, room, GAP, urgent).map((n) => ordered.slice(next, (next += n)))
  }
  const heightOf = (rows: typeof ordered[]) => rows.reduce((sum, row) => sum + Math.max(...row.map((item) => item.h)) + GAP, 20 - GAP)
  const scale = fitScale(height.value, (s) => heightOf(rowsAt(s)), props.layout.cardScale)
  return { scale, rows: rowsAt(scale) }
})

const fit = (scale: number) => ({ width: `${100 / scale}%`, transform: `scale(${scale})` })

const layoutOpen = ref(false)
</script>

<template>
  <div class="relative flex h-full flex-col">
    <div class="mb-2.5 flex shrink-0 items-center gap-2">
      <button
        data-layout-toggle
        class="flex h-11 items-center gap-2 rounded-xl px-3.5 text-sm font-semibold"
        :class="layoutOpen ? 'bg-white text-indigo-700 shadow-md' : 'bg-white/15 text-white hover:bg-white/25'"
        :aria-expanded="layoutOpen"
        @click="layoutOpen = !layoutOpen"
      >
        <Settings2 :size="18" />{{ t('layout.title') }}
      </button>
    </div>
    <LayoutPopover v-if="layoutOpen" :layout="layout" @close="layoutOpen = false" />

    <div ref="root" class="relative min-h-0 flex-1 overflow-hidden">
      <div v-if="!measured" />
      <div v-else-if="layout.arrangement === 'sections'" class="origin-top-left" :style="fit(sections.scale)">
        <template v-if="sleep">
          <h2 class="section">{{ t('dashboard.sleep') }}</h2>
          <div class="board-grid" :style="{ gridTemplateColumns: `repeat(${sections.columns}, minmax(0, 1fr))` }">
            <SleepCard class="col-span-2" :sleep="sleep" @open="emit('open', $event)" @review="emit('review', $event)" />
          </div>
        </template>
        <template v-for="part in ['urgent', 'others'] as const" :key="part">
          <template v-if="dashboard[part].length">
            <h2 class="section">{{ t(part === 'urgent' ? 'dashboard.urgent' : 'dashboard.others') }}</h2>
            <div class="board-grid" :style="{ gridTemplateColumns: `repeat(${sections.columns}, minmax(0, 1fr))` }">
              <WaterCard
                v-for="card in dashboard[part]"
                :key="card.id"
                v-long-press="() => emit('review', card.id)"
                :card="card"
                class="cursor-pointer"
                @click="emit('open', card)"
              />
            </div>
          </template>
        </template>
      </div>

      <div
        v-else
        class="absolute top-0 left-0 flex origin-top-left flex-col justify-end gap-2.5 pb-5"
        :style="{ ...fit(sized.scale), height: `${100 / sized.scale}%` }"
      >
        <div v-for="(row, r) in sized.rows" :key="r" class="flex items-end gap-2.5" :class="{ left: 'justify-start', center: 'justify-center', right: 'justify-end' }[layout.align]">
          <div v-for="item in row" :key="item.kind === 'card' ? item.card.id : 'sleep'" class="shrink-0" :style="{ width: `${item.w}px`, height: `${item.h}px` }">
            <div class="origin-top-left" :style="{ width: `${item.w / item.scale}px`, transform: `scale(${item.scale})` }">
              <SleepCard v-if="item.kind === 'sleep' && sleep" :sleep="sleep" @open="emit('open', $event)" @review="emit('review', $event)" />
              <WaterCard
                v-else-if="item.kind === 'card'"
                v-long-press="() => emit('review', item.card.id)"
                :card="item.card"
                class="cursor-pointer"
                @click="emit('open', item.card)"
              />
            </div>
          </div>
        </div>
      </div>
    </div>
  </div>
</template>

<style scoped>
.section {
  height: 20px;
  margin: 0 0 6px;
  padding: 0 0.25rem;
  font-size: 0.875rem;
  line-height: 20px;
  font-weight: 600;
  color: rgb(255 255 255 / 0.85);
}
.board-grid {
  display: grid;
  grid-auto-rows: 125px;
  gap: 10px;
  margin-bottom: 16px;
}
</style>
