<script setup lang="ts">
import { onMounted, onUnmounted, ref } from 'vue'
import { t } from '../i18n/index.ts'
import StripOptions from './StripOptions.vue'

const emit = defineEmits<{ close: []; height: [px: number] }>()

const sheet = ref<HTMLElement | null>(null)
const shown = ref(false)

const observer = new ResizeObserver(([entry]) => entry && emit('height', entry.borderBoxSize[0]?.blockSize ?? entry.contentRect.height))
function onKeydown(e: KeyboardEvent) {
  if (e.key === 'Escape') shown.value = false
}
onMounted(() => {
  if (sheet.value) observer.observe(sheet.value)
  window.addEventListener('keydown', onKeydown)
  requestAnimationFrame(() => (shown.value = true))
})
onUnmounted(() => {
  observer.disconnect()
  window.removeEventListener('keydown', onKeydown)
})
</script>

<template>
  <div
    ref="sheet"
    role="dialog"
    aria-modal="false"
    :aria-label="t('home.style')"
    class="fixed inset-x-0 bottom-0 z-20 mx-auto max-w-2xl rounded-t-2xl bg-white px-4 pt-2 pb-[calc(16px+env(safe-area-inset-bottom))] shadow-[0_-8px_24px_rgb(0_0_0/0.22)] transition-transform duration-300"
    :class="shown ? 'translate-y-0' : 'translate-y-full'"
    @transitionend="!shown && emit('close')"
  >
    <div class="mx-auto mb-1 h-1.5 w-10 rounded-full bg-zinc-300" />
    <div class="mb-2 flex items-center justify-between">
      <h2 class="font-semibold">{{ t('strip.title') }}</h2>
      <button class="h-11 min-w-16 rounded-xl bg-indigo-600 px-4 text-sm font-semibold text-white" @click="shown = false">
        {{ t('common.done') }}
      </button>
    </div>
    <StripOptions />
  </div>
</template>
