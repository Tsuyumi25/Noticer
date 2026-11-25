<script setup lang="ts">
import { useMutation, useQuery, useQueryClient } from '@tanstack/vue-query'
import { Trash2 } from 'lucide-vue-next'
import { computed, onMounted, onUnmounted, ref, watch } from 'vue'
import { api } from '../api.ts'
import { refetchAfterEventWrite } from '../eventWrites.ts'
import { t } from '../i18n/index.ts'
import { useSheetDrag } from '../sheetDrag.ts'
import { isDesktop } from '../viewport.ts'
import RulesEditor from './rules/RulesEditor.vue'

const props = defineProps<{ cardId: string }>()
const emit = defineEmits<{ close: []; deleted: [] }>()

const { data, isPending, isError } = useQuery({
  queryKey: computed(() => ['rules', props.cardId]),
  queryFn: async () => {
    const res = await api.cards[':cardId'].rules.$get({ param: { cardId: props.cardId } })
    if (!res.ok) throw new Error(`rules: ${res.status}`)
    return res.json()
  },
  staleTime: 0,
  gcTime: 0,
})

const editor = ref<InstanceType<typeof RulesEditor> | null>(null)
const confirming = ref(false)

const name = ref('')
const emoji = ref('')
let filled = false
watch(
  () => data.value?.card,
  (card) => {
    if (!card || filled) return
    filled = true
    name.value = card.name
    emoji.value = card.emoji
  },
  { immediate: true },
)
const renamed = computed(() => !!data.value && (name.value.trim() !== data.value.card.name || emoji.value.trim() !== data.value.card.emoji))
const dirty = computed(() => !!editor.value?.dirty || renamed.value)
const blank = computed(() => name.value.trim() === '' || emoji.value.trim() === '')

const queryClient = useQueryClient()
const save = useMutation({
  mutationFn: async () => {
    if (renamed.value) {
      const res = await api.cards[':cardId'].$put({ param: { cardId: props.cardId }, json: { name: name.value, emoji: emoji.value } })
      if (!res.ok) throw new Error(t('rules.saveFailed', { status: res.status }))
    }
    if (editor.value?.dirty) {
      const res = await api.cards[':cardId'].rules.$put({ param: { cardId: props.cardId }, json: editor.value.draft })
      if (!res.ok) throw new Error(t('rules.saveFailed', { status: res.status }))
    }
  },
  onSuccess: () => {
    for (const key of ['dashboard', 'cards', 'config']) queryClient.invalidateQueries({ queryKey: [key] })
    queryClient.invalidateQueries({ queryKey: ['calendar', props.cardId] })
    leave()
  },
})

const deleting = ref(false)
const remove = useMutation({
  mutationFn: async () => {
    const res = await api.cards[':cardId'].$delete({ param: { cardId: props.cardId } })
    if (!res.ok) throw new Error(t('sheet.deleteFailed', { status: res.status }))
  },
  onSuccess: () => {
    refetchAfterEventWrite(queryClient)
    for (const key of ['cards', 'config']) queryClient.invalidateQueries({ queryKey: [key] })
    deleting.value = false
    emit('deleted')
    leave()
  },
})

const centered = isDesktop.value
const overlayClass = centered ? 'absolute inset-0 flex items-center justify-center bg-black/40' : 'absolute inset-0 flex items-end bg-black/40'
const panelClass = centered ? 'w-full max-w-sm rounded-2xl bg-white p-4' : 'w-full rounded-t-2xl bg-white p-4 pb-[calc(1rem+env(safe-area-inset-bottom))]'

const { sheet, sheetStyle, backdrop, animated, leaving, leave, settle, isLeaveEnd, onTouchStart, onTouchMove, onTouchEnd } = useSheetDrag({
  onRequestClose: requestClose,
  canDrag: () => !confirming.value && !deleting.value,
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
  if (editor.value?.picker) editor.value.closePicker()
  else if (deleting.value) deleting.value = false
  else if (confirming.value) confirming.value = false
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
        :class="[centered ? 'center-dialog narrow flex-col' : 'full-sheet', { 'sheet-animated': animated }]"
        :style="sheetStyle"
        @touchstart="onTouchStart"
        @touchmove="onTouchMove"
        @touchend="onTouchEnd"
        @touchcancel="onTouchEnd"
        @transitionend="onTransitionEnd"
      >
        <div v-if="!centered" class="mx-auto mt-2 h-1 w-10 shrink-0 rounded-full bg-zinc-300" />
        <div class="flex min-h-11 shrink-0 items-center px-4 py-1">
          <h2 v-if="data" class="text-lg font-semibold">{{ data.card.emoji }} {{ data.card.name }}</h2>
        </div>
        <div class="min-h-0 flex-1 overflow-y-auto overscroll-contain bg-zinc-50 pb-6">
          <p v-if="isPending" class="p-6 text-center text-zinc-400">{{ t('common.loading') }}</p>
          <p v-else-if="isError" class="p-6 text-center text-red-600">{{ t('common.loadFailed') }}</p>
          <template v-else-if="data">
            <div class="flex gap-3 bg-white px-4 pt-2 pb-4">
              <label class="w-20 shrink-0">
                <span class="mb-1 block text-sm text-zinc-500">{{ t('builder.emoji') }}</span>
                <input v-model="emoji" class="h-11 w-full rounded-xl border border-zinc-300 text-center text-xl" />
              </label>
              <label class="min-w-0 flex-1">
                <span class="mb-1 block text-sm text-zinc-500">{{ t('builder.name') }}</span>
                <input v-model="name" class="h-11 w-full rounded-xl border border-zinc-300 px-3 text-base" />
              </label>
            </div>
            <RulesEditor ref="editor" :data="data" />
            <div class="px-4 pt-6">
              <button class="flex h-11 w-full items-center justify-center gap-2 rounded-xl bg-white font-semibold text-red-600 ring-1 ring-zinc-200" @click="deleting = true">
                <Trash2 :size="18" />{{ t('rules.deleteCard') }}
              </button>
            </div>
          </template>
        </div>
        <footer class="shrink-0 border-t border-zinc-200 px-4 pt-3 pb-[calc(0.75rem+env(safe-area-inset-bottom))]">
          <p v-if="save.error.value" class="mb-2 text-center text-sm text-red-600">{{ save.error.value.message }}</p>
          <div class="grid grid-cols-2 gap-3">
            <button class="h-12 rounded-xl bg-zinc-100 font-semibold" @click="requestClose">{{ t('common.cancel') }}</button>
            <button
              class="h-12 rounded-xl bg-indigo-600 font-semibold text-white disabled:opacity-40"
              :disabled="!dirty || blank || save.isPending.value || leaving"
              @click="save.mutate()"
            >
              {{ t('rules.save') }}
            </button>
          </div>
        </footer>
      </section>

      <div v-if="confirming" :class="overlayClass" @click.self="confirming = false">
        <div role="alertdialog" :aria-label="t('sheet.discardLabel')" :class="panelClass">
          <p class="mb-1 text-center font-semibold">{{ t('rules.discardTitle') }}</p>
          <p class="mb-4 text-center text-sm text-zinc-500">{{ t('rules.discardBody') }}</p>
          <button class="mb-2 h-12 w-full rounded-xl bg-red-500 font-semibold text-white" @click="discard">{{ t('sheet.discard') }}</button>
          <button class="h-12 w-full rounded-xl bg-zinc-100 font-semibold" @click="confirming = false">{{ t('sheet.keepEditing') }}</button>
        </div>
      </div>
      <div v-if="deleting && data" :class="overlayClass" @click.self="deleting = false">
        <div role="alertdialog" :aria-label="t('rules.deleteCard')" :class="panelClass">
          <p class="mb-1 text-center font-semibold">{{ t('rules.deleteTitle', { name: data.card.name }) }}</p>
          <p class="mb-4 text-center text-sm text-zinc-500">{{ t('rules.deleteBody') }}</p>
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
