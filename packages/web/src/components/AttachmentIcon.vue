<script setup lang="ts">
import { File, FileArchive, Film } from 'lucide-vue-next'
import { computed } from 'vue'
import type { Attachment } from '../attachments.ts'

const props = defineProps<{ attachment: Attachment; size: number }>()

const ARCHIVE = /zip|compressed|tar|rar|7z|gzip/
const icon = computed(() => (props.attachment.type.startsWith('video/') ? Film : ARCHIVE.test(props.attachment.type) ? FileArchive : File))
</script>

<template>
  <component :is="icon" :size="size" />
</template>
