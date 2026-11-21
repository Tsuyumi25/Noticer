<script setup lang="ts">
import { LoaderCircle, Paperclip, Play, X } from 'lucide-vue-next'
import { ref } from 'vue'
import { fileSize, isVideo, isVisual, previewUrl, upload, type Attachment } from '../attachments.ts'
import { t } from '../i18n/index.ts'
import { openViewer } from '../viewer.ts'
import AttachmentIcon from './AttachmentIcon.vue'

/** The attachments a checkin carries; files upload as soon as they are picked and join the event when it is saved. */
const model = defineModel<Attachment[]>({ required: true })
const busy = defineModel<boolean>('busy', { default: false })

const input = ref<HTMLInputElement | null>(null)
const pending = ref<{ key: number; name: string }[]>([])
let nextKey = 0
const failed = ref<string[]>([])

async function pick() {
  const files = [...(input.value?.files ?? [])]
  if (input.value) input.value.value = ''
  failed.value = []
  busy.value = true
  const batch = files.map((file) => ({ key: nextKey++, name: file.name }))
  pending.value = [...pending.value, ...batch]
  const results = await Promise.allSettled(files.map(upload))
  // Added in the order picked, whichever upload finished first.
  model.value = [...model.value, ...results.flatMap((r) => (r.status === 'fulfilled' ? [r.value] : []))]
  failed.value = files.filter((_, i) => results[i]!.status === 'rejected').map((f) => f.name)
  const done = new Set(batch.map((p) => p.key))
  pending.value = pending.value.filter((p) => !done.has(p.key))
  busy.value = pending.value.length > 0
}

function remove(id: string) {
  model.value = model.value.filter((a) => a.id !== id)
}
</script>

<template>
  <div class="mt-3">
    <div class="flex flex-wrap gap-2">
      <div v-for="(a, i) in model" :key="a.id" class="tile">
        <button class="size-full" :aria-label="a.name" @click="openViewer(model, i)">
          <img v-if="isVisual(a)" :src="previewUrl(a)" alt="" class="size-full rounded-xl object-cover" />
          <span v-else class="flex size-full flex-col items-center justify-center gap-1 rounded-xl bg-zinc-100 px-1 text-zinc-500">
            <AttachmentIcon :attachment="a" :size="22" />
            <span class="w-full truncate text-center text-[11px]">{{ a.name }}</span>
            <span class="text-[10px] text-zinc-400">{{ fileSize(a.size) }}</span>
          </span>
          <span v-if="isVideo(a) && isVisual(a)" class="absolute inset-0 flex items-center justify-center">
            <Play :size="24" class="rounded-full bg-black/50 p-1 text-white" />
          </span>
        </button>
        <button class="remove" :aria-label="t('attach.remove')" @click="remove(a.id)"><X :size="14" /></button>
      </div>
      <div v-for="p in pending" :key="p.key" class="tile flex items-center justify-center rounded-xl bg-zinc-100 text-zinc-400" :aria-label="p.name">
        <LoaderCircle :size="22" class="animate-spin" />
      </div>
      <button class="tile flex flex-col items-center justify-center gap-1 rounded-xl border-2 border-dashed border-zinc-300 text-sm text-zinc-500" @click="input?.click()">
        <Paperclip :size="20" />{{ t('attach.add') }}
      </button>
    </div>
    <p v-if="failed.length" class="mt-1 text-sm text-red-600">{{ t('attach.failed', { names: failed.join('、') }) }}</p>
    <input ref="input" type="file" multiple class="hidden" @change="pick" />
  </div>
</template>

<style scoped>
.tile {
  position: relative;
  width: 76px;
  height: 76px;
}
.remove {
  position: absolute;
  top: -6px;
  right: -6px;
  display: flex;
  align-items: center;
  justify-content: center;
  width: 24px;
  height: 24px;
  border-radius: 9999px;
  background: rgb(24 24 27 / 0.75);
  color: white;
}
.remove::after {
  content: '';
  position: absolute;
  inset: -10px;
}
</style>
