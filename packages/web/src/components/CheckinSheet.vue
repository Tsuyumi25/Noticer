<script setup lang="ts">
import { useMutation, useQuery, useQueryClient } from '@tanstack/vue-query'
import { ChevronRight, Clock, Pencil, Trash2 } from 'lucide-vue-next'
import { computed, onMounted, onUnmounted, ref, watch } from 'vue'
import { api } from '../api.ts'
import { locale, t } from '../i18n/index.ts'
import { useSheetDrag } from '../sheetDrag.ts'
import { PAD_ROW_COMPONENTS } from '../plugins/index.ts'
import type { Attachment } from '../attachments.ts'
import { absoluteTime, relativeTime } from '../time.ts'
import AttachmentField from './AttachmentField.vue'
import TagPicker from './TagPicker.vue'
import TimeOffsetPopup from './TimeOffsetPopup.vue'
import ValuePad from './ValuePad.vue'
import VersionTabs from './VersionTabs.vue'
import CheckinCalendar from './CheckinCalendar.vue'
import { isDesktop } from '../viewport.ts'
import { pickedDeleted, type VersionPick } from '../versions.ts'

export interface SheetCard {
  id: string
  name: string
  emoji: string
}

/** A recorded event to edit instead of a new checkin. */
export interface SheetEvent {
  id: number
  eventAt: number
  note: string | null
  tags: string[]
  facts: Record<string, string | number | boolean>
  attachments: Attachment[]
}

const props = defineProps<{ card: SheetCard; event?: SheetEvent; versions?: VersionPick; instant?: boolean }>()
const emit = defineEmits<{ close: []; version: [index: number] }>()
const gone = computed(() => pickedDeleted(props.versions))

const initialNote = props.event?.note ?? ''
const note = ref(initialNote)
const initialAttachments = (props.event?.attachments ?? []).map((a) => a.id).join('\n')
const attachments = ref<Attachment[]>([...(props.event?.attachments ?? [])])
const uploading = ref(false)
/** Null until the picker loads this card's preselected tags. */
const tags = ref<string[] | null>(props.event ? [...props.event.tags] : null)
let initialTags: string | null = props.event ? [...props.event.tags].sort().join('\n') : null
function onTags(next: string[]) {
  if (tags.value === null) initialTags = [...next].sort().join('\n')
  tags.value = next
}
/** When it happened, in ms; null means now. */
const initialHappenedAt = props.event ? props.event.eventAt * 1000 : null
const happenedAt = ref<number | null>(initialHappenedAt)
const timePopup = ref(false)
const timeLabel = computed(() => {
  if (happenedAt.value === null) return t('time.now')
  const now = Date.now()
  const at = absoluteTime(happenedAt.value, now)
  return isDesktop.value ? `${relativeTime(happenedAt.value, now)} · ${at}` : at
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
const choices = ref<Record<string, string | null> | null>(null)
/** The number each picked value tag, and each of the card's own value tags, carries; null when left blank. */
const amounts = ref<Record<string, number | null>>({})
/** The tag whose number the keypad is setting. */
const pad = ref<string | null>(null)
let initialAmounts = ''
let initialChoices = ''
watch(
  inputs,
  (list) => {
    if (!list || choices.value !== null) return
    const recorded = props.event?.facts ?? {}
    choices.value = Object.fromEntries(list.choices.map((i) => [i.key, typeof recorded[i.key] === 'string' ? (recorded[i.key] as string) : null]))
    for (const v of list.values) {
      if (props.event) {
        const value = recorded[`${v.tag}:${v.unit}`]
        if (typeof value === 'number') amounts.value[v.tag] = value
        else if (v.auto || tags.value?.includes(v.tag)) amounts.value[v.tag] = null
      } else if (v.auto || tags.value?.includes(v.tag)) amounts.value[v.tag] = v.default
    }
    initialAmounts = JSON.stringify(amounts.value)
    initialChoices = JSON.stringify(choices.value)
    if (!props.event) pad.value = list.values.find((v) => v.auto && v.open)?.tag ?? null
  },
  { immediate: true },
)
const specOf = computed(() => new Map((inputs.value?.values ?? []).map((v) => [v.tag, v])))
const autoValues = computed(() => (inputs.value?.values ?? []).filter((v) => v.auto))

// Picking a value tag puts in its default; dropping it drops the number.
watch(tags, (next, prev) => {
  const now = new Set(next ?? [])
  for (const tag of now) if (!(tag in amounts.value) && specOf.value.has(tag)) amounts.value[tag] = specOf.value.get(tag)!.default
  for (const tag of prev ?? []) if (!now.has(tag) && !specOf.value.get(tag)?.auto) delete amounts.value[tag]
})

function setAmount(tag: string, value: number | null) {
  amounts.value[tag] = value
  if (!specOf.value.get(tag)?.auto && !(tags.value ?? []).includes(tag)) tags.value = [...(tags.value ?? []), tag]
  pad.value = null
}
function dropAmount(tag: string) {
  if (specOf.value.get(tag)?.auto) amounts.value[tag] = null
  else tags.value = (tags.value ?? []).filter((t) => t !== tag)
  pad.value = null
}
const padValue = computed(() => (pad.value === null ? null : pad.value in amounts.value ? amounts.value[pad.value]! : (specOf.value.get(pad.value)?.default ?? null)))
const amountText = (tag: string) => {
  const v = amounts.value[tag]
  return v === null || v === undefined ? '—' : v.toFixed(specOf.value.get(tag)!.decimals)
}

const missing = computed(() => (inputs.value?.choices ?? []).filter((i) => i.required && choices.value?.[i.key] == null).map((i) => i.name))
function pick(key: string, value: string) {
  choices.value![key] = choices.value![key] === value ? null : value
}

const dirty = computed(
  () =>
    note.value.trim() !== initialNote.trim() ||
    happenedAt.value !== initialHappenedAt ||
    (tags.value !== null && [...tags.value].sort().join('\n') !== initialTags) ||
    (choices.value !== null && JSON.stringify(choices.value) !== initialChoices) ||
    JSON.stringify(amounts.value) !== initialAmounts ||
    attachments.value.map((a) => a.id).join('\n') !== initialAttachments,
)

const editing = ref(false)
const picker = ref<InstanceType<typeof TagPicker> | null>(null)

const queryClient = useQueryClient()
function refresh() {
  queryClient.invalidateQueries({ queryKey: ['dashboard'] })
  queryClient.invalidateQueries({ queryKey: ['events'] })
  queryClient.invalidateQueries({ queryKey: ['conflicts'] })
  queryClient.invalidateQueries({ queryKey: ['cardTags'] })
  queryClient.invalidateQueries({ queryKey: ['cardInputs'] })
  queryClient.invalidateQueries({ queryKey: ['media'] })
  queryClient.invalidateQueries({ queryKey: ['days'] })
  queryClient.invalidateQueries({ queryKey: ['search'] })
  // Closed report sheets refetch now, so reopening one shows the change at once.
  queryClient.invalidateQueries({ queryKey: ['calendar'], refetchType: 'all' })
  queryClient.invalidateQueries({ queryKey: ['sleepAnalysis'], refetchType: 'all' })
  leave()
}
const submit = useMutation({
  mutationFn: async () => {
    const facts: Record<string, number | string> = {}
    for (const [key, v] of Object.entries(choices.value ?? {})) if (v !== null) facts[key] = v
    for (const [tag, v] of Object.entries(amounts.value)) if (v !== null) facts[`${tag}:${specOf.value.get(tag)!.unit}`] = v
    const json = { note: note.value, tags: tags.value ?? [], facts, attachments: attachments.value.map((a) => a.id) }
    const res = props.event
      ? await api.events[':id'].$put({
          param: { id: String(props.event.id) },
          json: { ...json, eventAt: Math.floor((happenedAt.value ?? Date.now()) / 1000) },
        })
      : await api.checkin.$post({
          json: { ...json, cardId: props.card.id, timeOffset: happenedAt.value === null ? 0 : Math.min(0, Math.round((happenedAt.value - Date.now()) / 1000)) },
        })
    if (!res.ok) throw new Error(t('sheet.submitFailed', { status: res.status }))
  },
  onSuccess: refresh,
})
const remove = useMutation({
  mutationFn: async () => {
    const res = await api.events[':id'].$delete({ param: { id: String(props.event!.id) } })
    if (!res.ok) throw new Error(t('sheet.deleteFailed', { status: res.status }))
  },
  onSuccess: () => {
    deleting.value = false
    refresh()
  },
})

const confirming = ref(false)
const deleting = ref(false)

const centered = isDesktop.value
const overlayClass = centered ? 'absolute inset-0 flex items-center justify-center bg-black/40' : 'absolute inset-0 flex items-end bg-black/40'
const panelClass = centered ? 'w-full max-w-sm rounded-2xl bg-white p-4' : 'w-full rounded-t-2xl bg-white p-4 pb-[calc(1rem+env(safe-area-inset-bottom))]'

const { sheet, sheetStyle, backdrop, animated, leaving, leave, settle, isLeaveEnd, onTouchStart, onTouchMove, onTouchEnd } =
  useSheetDrag({
    onRequestClose: requestClose,
    // While editing, a press on a tag may become a drag; it must not pull the sheet.
    canDrag: (e) => !confirming.value && !deleting.value && !(editing.value && (e.target as Element).closest('[data-tag]')),
    instant: props.instant,
    centered,
    onLeft: () => emit('close'),
  })

function requestClose() {
  if (leaving.value) return
  if (!dirty.value) return leave()
  settle()
  confirming.value = true
}

function discard() {
  confirming.value = false
  leave()
}

function onTransitionEnd(e: TransitionEvent) {
  if (isLeaveEnd(e)) emit('close')
}

function onKeydown(e: KeyboardEvent) {
  if (e.key !== 'Escape') return
  if (timePopup.value) timePopup.value = false
  else if (pad.value) pad.value = null
  else if (confirming.value) confirming.value = false
  else if (deleting.value) deleting.value = false
  else requestClose()
}

onMounted(() => window.addEventListener('keydown', onKeydown))
onUnmounted(() => window.removeEventListener('keydown', onKeydown))
</script>

<template>
  <Teleport to="body">
    <div class="fixed inset-0 z-50">
      <div class="absolute inset-0 bg-black" :class="{ 'sheet-animated': animated }" :style="{ opacity: backdrop }" @click="centered && requestClose()" />
      <section
        ref="sheet"
        :class="[centered ? 'center-dialog' : 'full-sheet', { 'sheet-animated': animated }]"
        :style="sheetStyle"
        @touchstart="onTouchStart"
        @touchmove="onTouchMove"
        @touchend="onTouchEnd"
        @touchcancel="onTouchEnd"
        @transitionend="onTransitionEnd"
      >
        <div class="flex min-h-0 min-w-0 flex-1 flex-col">
          <div v-if="!centered" class="mx-auto mt-2 h-1 w-10 shrink-0 rounded-full bg-zinc-300" />
          <div class="flex shrink-0 items-center justify-between py-1 pr-2 pl-4">
            <h2 class="text-lg font-semibold">
              {{ card.emoji }} {{ card.name }}<span v-if="editing" class="text-sm font-medium text-amber-700">{{ t('sheet.editing') }}</span>
            </h2>
            <button v-if="editing" class="h-11 min-w-11 px-2 font-semibold text-indigo-600" @click="editing = false">{{ t('common.done') }}</button>
            <button v-else class="flex h-11 min-w-11 items-center gap-1 px-2 text-zinc-400" @click="editing = true">
              <Pencil :size="16" />{{ t('sheet.edit') }}
            </button>
          </div>
          <VersionTabs v-if="versions" :pick="versions" @pick="emit('version', $event)" />
          <div v-if="!gone" class="min-h-0 flex-1 overflow-y-auto overscroll-contain px-4 pb-4">
            <button
              class="mb-1 flex min-h-12 w-full items-center justify-between rounded-xl border border-zinc-200 px-3"
              @click="timePopup = true"
            >
              <span class="flex shrink-0 items-center gap-2 whitespace-nowrap"><Clock :size="18" class="text-zinc-400" />{{ t('sheet.time') }}</span>
              <span class="flex min-w-0 items-center gap-1 pl-2 text-right" :class="happenedAt === null ? 'text-zinc-500' : 'font-semibold text-amber-700'">
                {{ timeLabel }}<ChevronRight :size="18" class="text-zinc-400" />
              </span>
            </button>
            <div v-if="autoValues.length" class="mt-3 flex flex-wrap gap-2">
              <span v-for="v in autoValues" :key="v.tag" class="vchip" :class="{ active: pad === v.tag }">
                <span class="vname">{{ v.tag }}</span>
                <button class="vamount" @click="pad = v.tag">{{ amountText(v.tag) }}<small>{{ v.unit }}</small></button>
              </span>
            </div>
            <div v-for="input in choices ? (inputs?.choices ?? []) : []" :key="input.key" class="mt-3 mb-1">
              <p class="mb-1.5 text-sm text-zinc-500">
                {{ input.name }}<span v-if="!input.required"> · {{ t('fact.optional') }}</span>
              </p>
              <div class="grid gap-1.5" :style="{ gridTemplateColumns: `repeat(${input.options.length}, 1fr)` }">
                <button
                  v-for="o in input.options"
                  :key="o.value"
                  class="choice"
                  :class="{ on: choices?.[input.key] === o.value }"
                  @click="pick(input.key, o.value)"
                >
                  <span class="text-[26px] leading-none">{{ o.value }}</span>
                  <span class="text-xs">{{ o.label }}</span>
                </button>
              </div>
            </div>
            <TagPicker
              ref="picker"
              :card-id="card.id"
              :editing="editing"
              :model-value="tags"
              :values="inputs?.values ?? []"
              :amounts="amounts"
              :active-value="pad"
              @update:model-value="onTags"
              @value="pad = $event"
            />
            <textarea
              v-model="note"
              rows="4"
              :placeholder="t('sheet.notePlaceholder')"
              class="mt-4 w-full resize-none rounded-xl border border-zinc-200 p-3 text-base outline-none focus:border-indigo-400"
            />
            <AttachmentField v-model="attachments" v-model:busy="uploading" />
          </div>
          <ValuePad
            v-if="pad && specOf.get(pad)"
            :key="pad"
            :label="pad"
            :unit="specOf.get(pad)!.unit"
            :decimals="specOf.get(pad)!.decimals"
            :value="padValue"
            :candidates="specOf.get(pad)!.candidates"
            :fallback="specOf.get(pad)!.default"
            :row="specOf.get(pad)!.pad ? PAD_ROW_COMPONENTS[specOf.get(pad)!.pad!] : undefined"
            skippable
            removable
            @done="setAmount(pad!, $event)"
            @remove="dropAmount(pad!)"
            @cancel="pad = null"
          >
            <template #aside>
              <span class="text-xs text-zinc-500">{{ specOf.get(pad)!.unit }} · {{ t(specOf.get(pad)!.keep === 'sum' ? 'pad.sum' : 'pad.latest') }}</span>
            </template>
          </ValuePad>
          <footer v-else class="shrink-0 border-t border-zinc-200 px-4 pt-3 pb-[calc(0.75rem+env(safe-area-inset-bottom))]">
            <div v-if="editing" class="grid grid-cols-2 gap-3">
              <button class="h-12 rounded-xl bg-zinc-100 font-semibold" @click="picker?.addGroup()">{{ t('sheet.addGroup') }}</button>
              <button class="h-12 rounded-xl bg-indigo-600 font-semibold text-white" @click="editing = false">{{ t('common.done') }}</button>
            </div>
            <template v-else>
              <p v-if="missing.length" class="mb-2 text-center text-sm text-zinc-500">
                {{ t('sheet.missing', { names: new Intl.ListFormat(locale).format(missing) }) }}
              </p>
              <p v-else-if="submit.error.value" class="mb-2 text-center text-sm text-red-600">{{ submit.error.value.message }}</p>
              <div v-if="gone" class="flex gap-3">
                <button class="h-12 flex-1 rounded-xl bg-zinc-100 font-semibold" @click="requestClose">{{ t('common.cancel') }}</button>
                <button class="h-12 flex-1 rounded-xl bg-red-600 font-semibold text-white" @click="deleting = true">{{ t('sheet.delete') }}</button>
              </div>
              <div v-else class="flex gap-3">
                <button
                  v-if="event"
                  class="flex h-12 w-12 shrink-0 items-center justify-center rounded-xl bg-red-50 text-red-600"
                  :aria-label="t('sheet.delete')"
                  @click="deleting = true"
                >
                  <Trash2 :size="20" />
                </button>
                <button class="h-12 flex-1 rounded-xl bg-zinc-100 font-semibold" @click="requestClose">{{ t('common.cancel') }}</button>
                <button
                  class="h-12 flex-1 rounded-xl bg-indigo-600 font-semibold text-white disabled:opacity-40"
                  :disabled="choices === null || missing.length > 0 || uploading || submit.isPending.value || leaving"
                  @click="submit.mutate()"
                >
                  {{ t(event ? 'sheet.save' : 'sheet.submit') }}
                </button>
              </div>
            </template>
          </footer>
        </div>
        <CheckinCalendar v-if="centered" :card-id="card.id" :at="happenedAt" @pick="happenedAt = $event" />
      </section>

      <TimeOffsetPopup v-if="timePopup" v-model="happenedAt" @close="timePopup = false" />
      <div v-if="confirming" :class="overlayClass" @click.self="confirming = false">
        <div
          role="alertdialog"
          :aria-label="t('sheet.discardLabel')"
          :class="panelClass"
        >
          <p class="mb-1 text-center font-semibold">{{ t('sheet.discardTitle') }}</p>
          <p class="mb-4 text-center text-sm text-zinc-500">{{ t('sheet.discardBody') }}</p>
          <button class="mb-2 h-12 w-full rounded-xl bg-red-500 font-semibold text-white" @click="discard">{{ t('sheet.discard') }}</button>
          <button class="h-12 w-full rounded-xl bg-zinc-100 font-semibold" @click="confirming = false">{{ t('sheet.keepEditing') }}</button>
        </div>
      </div>
      <div v-if="deleting" :class="overlayClass" @click.self="deleting = false">
        <div role="alertdialog" :aria-label="t('sheet.deleteTitle')" :class="panelClass">
          <p class="mb-4 text-center font-semibold">{{ t('sheet.deleteTitle') }}</p>
          <p v-if="remove.error.value" class="mb-2 text-center text-sm text-red-600">{{ remove.error.value.message }}</p>
          <button
            class="mb-2 h-12 w-full rounded-xl bg-red-500 font-semibold text-white disabled:opacity-40"
            :disabled="remove.isPending.value"
            @click="remove.mutate()"
          >
            {{ t('sheet.delete') }}
          </button>
          <button class="h-12 w-full rounded-xl bg-zinc-100 font-semibold" @click="deleting = false">{{ t('common.cancel') }}</button>
        </div>
      </div>
    </div>
  </Teleport>
</template>

<style scoped>
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
.vchip {
  display: inline-flex;
  align-items: stretch;
  border: 2px solid #667eea;
  border-radius: 12px;
  background: #667eea;
  color: white;
  font-size: 0.9rem;
  font-weight: 500;
  overflow: hidden;
}
.vchip .vname {
  display: inline-flex;
  align-items: center;
  padding: 8px 10px 8px 12px;
}
.vchip .vamount {
  position: relative;
  min-width: 44px;
  padding: 8px 10px;
  border-left: 1px solid rgb(255 255 255 / 0.35);
  background: #5a67d8;
  font-weight: 700;
  font-variant-numeric: tabular-nums;
}
.vchip .vamount small {
  margin-left: 2px;
  font-weight: 500;
  opacity: 0.8;
}
.vchip .vamount::after {
  content: '';
  position: absolute;
  inset: -4px 0;
}
.vchip.active {
  outline: 2px solid #312e81;
  outline-offset: 1px;
}
</style>
