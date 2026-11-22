<script setup lang="ts">
import { t } from '../i18n/index.ts'
import { pickedDeleted, type VersionPick } from '../versions.ts'

defineProps<{ pick: VersionPick }>()
const emit = defineEmits<{ pick: [index: number] }>()
</script>

<template>
  <div class="tabs" role="tablist">
    <button v-for="(tab, i) in pick.tabs" :key="i" role="tab" :aria-selected="i === pick.current" :class="{ on: i === pick.current }" @click="emit('pick', i)">
      {{ tab.label }}
    </button>
  </div>
  <p v-if="pickedDeleted(pick)" class="flex-1 px-4 py-10 text-center text-zinc-400">{{ t('conflict.deleted') }}</p>
</template>

<style scoped>
.tabs {
  display: flex;
  flex-shrink: 0;
  gap: 4px;
  margin: 0 16px 8px;
  padding: 4px;
  border-radius: 12px;
  background: #f4f4f5;
}
button {
  flex: 1;
  min-width: 0;
  min-height: 44px;
  padding: 0 6px;
  border-radius: 9px;
  color: #52525b;
  font-size: 13.5px;
  font-weight: 600;
}
.on {
  background: white;
  color: #18181b;
  box-shadow: 0 1px 2px rgb(0 0 0 / 0.12);
}
</style>
