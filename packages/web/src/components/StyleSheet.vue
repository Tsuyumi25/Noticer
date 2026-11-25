<script setup lang="ts">
import { onMounted, onUnmounted } from 'vue'
import { t } from '../i18n/index.ts'
import { useSheetDrag } from '../sheetDrag.ts'
import StripOptions from './StripOptions.vue'

const emit = defineEmits<{ close: []; height: [px: number] }>()

const { sheet, sheetStyle, animated, leave, isLeaveEnd, onTouchStart, onTouchMove, onTouchEnd } = useSheetDrag({
  onRequestClose: () => leave(),
  peek: true,
})

const observer = new ResizeObserver(([entry]) => entry && emit('height', entry.borderBoxSize[0]?.blockSize ?? entry.contentRect.height))
function onKeydown(e: KeyboardEvent) {
  if (e.key === 'Escape') leave()
}
onMounted(() => {
  if (sheet.value) observer.observe(sheet.value)
  window.addEventListener('keydown', onKeydown)
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
    class="fixed inset-x-0 bottom-0 z-20 mx-auto max-w-2xl rounded-t-2xl bg-white px-4 pt-2 pb-[calc(16px+env(safe-area-inset-bottom))] shadow-[0_-8px_24px_rgb(0_0_0/0.22)]"
    :class="{ 'sheet-animated': animated }"
    :style="sheetStyle"
    @transitionend="isLeaveEnd($event) && emit('close')"
    @touchstart="onTouchStart"
    @touchmove="onTouchMove"
    @touchend="onTouchEnd"
    @touchcancel="onTouchEnd"
  >
    <div class="mx-auto mb-1 h-1.5 w-10 rounded-full bg-zinc-300" />
    <h2 class="mb-2 flex h-11 items-center font-semibold">{{ t('strip.title') }}</h2>
    <StripOptions />
  </div>
</template>
