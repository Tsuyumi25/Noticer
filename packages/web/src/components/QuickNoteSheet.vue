<script setup lang="ts">
import { useMutation, useQueries, useQuery, useQueryClient } from '@tanstack/vue-query'
import { ChevronRight, Clock, Trash2 } from 'lucide-vue-next'
import { PURE_CARD } from 'server/pure'
import { computed, onMounted, onUnmounted, ref } from 'vue'
import { api } from '../api.ts'
import { t } from '../i18n/index.ts'
import { useSheetDrag } from '../sheetDrag.ts'
import { absoluteTime, relativeTime } from '../time.ts'
import type { Attachment } from '../attachments.ts'
import AttachmentField from './AttachmentField.vue'
import type { SheetEvent } from './CheckinSheet.vue'
import TimeOffsetPopup from './TimeOffsetPopup.vue'
import VersionTabs from './VersionTabs.vue'
import { pickedDeleted, type VersionPick } from '../versions.ts'

/** A record that belongs to no card: start from any card's tag, or type a new one. */
/** `at`: when a new note starts out, if not now. */
const props = defineProps<{ event?: SheetEvent; at?: number; versions?: VersionPick; instant?: boolean }>()
const emit = defineEmits<{ close: []; version: [index: number] }>()
const gone = computed(() => pickedDeleted(props.versions))

const initialNote = props.event?.note ?? ''
const initialTags = [...(props.event?.tags ?? [])].sort().join('\n')
const initialHappenedAt = props.event ? props.event.eventAt * 1000 : (props.at ?? null)
const note = ref(initialNote)
const initialAttachments = (props.event?.attachments ?? []).map((a) => a.id).join('\n')
const attachments = ref<Attachment[]>([...(props.event?.attachments ?? [])])
const uploading = ref(false)
const tags = ref<string[]>([...(props.event?.tags ?? [])])
const happenedAt = ref<number | null>(initialHappenedAt)
const timePopup = ref(false)
const timeLabel = computed(() => {
  if (happenedAt.value === null) return t('time.now')
  const now = Date.now()
  return `${relativeTime(happenedAt.value, now)} · ${absoluteTime(happenedAt.value, now)}`
})

const { data: start } = useQuery({
  queryKey: ['pure'],
  queryFn: async () => {
    const res = await api.pure.$get()
    if (!res.ok) throw new Error(`pure: ${res.status}`)
    return res.json()
  },
})

const selected = computed(() => new Set(tags.value))
/** Picking a card's tag opens that tag's list below it. */
const openRoots = computed(() => (start.value?.roots ?? []).filter((r) => selected.value.has(r.tag)))
const rootLists = useQueries({
  queries: computed(() =>
    openRoots.value.map((r) => ({
      queryKey: ['rootTags', r.tag],
      queryFn: async () => {
        const res = await api.roots[':tag'].tags.$get({ param: { tag: r.tag } })
        if (!res.ok) throw new Error(`root tags: ${res.status}`)
        return res.json()
      },
    })),
  ),
})
const sections = computed(() =>
  openRoots.value.map((root, i) => ({ root, groups: (rootLists.value[i]?.data?.groups ?? []).filter((g) => g.tags.length > 0) })),
)
/** Picked tags no open list shows, so they can still be taken off. */
const loose = computed(() => {
  const shown = new Set([
    ...(start.value?.roots ?? []).map((r) => r.tag),
    ...sections.value.flatMap((s) => s.groups.flatMap((g) => g.tags.map((x) => x.label))),
  ])
  return tags.value.filter((tag) => !shown.has(tag))
})

function toggle(tag: string) {
  tags.value = selected.value.has(tag) ? tags.value.filter((x) => x !== tag) : [...tags.value, tag]
}

const adding = ref<string | null>(null)
function addTag() {
  const label = (adding.value ?? '').trim()
  if (label !== '' && !selected.value.has(label)) tags.value = [...tags.value, label]
  adding.value = null
}
const vFocus = { mounted: (el: HTMLElement) => el.focus() }

const empty = computed(() => tags.value.length === 0 && note.value.trim() === '' && attachments.value.length === 0)
const dirty = computed(
  () =>
    note.value.trim() !== initialNote.trim() ||
    happenedAt.value !== initialHappenedAt ||
    [...tags.value].sort().join('\n') !== initialTags ||
    attachments.value.map((a) => a.id).join('\n') !== initialAttachments,
)

const queryClient = useQueryClient()
function refresh() {
  for (const key of ['dashboard', 'events', 'conflicts', 'cardTags', 'rootTags', 'pure', 'media', 'search', 'days']) queryClient.invalidateQueries({ queryKey: [key] })
  queryClient.invalidateQueries({ queryKey: ['calendar'], refetchType: 'all' })
  queryClient.invalidateQueries({ queryKey: ['sleepAnalysis'], refetchType: 'all' })
  leave()
}
const submit = useMutation({
  mutationFn: async () => {
    const json = { note: note.value, tags: tags.value, attachments: attachments.value.map((a) => a.id) }
    const res = props.event
      ? await api.events[':id'].$put({
          param: { id: String(props.event.id) },
          json: { ...json, eventAt: Math.floor((happenedAt.value ?? Date.now()) / 1000) },
        })
      : await api.checkin.$post({
          json: { ...json, cardId: PURE_CARD, timeOffset: happenedAt.value === null ? 0 : Math.min(0, Math.round((happenedAt.value - Date.now()) / 1000)) },
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

const { sheet, sheetStyle, backdrop, animated, leaving, leave, settle, isLeaveEnd, onTouchStart, onTouchMove, onTouchEnd } = useSheetDrag({
  onRequestClose: requestClose,
  canDrag: () => !confirming.value && !deleting.value && adding.value === null,
  instant: props.instant,
})

function requestClose() {
  if (leaving.value) return
  if (!dirty.value) return leave()
  settle()
  confirming.value = true
}

function onTransitionEnd(e: TransitionEvent) {
  if (isLeaveEnd(e)) emit('close')
}

function onKeydown(e: KeyboardEvent) {
  if (e.key !== 'Escape') return
  if (timePopup.value) timePopup.value = false
  else if (adding.value !== null) adding.value = null
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
      <div class="absolute inset-0 bg-black" :class="{ 'sheet-animated': animated }" :style="{ opacity: backdrop }" />
      <section
        ref="sheet"
        class="full-sheet"
        :class="{ 'sheet-animated': animated }"
        :style="sheetStyle"
        @touchstart="onTouchStart"
        @touchmove="onTouchMove"
        @touchend="onTouchEnd"
        @touchcancel="onTouchEnd"
        @transitionend="onTransitionEnd"
      >
        <div class="mx-auto mt-2 h-1 w-10 shrink-0 rounded-full bg-zinc-300" />
        <div class="flex h-12 shrink-0 items-center px-4">
          <h2 class="text-lg font-semibold">📝 {{ t('nav.quickNote') }}</h2>
        </div>
        <VersionTabs v-if="versions" :pick="versions" @pick="emit('version', $event)" />
        <div v-if="!gone" class="min-h-0 flex-1 overflow-y-auto overscroll-contain px-4 pb-4">
          <button class="mb-1 flex min-h-12 w-full items-center justify-between rounded-xl border border-zinc-200 px-3" @click="timePopup = true">
            <span class="flex shrink-0 items-center gap-2 whitespace-nowrap"><Clock :size="18" class="text-zinc-400" />{{ t('sheet.time') }}</span>
            <span class="flex min-w-0 items-center gap-1 pl-2 text-right" :class="happenedAt === null ? 'text-zinc-500' : 'font-semibold text-amber-700'">
              {{ timeLabel }}<ChevronRight :size="18" class="text-zinc-400" />
            </span>
          </button>

          <div class="chips mt-3">
            <button v-for="r in start?.roots ?? []" :key="r.tag" class="chip" :class="{ on: selected.has(r.tag) }" @click="toggle(r.tag)">
              <span v-if="r.emoji" class="emoji">{{ r.emoji }}</span>{{ r.tag }}
            </button>
          </div>

          <section v-for="s in sections" :key="s.root.tag" class="mt-4">
            <div v-for="g in s.groups" :key="g.name" class="mt-3">
              <h4 class="gtitle" :style="{ borderLeftColor: g.color }">{{ s.root.emoji }} {{ g.name }}</h4>
              <div class="chips">
                <button v-for="x in g.tags" :key="x.label" class="chip" :class="{ on: selected.has(x.label) }" @click="toggle(x.label)">
                  <span v-if="x.emoji" class="emoji">{{ x.emoji }}</span>{{ x.label }}
                </button>
              </div>
            </div>
          </section>

          <div class="chips mt-4">
            <button v-for="tag in loose" :key="tag" class="chip on" @click="toggle(tag)">{{ tag }}</button>
            <button class="chip add" @click="adding = ''">{{ t('tags.custom') }}</button>
          </div>

          <textarea
            v-model="note"
            rows="4"
            :placeholder="t('sheet.notePlaceholder')"
            class="mt-4 w-full resize-none rounded-xl border border-zinc-200 p-3 text-base outline-none focus:border-indigo-400"
          />
          <AttachmentField v-model="attachments" v-model:busy="uploading" />
        </div>
        <footer class="shrink-0 border-t border-zinc-200 px-4 pt-3 pb-[calc(0.75rem+env(safe-area-inset-bottom))]">
          <p v-if="submit.error.value" class="mb-2 text-center text-sm text-red-600">{{ submit.error.value.message }}</p>
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
              :disabled="empty || uploading || submit.isPending.value || leaving"
              @click="submit.mutate()"
            >
              {{ t(event ? 'sheet.save' : 'sheet.submit') }}
            </button>
          </div>
        </footer>
      </section>

      <TimeOffsetPopup v-if="timePopup" v-model="happenedAt" @close="timePopup = false" />
      <div v-if="adding !== null" class="absolute inset-0 flex items-end bg-black/40" @click.self="adding = null">
        <form class="w-full rounded-t-2xl bg-white p-4 pb-[calc(1rem+env(safe-area-inset-bottom))]" @submit.prevent="addTag">
          <p class="mb-2 font-semibold">{{ t('quickNote.newTag') }}</p>
          <input v-model="adding" v-focus list="quick-note-tags" class="h-11 w-full rounded-xl border border-zinc-300 px-3 text-base" />
          <datalist id="quick-note-tags">
            <option v-for="tag in start?.tags ?? []" :key="tag" :value="tag" />
          </datalist>
          <button type="submit" class="mt-3 h-12 w-full rounded-xl bg-indigo-600 font-semibold text-white">{{ t('common.ok') }}</button>
          <button type="button" class="mt-2 h-12 w-full rounded-xl bg-zinc-100 font-semibold" @click="adding = null">{{ t('common.cancel') }}</button>
        </form>
      </div>
      <div v-if="confirming" class="absolute inset-0 flex items-end bg-black/40" @click.self="confirming = false">
        <div role="alertdialog" :aria-label="t('sheet.discardLabel')" class="w-full rounded-t-2xl bg-white p-4 pb-[calc(1rem+env(safe-area-inset-bottom))]">
          <p class="mb-1 text-center font-semibold">{{ t('sheet.discardTitle') }}</p>
          <p class="mb-4 text-center text-sm text-zinc-500">{{ t('sheet.discardBody') }}</p>
          <button class="mb-2 h-12 w-full rounded-xl bg-red-500 font-semibold text-white" @click="confirming = false; leave()">{{ t('sheet.discard') }}</button>
          <button class="h-12 w-full rounded-xl bg-zinc-100 font-semibold" @click="confirming = false">{{ t('sheet.keepEditing') }}</button>
        </div>
      </div>
      <div v-if="deleting" class="absolute inset-0 flex items-end bg-black/40" @click.self="deleting = false">
        <div role="alertdialog" :aria-label="t('sheet.deleteTitle')" class="w-full rounded-t-2xl bg-white p-4 pb-[calc(1rem+env(safe-area-inset-bottom))]">
          <p class="mb-4 text-center font-semibold">{{ t('sheet.deleteTitle') }}</p>
          <p v-if="remove.error.value" class="mb-2 text-center text-sm text-red-600">{{ remove.error.value.message }}</p>
          <button class="mb-2 h-12 w-full rounded-xl bg-red-500 font-semibold text-white disabled:opacity-40" :disabled="remove.isPending.value" @click="remove.mutate()">
            {{ t('sheet.delete') }}
          </button>
          <button class="h-12 w-full rounded-xl bg-zinc-100 font-semibold" @click="deleting = false">{{ t('common.cancel') }}</button>
        </div>
      </div>
    </div>
  </Teleport>
</template>

<style scoped>
.chips {
  display: flex;
  flex-wrap: wrap;
  gap: 8px;
}
.chip {
  position: relative;
  display: inline-flex;
  align-items: center;
  gap: 4px;
  padding: 8px 12px;
  border: 2px solid #e5e7eb;
  border-radius: 12px;
  background: white;
  font-size: 0.95rem;
}
.chip::after {
  content: '';
  position: absolute;
  inset: -4px 0;
}
.chip .emoji {
  font-size: 1.2rem;
  line-height: 1;
}
.chip.on {
  border-color: #667eea;
  background: #667eea;
  color: white;
}
.chip.add {
  border-style: dashed;
  color: #6b7280;
}
.gtitle {
  margin: 0 0 8px;
  padding-left: 8px;
  border-left: 3px solid;
  font-size: 0.9rem;
  font-weight: 600;
}
</style>
