<script setup lang="ts">
/** A tappable word inside a rule sentence. */
/** `muted` is a grammar word such as 包含; `level0`… color a connector by how deep its siblings sit. */
defineProps<{ tone?: 'warning' | 'danger' | 'pending' | 'muted' | 'level0' | 'level1' | 'level2' | 'level3' }>()
</script>

<template>
  <button class="tok" :class="tone && `tone-${tone}`"><slot /></button>
</template>

<style scoped>
.tok {
  position: relative;
  display: inline-flex;
  align-items: center;
  min-height: 34px;
  margin: 2px 0;
  padding: 0 8px;
  border-radius: 8px;
  background: #eef2ff;
  color: #4338ca;
  font-weight: 600;
  vertical-align: middle;
}
/* Stretch the touch target to 44px without changing the look. */
.tok::after {
  content: '';
  position: absolute;
  inset: -5px -2px;
}
.tone-warning {
  background: #fff7ed;
  color: #c2410c;
}
.tone-danger {
  background: #fef2f2;
  color: #dc2626;
}
.tone-pending {
  background: #eff6ff;
  color: #2563eb;
}
.tone-muted {
  background: #f4f4f5;
  color: #52525b;
}
.tone-level0 {
  background: #e3ebf5;
  color: #3d5a7a;
}
.tone-level1 {
  background: #e5f0e8;
  color: #3f6a4d;
}
.tone-level2 {
  background: #f4ece0;
  color: #7a5b30;
}
.tone-level3 {
  background: #efe6f0;
  color: #6b4a68;
}
</style>
