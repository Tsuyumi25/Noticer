<script setup lang="ts">
import { useMutation, useQueryClient } from '@tanstack/vue-query'
import { computed, onMounted, onUnmounted, ref } from 'vue'
import { api } from '../api.ts'

export interface SheetCard {
  id: string
  name: string
  emoji: string
  needsValue?: boolean
}

const props = defineProps<{ card: SheetCard }>()
const emit = defineEmits<{ close: [] }>()

const note = ref('')
const dirty = computed(() => note.value.trim() !== '')

const queryClient = useQueryClient()
const submit = useMutation({
  mutationFn: async () => {
    const res = await api.checkin.$post({ json: { cardId: props.card.id, note: note.value } })
    if (!res.ok) throw new Error(`送出失敗（${res.status}）`)
  },
  onSuccess: () => {
    queryClient.invalidateQueries({ queryKey: ['dashboard'] })
    queryClient.invalidateQueries({ queryKey: ['events'] })
    leave()
  },
})

/** How far the sheet is pushed below full screen, in px; 0 means full screen. */
const offset = ref(window.innerHeight)
const animated = ref(true)
const leaving = ref(false)
const confirming = ref(false)

// Full screen has square corners; they round only while the sheet is off its resting place.
const radius = computed(() => Math.min(16, offset.value / 5))
const backdrop = computed(() => 0.4 * Math.max(0, 1 - offset.value / window.innerHeight))

const sheet = ref<HTMLElement | null>(null)

function leave() {
  animated.value = true
  leaving.value = true
  offset.value = window.innerHeight
}

function requestClose() {
  if (leaving.value) return
  if (!dirty.value) return leave()
  animated.value = true
  offset.value = 0
  confirming.value = true
}

function discard() {
  confirming.value = false
  leave()
}

function onTransitionEnd(e: TransitionEvent) {
  if (leaving.value && e.target === sheet.value && e.propertyName === 'transform') emit('close')
}

const DAMPING = 0.6
let dragging = false
let startY = 0
let startTime = 0

/** A pull only drags the sheet when nothing under the finger is scrolled down. */
function atTop(target: EventTarget | null): boolean {
  for (let el = target as HTMLElement | null; el && el !== sheet.value; el = el.parentElement) {
    if (el.scrollTop > 0) return false
  }
  return true
}

function onTouchStart(e: TouchEvent) {
  const touch = e.touches[0]
  if (confirming.value || leaving.value || !touch || e.touches.length > 1) return
  dragging = atTop(e.target)
  startY = touch.clientY
  startTime = e.timeStamp
}

function onTouchMove(e: TouchEvent) {
  const touch = e.touches[0]
  if (!dragging || !touch) return
  const dy = touch.clientY - startY
  if (dy <= 0) {
    // Pushing up scrolls the content instead.
    if (offset.value === 0) dragging = false
    else offset.value = 0
    return
  }
  e.preventDefault()
  animated.value = false
  offset.value = dy * DAMPING
}

function onTouchEnd(e: TouchEvent) {
  if (!dragging) return
  dragging = false
  animated.value = true
  const dy = offset.value / DAMPING
  const velocity = dy / (e.timeStamp - startTime)
  if (e.type === 'touchend' && (dy > 200 || (velocity > 0.5 && dy > 50))) requestClose()
  else offset.value = 0
}

function onKeydown(e: KeyboardEvent) {
  if (e.key !== 'Escape') return
  if (confirming.value) confirming.value = false
  else requestClose()
}

onMounted(() => {
  document.documentElement.style.overflow = 'hidden'
  window.addEventListener('keydown', onKeydown)
  // Paint the off-screen position first so the slide-in animates.
  requestAnimationFrame(() => requestAnimationFrame(() => (offset.value = 0)))
})

onUnmounted(() => {
  document.documentElement.style.overflow = ''
  window.removeEventListener('keydown', onKeydown)
})
</script>

<template>
  <Teleport to="body">
    <div class="fixed inset-0 z-50">
      <div class="absolute inset-0 bg-black" :class="{ animated }" :style="{ opacity: backdrop }" />
      <section
        ref="sheet"
        class="sheet"
        :class="{ animated }"
        :style="{ transform: `translateY(${offset}px)`, borderTopLeftRadius: `${radius}px`, borderTopRightRadius: `${radius}px` }"
        @touchstart="onTouchStart"
        @touchmove="onTouchMove"
        @touchend="onTouchEnd"
        @touchcancel="onTouchEnd"
        @transitionend="onTransitionEnd"
      >
        <div class="mx-auto mt-2 h-1 w-10 shrink-0 rounded-full bg-zinc-300" />
        <h2 class="shrink-0 px-4 py-2 text-lg font-semibold">{{ card.emoji }} {{ card.name }}</h2>
        <div class="min-h-0 flex-1 overflow-y-auto overscroll-contain px-4 pb-4">
          <textarea
            v-model="note"
            rows="4"
            placeholder="備註…"
            class="w-full resize-none rounded-xl border border-zinc-200 p-3 text-base outline-none focus:border-indigo-400"
          />
        </div>
        <footer class="shrink-0 border-t border-zinc-200 px-4 pt-3 pb-[calc(0.75rem+env(safe-area-inset-bottom))]">
          <p v-if="card.needsValue" class="mb-2 text-center text-sm text-zinc-500">數值輸入還沒做，暫時不能送出</p>
          <p v-else-if="submit.error.value" class="mb-2 text-center text-sm text-red-600">{{ submit.error.value.message }}</p>
          <div class="grid grid-cols-2 gap-3">
            <button class="h-12 rounded-xl bg-zinc-100 font-semibold" @click="requestClose">取消</button>
            <button
              class="h-12 rounded-xl bg-indigo-600 font-semibold text-white disabled:opacity-40"
              :disabled="card.needsValue || submit.isPending.value || leaving"
              @click="submit.mutate()"
            >
              送出
            </button>
          </div>
        </footer>
      </section>

      <div v-if="confirming" class="absolute inset-0 flex items-end bg-black/40" @click.self="confirming = false">
        <div
          role="alertdialog"
          aria-label="捨棄草稿"
          class="w-full rounded-t-2xl bg-white p-4 pb-[calc(1rem+env(safe-area-inset-bottom))]"
        >
          <p class="mb-1 text-center font-semibold">捨棄這份草稿？</p>
          <p class="mb-4 text-center text-sm text-zinc-500">寫到一半的內容會消失</p>
          <button class="mb-2 h-12 w-full rounded-xl bg-red-500 font-semibold text-white" @click="discard">捨棄</button>
          <button class="h-12 w-full rounded-xl bg-zinc-100 font-semibold" @click="confirming = false">繼續編輯</button>
        </div>
      </div>
    </div>
  </Teleport>
</template>

<style scoped>
.sheet {
  position: absolute;
  inset: 0;
  display: flex;
  flex-direction: column;
  overflow: hidden;
  padding-top: env(safe-area-inset-top);
  background: white;
}
.animated {
  transition:
    transform 0.3s cubic-bezier(0.32, 0.72, 0, 1),
    border-radius 0.3s cubic-bezier(0.32, 0.72, 0, 1),
    opacity 0.3s cubic-bezier(0.32, 0.72, 0, 1);
}
</style>
