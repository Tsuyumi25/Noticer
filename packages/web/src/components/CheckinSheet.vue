<script setup lang="ts">
import { useMutation, useQuery, useQueryClient } from '@tanstack/vue-query'
import { ChevronRight, Clock, Pencil } from 'lucide-vue-next'
import { computed, onMounted, onUnmounted, ref, watch } from 'vue'
import { api } from '../api.ts'
import { locale, t } from '../i18n/index.ts'
import { absoluteTime, relativeTime } from '../time.ts'
import NumberInput from './NumberInput.vue'
import TagPicker from './TagPicker.vue'
import TimeOffsetPopup from './TimeOffsetPopup.vue'

export interface SheetCard {
  id: string
  name: string
  emoji: string
}

const props = defineProps<{ card: SheetCard }>()
const emit = defineEmits<{ close: [] }>()

const note = ref('')
/** Null until the picker loads this card's preselected tags. */
const tags = ref<string[] | null>(null)
let initialTags: string | null = null
function onTags(next: string[]) {
  if (tags.value === null) initialTags = [...next].sort().join('\n')
  tags.value = next
}
/** When it happened, in ms; null means now. */
const happenedAt = ref<number | null>(null)
const timePopup = ref(false)
const timeLabel = computed(() => {
  if (happenedAt.value === null) return t('time.now')
  const now = Date.now()
  return `${relativeTime(happenedAt.value, now)} · ${absoluteTime(happenedAt.value, now)}`
})

const { data: inputs } = useQuery({
  queryKey: computed(() => ['cardInputs', props.card.id]),
  queryFn: async () => {
    const res = await api.cards[':cardId'].inputs.$get({ param: { cardId: props.card.id } })
    if (!res.ok) throw new Error(`inputs: ${res.status}`)
    return res.json()
  },
})
/** Null until this card's inputs load. */
const values = ref<Record<string, number | string | null> | null>(null)
let initialValues = ''
watch(
  inputs,
  (list) => {
    if (!list || values.value !== null) return
    values.value = Object.fromEntries(
      list.map((i) => [i.key, i.kind === 'number' ? (i.initial === 'last' ? (typeof i.last === 'number' ? i.last : null) : (i.initial ?? null)) : null]),
    )
    initialValues = JSON.stringify(values.value)
  },
  { immediate: true },
)
const missing = computed(() => (inputs.value ?? []).filter((i) => i.required && values.value?.[i.key] == null).map((i) => i.name))
function pick(key: string, value: string) {
  values.value![key] = values.value![key] === value ? null : value
}

const dirty = computed(
  () =>
    note.value.trim() !== '' ||
    happenedAt.value !== null ||
    (tags.value !== null && [...tags.value].sort().join('\n') !== initialTags) ||
    (values.value !== null && JSON.stringify(values.value) !== initialValues),
)

const editing = ref(false)
const picker = ref<InstanceType<typeof TagPicker> | null>(null)

const queryClient = useQueryClient()
const submit = useMutation({
  mutationFn: async () => {
    const timeOffset = happenedAt.value === null ? 0 : Math.min(0, Math.round((happenedAt.value - Date.now()) / 1000))
    const facts = Object.fromEntries(Object.entries(values.value ?? {}).filter((e): e is [string, number | string] => e[1] != null))
    const res = await api.checkin.$post({ json: { cardId: props.card.id, note: note.value, tags: tags.value ?? [], timeOffset, facts } })
    if (!res.ok) throw new Error(t('sheet.submitFailed', { status: res.status }))
  },
  onSuccess: () => {
    queryClient.invalidateQueries({ queryKey: ['dashboard'] })
    queryClient.invalidateQueries({ queryKey: ['events'] })
    queryClient.invalidateQueries({ queryKey: ['cardTags'] })
    queryClient.invalidateQueries({ queryKey: ['cardInputs'] })
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
  // While editing, a press on a tag may become a drag; it must not pull the sheet.
  const onTag = editing.value && (e.target as Element).closest('[data-tag]')
  dragging = !onTag && atTop(e.target)
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
  if (timePopup.value) timePopup.value = false
  else if (confirming.value) confirming.value = false
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
        <div class="flex shrink-0 items-center justify-between py-1 pr-2 pl-4">
          <h2 class="text-lg font-semibold">
            {{ card.emoji }} {{ card.name }}<span v-if="editing" class="text-sm font-medium text-amber-700">{{ t('sheet.editing') }}</span>
          </h2>
          <button v-if="editing" class="h-11 min-w-11 px-2 font-semibold text-indigo-600" @click="editing = false">{{ t('common.done') }}</button>
          <button v-else class="flex h-11 min-w-11 items-center gap-1 px-2 text-zinc-400" @click="editing = true">
            <Pencil :size="16" />{{ t('sheet.edit') }}
          </button>
        </div>
        <div class="min-h-0 flex-1 overflow-y-auto overscroll-contain px-4 pb-4">
          <button
            class="mb-1 flex min-h-12 w-full items-center justify-between rounded-xl border border-zinc-200 px-3"
            @click="timePopup = true"
          >
            <span class="flex items-center gap-2"><Clock :size="18" class="text-zinc-400" />{{ t('sheet.time') }}</span>
            <span class="flex items-center gap-1" :class="happenedAt === null ? 'text-zinc-500' : 'font-semibold text-amber-700'">
              {{ timeLabel }}<ChevronRight :size="18" class="text-zinc-400" />
            </span>
          </button>
          <template v-for="input in values ? (inputs ?? []) : []" :key="input.key">
            <NumberInput
              v-if="input.kind === 'number'"
              :input="input"
              :model-value="values?.[input.key] as number | null"
              @update:model-value="values![input.key] = $event"
            />
            <div v-else class="mt-3 mb-1">
              <p class="mb-1.5 text-sm text-zinc-500">
                {{ input.name }}<span v-if="!input.required"> · {{ t('fact.optional') }}</span>
              </p>
              <div class="grid gap-1.5" :style="{ gridTemplateColumns: `repeat(${input.options.length}, 1fr)` }">
                <button
                  v-for="o in input.options"
                  :key="o.value"
                  class="choice"
                  :class="{ on: values?.[input.key] === o.value }"
                  @click="pick(input.key, o.value)"
                >
                  <span class="text-[26px] leading-none">{{ o.value }}</span>
                  <span class="text-xs">{{ o.label }}</span>
                </button>
              </div>
            </div>
          </template>
          <TagPicker ref="picker" :card-id="card.id" :editing="editing" :model-value="tags" @update:model-value="onTags" />
          <textarea
            v-model="note"
            rows="4"
            :placeholder="t('sheet.notePlaceholder')"
            class="mt-4 w-full resize-none rounded-xl border border-zinc-200 p-3 text-base outline-none focus:border-indigo-400"
          />
        </div>
        <footer class="shrink-0 border-t border-zinc-200 px-4 pt-3 pb-[calc(0.75rem+env(safe-area-inset-bottom))]">
          <div v-if="editing" class="grid grid-cols-2 gap-3">
            <button class="h-12 rounded-xl bg-zinc-100 font-semibold" @click="picker?.addGroup()">{{ t('sheet.addGroup') }}</button>
            <button class="h-12 rounded-xl bg-indigo-600 font-semibold text-white" @click="editing = false">{{ t('common.done') }}</button>
          </div>
          <template v-else>
            <p v-if="missing.length" class="mb-2 text-center text-sm text-zinc-500">
              {{ t('sheet.missing', { names: new Intl.ListFormat(locale).format(missing) }) }}
            </p>
            <p v-else-if="submit.error.value" class="mb-2 text-center text-sm text-red-600">{{ submit.error.value.message }}</p>
            <div class="grid grid-cols-2 gap-3">
              <button class="h-12 rounded-xl bg-zinc-100 font-semibold" @click="requestClose">{{ t('common.cancel') }}</button>
              <button
                class="h-12 rounded-xl bg-indigo-600 font-semibold text-white disabled:opacity-40"
                :disabled="values === null || missing.length > 0 || submit.isPending.value || leaving"
                @click="submit.mutate()"
              >
                {{ t('sheet.submit') }}
              </button>
            </div>
          </template>
        </footer>
      </section>

      <TimeOffsetPopup v-if="timePopup" v-model="happenedAt" @close="timePopup = false" />
      <div v-if="confirming" class="absolute inset-0 flex items-end bg-black/40" @click.self="confirming = false">
        <div
          role="alertdialog"
          :aria-label="t('sheet.discardLabel')"
          class="w-full rounded-t-2xl bg-white p-4 pb-[calc(1rem+env(safe-area-inset-bottom))]"
        >
          <p class="mb-1 text-center font-semibold">{{ t('sheet.discardTitle') }}</p>
          <p class="mb-4 text-center text-sm text-zinc-500">{{ t('sheet.discardBody') }}</p>
          <button class="mb-2 h-12 w-full rounded-xl bg-red-500 font-semibold text-white" @click="discard">{{ t('sheet.discard') }}</button>
          <button class="h-12 w-full rounded-xl bg-zinc-100 font-semibold" @click="confirming = false">{{ t('sheet.keepEditing') }}</button>
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
.choice {
  display: flex;
  flex-direction: column;
  align-items: center;
  justify-content: center;
  gap: 4px;
  min-height: 64px;
  border: 1px solid #e5e7eb;
  border-radius: 12px;
  color: #6b7280;
}
.choice.on {
  border-color: #818cf8;
  background: #eef2ff;
  color: #3730a3;
  font-weight: 600;
}
</style>
