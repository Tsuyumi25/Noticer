<script setup lang="ts">
import { useMutation, useQueryClient } from '@tanstack/vue-query'
import { Check, Copy, Pencil, Trash2 } from 'lucide-vue-next'
import type { EventRecord } from 'server/events'
import { computed, nextTick, onMounted, onUnmounted, ref } from 'vue'
import { api } from '../api.ts'
import { refetchAfterEventWrite } from '../eventWrites.ts'
import { t } from '../i18n/index.ts'
import { clock } from '../time.ts'
import { isDesktop } from '../viewport.ts'

const props = defineProps<{ event: EventRecord; x: number; y: number }>()
const emit = defineEmits<{ close: []; edit: []; deleted: [id: number] }>()

const popup = isDesktop.value
const note = computed(() => props.event.note?.trim() ? props.event.note : null)

const panel = ref<HTMLElement | null>(null)
const size = ref({ width: 0, height: 0 })
const place = computed(() => ({
  left: `${Math.max(8, Math.min(props.x, window.innerWidth - size.value.width - 8))}px`,
  top: `${Math.max(8, Math.min(props.y, window.innerHeight - size.value.height - 8))}px`,
}))

const copied = ref(false)
async function copy() {
  if (!note.value) return
  if (navigator.clipboard && window.isSecureContext) await navigator.clipboard.writeText(note.value)
  else {
    const area = document.createElement('textarea')
    area.value = note.value
    area.style.position = 'fixed'
    area.style.opacity = '0'
    document.body.append(area)
    area.select()
    document.execCommand('copy')
    area.remove()
  }
  copied.value = true
  setTimeout(() => emit('close'), 600)
}

const confirming = ref(false)
const queryClient = useQueryClient()
const remove = useMutation({
  mutationFn: async () => {
    const res = await api.events[':id'].$delete({ param: { id: String(props.event.id) } })
    if (!res.ok) throw new Error(t('sheet.deleteFailed', { status: res.status }))
  },
  onSuccess: () => {
    refetchAfterEventWrite(queryClient)
    emit('deleted', props.event.id)
    emit('close')
  },
})

function onPointerDown(e: PointerEvent) {
  if (popup && !confirming.value && !panel.value?.contains(e.target as Node)) emit('close')
}
function onKeydown(e: KeyboardEvent) {
  if (e.key !== 'Escape') return
  if (confirming.value) confirming.value = false
  else emit('close')
}
onMounted(async () => {
  document.addEventListener('pointerdown', onPointerDown, true)
  window.addEventListener('keydown', onKeydown)
  await nextTick()
  if (panel.value) size.value = { width: panel.value.offsetWidth, height: panel.value.offsetHeight }
  panel.value?.querySelector('button')?.focus()
})
onUnmounted(() => {
  document.removeEventListener('pointerdown', onPointerDown, true)
  window.removeEventListener('keydown', onKeydown)
})
</script>

<template>
  <Teleport to="body">
    <div v-if="!popup && !confirming" class="fixed inset-0 z-50 bg-black/35" @click="emit('close')" />
    <div
      v-if="!confirming"
      ref="panel"
      role="menu"
      :aria-label="t('event.actions')"
      :class="popup ? 'fixed z-50 min-w-48 rounded-xl bg-white p-1.5 shadow-xl' : 'fixed inset-x-0 bottom-0 z-50 rounded-t-2xl bg-white px-3 pt-3 pb-[calc(1rem+env(safe-area-inset-bottom))]'"
      :style="popup ? place : undefined"
    >
      <p v-if="!popup" class="mb-2 flex gap-3 rounded-xl bg-zinc-100 px-3 py-2.5 text-sm text-zinc-600">
        <span class="shrink-0">{{ clock(event.eventAt * 1000) }}</span>
        <span v-if="note" class="truncate">{{ note.split('\n')[0] }}</span>
      </p>
      <button v-if="note" role="menuitem" class="item" :class="{ big: !popup }" @click="copy">
        <component :is="copied ? Check : Copy" :size="popup ? 16 : 20" />{{ copied ? t('event.copied') : t('event.copy') }}
      </button>
      <button role="menuitem" class="item" :class="{ big: !popup }" @click="emit('edit'), emit('close')">
        <Pencil :size="popup ? 16 : 20" />{{ t('event.edit') }}
      </button>
      <button role="menuitem" class="item danger" :class="{ big: !popup }" @click="confirming = true">
        <Trash2 :size="popup ? 16 : 20" />{{ t('sheet.delete') }}
      </button>
    </div>
    <div
      v-else
      class="fixed inset-0 z-50 flex bg-black/40"
      :class="popup ? 'items-center justify-center p-4' : 'items-end'"
      @click.self="confirming = false"
    >
      <div
        role="alertdialog"
        :aria-label="t('sheet.deleteTitle')"
        :class="popup ? 'w-full max-w-sm rounded-2xl bg-white p-4' : 'w-full rounded-t-2xl bg-white p-4 pb-[calc(1rem+env(safe-area-inset-bottom))]'"
      >
        <p class="mb-4 text-center font-semibold">{{ t('sheet.deleteTitle') }}</p>
        <p v-if="remove.error.value" class="mb-2 text-center text-sm text-red-600">{{ remove.error.value.message }}</p>
        <button class="mb-2 h-12 w-full rounded-xl bg-red-500 font-semibold text-white disabled:opacity-40" :disabled="remove.isPending.value" @click="remove.mutate()">
          {{ t('sheet.delete') }}
        </button>
        <button class="h-12 w-full rounded-xl bg-zinc-100 font-semibold" @click="confirming = false">{{ t('common.cancel') }}</button>
      </div>
    </div>
  </Teleport>
</template>

<style scoped>
.item {
  display: flex;
  width: 100%;
  height: 44px;
  align-items: center;
  gap: 10px;
  padding: 0 12px;
  border-radius: 8px;
  color: #27272a;
  font-size: 14px;
  text-align: left;
}
.item:hover,
.item:focus-visible {
  background: #f4f4f5;
  outline: none;
}
.item.big {
  height: 52px;
  gap: 12px;
  border-radius: 12px;
  font-size: 16px;
}
.item :deep(svg) {
  color: #52525b;
}
.item.danger,
.item.danger :deep(svg) {
  color: #dc2626;
}
</style>
