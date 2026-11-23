<script setup lang="ts">
import { Check, Pencil, PinOff, Settings2 } from 'lucide-vue-next'
import type { Layout } from 'server/config'
import type { CardModel, Dashboard } from 'server/dashboard'
import { computed, onMounted, onUnmounted, ref } from 'vue'
import { CELLS_PER_CARD, fitScale, pinOf, pinRect, placeStack, sizeStep, stepScale, type Rect, type Step } from '../board.ts'
import { t } from '../i18n/index.ts'
import { useLayoutSave } from '../layoutSave.ts'
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
const FLOOR = 12
const SLEEP_ID = 'sleep'

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

type Entry = { id: string; step: Step } & ({ kind: 'card'; card: CardModel } | { kind: 'sleep' })
const entries = computed(() => {
  const list: Entry[] = []
  if (sleep.value) list.push({ id: SLEEP_ID, kind: 'sleep', step: sizeStep(sleep.value.status, null, null) })
  for (const card of cards.value) list.push({ id: card.id, kind: 'card', card, step: sizeStep(card.status, card.nowHours, card.maxHours) })
  return list.map((entry, i) => ({ entry, i })).sort((a, b) => b.entry.step - a.entry.step || a.i - b.i).map((x) => x.entry)
})

function spanOf(entry: Entry, pinned: boolean) {
  const h = pinned ? CELLS_PER_CARD : Math.max(CELLS_PER_CARD, Math.round(CELLS_PER_CARD * stepScale(entry.step, props.layout.maxScale)))
  return { w: entry.kind === 'sleep' ? h * 2 : h, h }
}

function gridAt(scale: number, withPins: boolean) {
  const cw = ((CARD_W + GAP) * scale) / CELLS_PER_CARD
  const ch = ((CARD_H + GAP) * scale) / CELLS_PER_CARD
  const cols = Math.floor((width.value + GAP * scale) / cw)
  const rows = Math.floor((height.value - FLOOR + GAP * scale) / ch)
  if (cols < CELLS_PER_CARD || rows < CELLS_PER_CARD) return null
  const pinned: Record<string, Rect> = {}
  if (withPins) {
    for (const entry of entries.value) {
      const pin = props.layout.pins[entry.id]
      if (!pin) continue
      const { w, h } = spanOf(entry, true)
      pinned[entry.id] = pinRect(pin, w, h, cols, rows)
    }
  }
  const items = entries.value.map((entry) => ({ id: entry.id, step: entry.step, ...spanOf(entry, entry.id in pinned) }))
  const placed = placeStack(items, pinned, { cols, rows, n: CELLS_PER_CARD, align: props.layout.align })
  return placed && { scale, cw, ch, cols, rows, placed, pinned }
}

function fitGrid(withPins: boolean) {
  const preferred = gridAt(props.layout.cardScale, withPins)
  if (preferred) return preferred
  let best = null
  let low = 0.15
  let high = props.layout.cardScale
  for (let i = 0; i < 18; i++) {
    const mid = (low + high) / 2
    const grid = gridAt(mid, withPins)
    if (grid) {
      best = grid
      low = mid
    } else high = mid
  }
  return best
}

const grid = computed(() => {
  if (!measured.value || props.layout.arrangement !== 'stack') return null
  const withPins = fitGrid(true)
  if (withPins) return { ...withPins, pinsDropped: false }
  const without = fitGrid(false)
  return without && { ...without, pinsDropped: true }
})

const origin = computed(() => {
  const g = grid.value
  if (!g) return { x: 0, y: 0 }
  return { x: (width.value + GAP * g.scale - g.cols * g.cw) / 2, y: height.value - FLOOR - g.rows * g.ch + GAP * g.scale }
})

function boxOf(rect: Rect) {
  const g = grid.value!
  return { left: origin.value.x + rect.x * g.cw, top: origin.value.y + rect.y * g.ch, width: rect.w * g.cw - GAP * g.scale, height: rect.h * g.ch - GAP * g.scale }
}
function boxStyle(rect: Rect, at?: { left: number; top: number }) {
  const box = { ...boxOf(rect), ...at }
  return { left: `${box.left}px`, top: `${box.top}px`, width: `${box.width}px`, height: `${box.height}px` }
}

const fit = (scale: number) => ({ width: `${100 / scale}%`, transform: `scale(${scale})` })
const layoutOpen = ref(false)
const editing = ref(false)

const { save } = useLayoutSave()
const savePins = (pins: Layout['pins']) => save({ ...props.layout, pins })
const isPinned = (id: string) => !!grid.value?.pinned[id]

function pinAt(id: string, rect: Rect) {
  const g = grid.value!
  savePins({ ...props.layout.pins, [id]: pinOf(rect, props.layout.align, g.cols, g.rows) })
}
function unpin(id: string) {
  const { [id]: _, ...rest } = props.layout.pins
  savePins(rest)
}
const collidesWithPins = (id: string, rect: Rect) =>
  Object.entries(grid.value!.pinned).some(([other, r]) => other !== id && rect.x < r.x + r.w && r.x < rect.x + rect.w && rect.y < r.y + r.h && r.y < rect.y + rect.h)
const insideGrid = (rect: Rect) => rect.x >= 0 && rect.y >= 0 && rect.x + rect.w <= grid.value!.cols && rect.y + rect.h <= grid.value!.rows

function togglePin(entry: Entry) {
  if (isPinned(entry.id)) return unpin(entry.id)
  const at = grid.value!.placed[entry.id]
  if (!at) return
  const { w, h } = spanOf(entry, true)
  const rect = { x: at.x, y: at.y + at.h - h, w, h }
  if (insideGrid(rect) && !collidesWithPins(entry.id, rect)) pinAt(entry.id, rect)
}

type Drag = { entry: Entry; dx: number; dy: number; x0: number; y0: number; moved: boolean; left: number; top: number; target: Rect | null; ok: boolean }
const drag = ref<Drag | null>(null)
function startDrag(e: PointerEvent, entry: Entry) {
  if (e.button !== 0) return
  const box = boxOf(grid.value!.placed[entry.id]!)
  const area = root.value!.getBoundingClientRect()
  ;(e.currentTarget as HTMLElement).setPointerCapture(e.pointerId)
  drag.value = { entry, dx: e.clientX - area.left - box.left, dy: e.clientY - area.top - box.top, x0: e.clientX, y0: e.clientY, moved: false, left: box.left, top: box.top, target: null, ok: false }
}
function moveDrag(e: PointerEvent) {
  const d = drag.value
  const g = grid.value
  if (!d || !g) return
  if (!d.moved && Math.hypot(e.clientX - d.x0, e.clientY - d.y0) < 6) return
  d.moved = true
  const area = root.value!.getBoundingClientRect()
  d.left = e.clientX - area.left - d.dx
  d.top = e.clientY - area.top - d.dy
  const { w, h } = spanOf(d.entry, true)
  const rect = { x: Math.round((d.left - origin.value.x) / g.cw), y: Math.round((d.top - origin.value.y) / g.ch), w, h }
  d.target = rect
  d.ok = insideGrid(rect) && !collidesWithPins(d.entry.id, rect)
}
function endDrag() {
  const d = drag.value
  drag.value = null
  if (d?.moved && d.target && d.ok) pinAt(d.entry.id, d.target)
}

const menu = ref<{ id: string; entry: Entry; x: number; y: number } | null>(null)
function openMenu(e: MouseEvent, entry: Entry) {
  menu.value = { id: entry.id, entry, x: e.clientX, y: e.clientY }
}
function closeMenu(e: Event) {
  if (!(e.target as Element).closest?.('[data-pin-menu]')) menu.value = null
}
function onKeydown(e: KeyboardEvent) {
  if (e.key !== 'Escape') return
  if (menu.value) menu.value = null
  else if (editing.value && !layoutOpen.value) editing.value = false
}
onMounted(() => {
  document.addEventListener('pointerdown', closeMenu)
  window.addEventListener('keydown', onKeydown)
})
onUnmounted(() => {
  document.removeEventListener('pointerdown', closeMenu)
  window.removeEventListener('keydown', onKeydown)
})
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
      <template v-if="layout.arrangement === 'stack'">
        <button
          class="flex h-11 items-center gap-2 rounded-xl px-3.5 text-sm font-semibold"
          :class="editing ? 'bg-white text-indigo-700 shadow-md' : 'bg-white/15 text-white hover:bg-white/25'"
          :aria-pressed="editing"
          @click="editing = !editing"
        >
          <component :is="editing ? Check : Pencil" :size="18" />{{ editing ? t('layout.editDone') : t('layout.edit') }}
        </button>
        <button
          v-if="editing && Object.keys(layout.pins).length"
          class="flex h-11 items-center gap-2 rounded-xl bg-white/15 px-3.5 text-sm font-semibold text-white hover:bg-white/25"
          @click="savePins({})"
        >
          <PinOff :size="18" />{{ t('layout.clearPins') }}
        </button>
        <span v-if="editing" class="text-sm text-white/85">{{ t('layout.editHint') }}</span>
        <span v-else-if="grid?.pinsDropped" class="text-sm text-amber-100">{{ t('layout.pinsDropped') }}</span>
      </template>
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

      <template v-else-if="grid">
        <div
          v-if="editing"
          class="gridlines"
          :style="{
            left: `${origin.x}px`,
            top: `${origin.y}px`,
            width: `${grid.cols * grid.cw - GAP * grid.scale}px`,
            height: `${grid.rows * grid.ch - GAP * grid.scale}px`,
            backgroundSize: `${grid.cw}px ${grid.ch}px`,
          }"
        />
        <template v-for="entry in entries" :key="entry.id">
          <div
            v-if="grid.placed[entry.id]"
            class="tile"
            :class="{ dragging: drag?.entry.id === entry.id, pinned: editing && isPinned(entry.id) }"
            :style="boxStyle(grid.placed[entry.id]!, drag?.entry.id === entry.id ? drag : undefined)"
            @contextmenu.prevent="openMenu($event, entry)"
          >
            <div
              class="origin-top-left"
              :style="{
                width: `${entry.kind === 'sleep' ? SLEEP_W : CARD_W}px`,
                transform: `scale(${boxOf(grid.placed[entry.id]!).width / (entry.kind === 'sleep' ? SLEEP_W : CARD_W)})`,
              }"
            >
              <SleepCard v-if="entry.kind === 'sleep' && sleep" :sleep="sleep" @open="emit('open', $event)" @review="emit('review', $event)" />
              <WaterCard
                v-else-if="entry.kind === 'card'"
                v-long-press="() => emit('review', entry.card.id)"
                :card="entry.card"
                class="cursor-pointer"
                @click="emit('open', entry.card)"
              />
            </div>
            <div v-if="editing" class="grab" @pointerdown="startDrag($event, entry)" @pointermove="moveDrag" @pointerup="endDrag" @pointercancel="endDrag" />
          </div>
        </template>
        <div
          v-if="drag?.target"
          class="ghost"
          :class="{ bad: !drag.ok }"
          :style="boxStyle(drag.target)"
        />
      </template>
    </div>

    <div v-if="menu" data-pin-menu class="fixed z-50 min-w-44 rounded-xl bg-white p-1.5 shadow-xl" :style="{ left: `${menu.x}px`, top: `${menu.y}px` }">
      <button
        class="flex h-11 w-full items-center gap-2 rounded-lg px-3 text-left text-sm hover:bg-zinc-100"
        @click="togglePin(menu.entry), (menu = null)"
      >
        {{ isPinned(menu.id) ? t('layout.unpin') : t('layout.pin') }}
      </button>
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
.gridlines {
  position: absolute;
  pointer-events: none;
  background-image:
    linear-gradient(to right, rgb(255 255 255 / 0.16) 1px, transparent 1px),
    linear-gradient(to bottom, rgb(255 255 255 / 0.16) 1px, transparent 1px);
  outline: 1px solid rgb(255 255 255 / 0.3);
}
.tile {
  position: absolute;
  transition:
    left 0.25s,
    top 0.25s,
    width 0.25s,
    height 0.25s;
}
.tile.dragging {
  z-index: 10;
  opacity: 0.85;
  transition: none;
}
.grab {
  position: absolute;
  inset: 0;
  z-index: 1;
  cursor: grab;
  touch-action: none;
}
.dragging .grab {
  cursor: grabbing;
}
.tile.pinned::after {
  content: '';
  position: absolute;
  inset: -4px;
  border: 2px solid rgb(255 255 255 / 0.9);
  border-radius: 15px;
  pointer-events: none;
}
.ghost {
  position: absolute;
  border: 2px dashed white;
  border-radius: 12px;
  background: rgb(255 255 255 / 0.15);
  pointer-events: none;
}
.ghost.bad {
  border-color: #fca5a5;
  background: rgb(239 68 68 / 0.2);
}
</style>
