<script setup lang="ts">
defineProps<{ title: string; hint?: string; on: boolean }>()
</script>

<template>
  <button class="flex min-h-14 w-full items-center gap-3 border-zinc-100 px-4 py-2 text-left not-first:border-t" role="switch" :aria-checked="on">
    <span class="flex flex-1 flex-col">
      <span>{{ title }}</span>
      <span v-if="hint" class="text-xs text-zinc-500">{{ hint }}</span>
    </span>
    <span class="switch" :class="{ on }" />
  </button>
</template>

<style scoped>
.switch {
  position: relative;
  width: 44px;
  height: 26px;
  flex: none;
  border-radius: 13px;
  background: #e4e4e7;
  transition: background 0.2s;
}
.switch::after {
  content: '';
  position: absolute;
  top: 3px;
  left: 3px;
  width: 20px;
  height: 20px;
  border-radius: 50%;
  background: white;
  box-shadow: 0 1px 2px rgb(0 0 0 / 0.2);
  transition: left 0.2s;
}
.switch.on {
  background: #4f46e5;
}
.switch.on::after {
  left: 21px;
}
</style>
