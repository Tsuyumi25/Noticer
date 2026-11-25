<script setup lang="ts">
import { useQuery } from '@tanstack/vue-query'
import { CircleQuestionMark } from 'lucide-vue-next'
import type { CardConfig } from 'server/config'
import type { EventRecord } from 'server/events'
import { PURE_CARD } from 'server/pure'
import { parseValueKey } from 'server/values'
import { computed, ref } from 'vue'
import { isVideo, isVisual, previewUrl } from '../attachments.ts'
import { t } from '../i18n/index.ts'
import { vLongPress } from '../longPress.ts'
import { configQuery } from '../queries.ts'
import { cardColor, tagColors } from '../tagColors.ts'
import { clock } from '../time.ts'
import { openViewer } from '../viewer.ts'
import AttachmentIcon from './AttachmentIcon.vue'

const props = defineProps<{ event: EventRecord; compact?: boolean; selected?: boolean; flash?: boolean; viewerArea?: HTMLElement | null }>()
const emit = defineEmits<{ open: []; menu: [x: number, y: number] }>()

const { data: config } = useQuery(configQuery)
const card = computed(() => config.value?.cards.find((c) => c.id === props.event.cardId) as CardConfig | undefined)
const quick = computed(() => props.event.cardId === PURE_CARD)
const colors = computed(() => (config.value ? tagColors(config.value) : new Map<string, string>()))
const tags = computed(() => props.event.tags.filter((tag) => tag !== card.value?.root).map((label) => ({ label, color: colors.value.get(label) })))

type Chip = { name: string; amount: string; unit: string }
/** Values and the config's choices; facts kept from the old app that nothing models stay hidden. */
const chips = computed(() => {
  const specs = card.value ? (config.value?.tagGroups[card.value.root]?.values ?? {}) : {}
  return Object.entries(props.event.facts).flatMap(([key, value]): Chip[] => {
    const parsed = parseValueKey(key)
    if (parsed && typeof value === 'number') {
      const decimals = specs[parsed.tag]?.decimals
      return [{ name: parsed.tag, amount: decimals === undefined ? String(value) : value.toFixed(decimals), unit: parsed.unit }]
    }
    const input = config.value?.factInputs[key]
    if (!input) return []
    const label = input.options.find((o) => o.value === value)?.label
    return [{ name: input.name, amount: label ? `${value} ${label}` : String(value), unit: '' }]
  })
})

const color = computed(() => tags.value.find((tag) => tag.color)?.color ?? (card.value && config.value ? cardColor(config.value, card.value) : '#a1a1aa'))
const name = computed(() => (quick.value ? t('nav.quickNote') : (card.value?.name ?? props.event.cardId)))
const emoji = computed(() => (quick.value ? '📝' : (card.value?.emoji ?? '•')))
const note = computed(() => (props.compact ? (props.event.note?.split('\n')[0] ?? '') : (props.event.note ?? '')))

const root = ref<HTMLElement | null>(null)
function menuFromHold() {
  const box = root.value!.getBoundingClientRect()
  emit('menu', box.left + 24, box.bottom - 8)
}
</script>

<template>
  <div
    ref="root"
    v-long-press="menuFromHold"
    class="card"
    :class="{ compact, selected, flash }"
    :style="{ '--c': color }"
    :data-event="event.id"
    role="button"
    tabindex="0"
    @click="emit('open')"
    @keydown.enter="emit('open')"
    @contextmenu.prevent="emit('menu', $event.clientX, $event.clientY)"
  >
    <span class="emo">
      {{ emoji }}
      <CircleQuestionMark v-if="event.versions.length" class="versions" :size="15" :stroke-width="2.75" />
    </span>
    <div class="main">
      <div class="head">
        <span class="name">{{ name }}</span>
        <span class="time">
          {{ clock(event.eventAt * 1000) }}<span v-if="event.timeOffset < 0" class="late">{{ t('journal.backdated') }}</span>
        </span>
      </div>
      <div v-if="tags.length || chips.length" class="chips">
        <span v-for="tag in tags" :key="tag.label" class="tag" :style="tag.color ? { background: `${tag.color}22`, color: tag.color } : undefined">{{ tag.label }}</span>
        <span v-for="chip in chips" :key="chip.name" class="vchip">
          <span class="vn">{{ chip.name }}</span>
          <span class="va">{{ chip.amount }}<small v-if="chip.unit">{{ chip.unit }}</small></span>
        </span>
      </div>
      <p v-if="note" class="note">{{ note }}</p>
      <div v-if="!compact && event.attachments.length" class="files">
        <button
          v-for="(a, i) in event.attachments"
          :key="a.id"
          class="attachment"
          :class="{ file: !isVisual(a) }"
          :aria-label="a.name"
          @click.stop="openViewer(event.attachments, i, { within: viewerArea ?? null })"
        >
          <img v-if="isVisual(a)" :src="previewUrl(a)" alt="" loading="lazy" class="size-full rounded-lg object-cover" />
          <template v-else><AttachmentIcon :attachment="a" :size="16" /><span class="truncate">{{ a.name }}</span></template>
          <span v-if="isVideo(a) && isVisual(a)" class="play">▶</span>
        </button>
      </div>
    </div>
  </div>
</template>

<style scoped>
.card {
  position: relative;
  display: flex;
  gap: 10px;
  min-height: 44px;
  margin: 6px 0;
  padding: 9px 12px;
  border-radius: 10px;
  background: white;
  box-shadow:
    0 0 0 1px rgb(0 0 0 / 0.06),
    0 1px 2px rgb(0 0 0 / 0.05);
  cursor: pointer;
  text-align: left;
}
@media (hover: hover) {
  .card:hover {
    box-shadow:
      0 0 0 1px rgb(99 102 241 / 0.35),
      0 2px 6px rgb(0 0 0 / 0.08);
  }
}
.card.selected {
  background: #eef2ff;
  box-shadow: 0 0 0 2px #818cf8;
}
.card.flash {
  animation: flash 1.6s ease-out;
}
@keyframes flash {
  0%,
  40% {
    background: #fef08a;
  }
}
.emo {
  position: relative;
  display: inline-flex;
  width: 34px;
  height: 34px;
  flex: none;
  align-items: center;
  justify-content: center;
  border-radius: 10px;
  background: color-mix(in srgb, var(--c) 16%, white);
  font-size: 18px;
}
.versions {
  position: absolute;
  top: -5px;
  right: -5px;
  border-radius: 50%;
  background: white;
  color: #f97316;
}
.main {
  min-width: 0;
  flex: 1;
}
.head {
  display: flex;
  min-height: 20px;
  align-items: baseline;
  gap: 8px;
}
.name {
  color: #27272a;
  font-size: 14px;
  font-weight: 600;
}
.time {
  margin-left: auto;
  color: #71717a;
  font: 500 12px ui-monospace, 'SF Mono', Menlo, monospace;
  white-space: nowrap;
}
.late {
  margin-left: 4px;
  padding: 0 4px;
  border-radius: 4px;
  background: #fef3c7;
  color: #92400e;
  font: 700 10px system-ui, sans-serif;
  vertical-align: 1px;
}
.chips {
  display: flex;
  flex-wrap: wrap;
  gap: 4px;
  margin-top: 4px;
}
.compact .chips {
  flex-wrap: nowrap;
  overflow: hidden;
}
.tag {
  display: inline-flex;
  flex: none;
  align-items: center;
  padding: 1px 8px;
  border-radius: 999px;
  background: #f4f4f5;
  color: #3f3f46;
  font-size: 12.5px;
}
.vchip {
  display: inline-flex;
  flex: none;
  overflow: hidden;
  border-radius: 8px;
  background: #f4f4f5;
  font-size: 12px;
}
.vn {
  padding: 1px 6px;
  color: #52525b;
}
.va {
  padding: 1px 6px;
  background: #eef2ff;
  color: #3730a3;
  font: 700 12px ui-monospace, 'SF Mono', Menlo, monospace;
}
.va small {
  margin-left: 1px;
  font-weight: 500;
}
.note {
  margin-top: 4px;
  color: #3f3f46;
  font-size: 13.5px;
  line-height: 1.45;
  white-space: pre-wrap;
  overflow-wrap: anywhere;
}
.compact .note {
  overflow: hidden;
  color: #71717a;
  font-size: 12.5px;
  text-overflow: ellipsis;
  white-space: nowrap;
}
.files {
  display: flex;
  flex-wrap: wrap;
  gap: 6px;
  margin-top: 6px;
}
.attachment {
  position: relative;
  width: 64px;
  height: 64px;
}
.attachment.file {
  display: inline-flex;
  align-items: center;
  gap: 4px;
  width: auto;
  max-width: 100%;
  height: 44px;
  padding: 0 10px;
  border-radius: 10px;
  background: #f4f4f5;
  color: #52525b;
  font-size: 13px;
}
.attachment .play {
  position: absolute;
  inset: 0;
  display: flex;
  align-items: center;
  justify-content: center;
  color: white;
  text-shadow: 0 0 6px rgb(0 0 0 / 0.6);
}
</style>
