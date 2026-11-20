<script setup lang="ts">
import type { Component } from 'vue'

defineProps<{ label: string; icon?: Component; tint?: string }>()
</script>

<template>
  <section class="mx-4 mt-4">
    <h3 class="mb-1.5 px-1 text-sm text-zinc-500">{{ label }}</h3>
    <div class="overflow-hidden rounded-xl border border-zinc-200 bg-white">
      <slot name="top" />
      <div v-if="$slots.head" class="flex items-start gap-3 border-zinc-100 px-4 py-2.5 not-first:border-t">
        <span class="mt-1.5 inline-flex h-8 w-8 shrink-0 items-center justify-center rounded-lg" :class="tint">
          <component :is="icon" :size="18" />
        </span>
        <p class="min-w-0 flex-1 leading-[2.6]"><slot name="head" /></p>
      </div>
      <slot />
      <slot name="footer" />
    </div>
  </section>
</template>
