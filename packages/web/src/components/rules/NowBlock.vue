<script setup lang="ts">
import { DURATIONS, durationAfter, durationBefore, evaluateNow } from 'server/rules'
import { computed } from 'vue'
import { t, type MessageKey } from '../../i18n/index.ts'
import { ACCENT } from '../../status.ts'
import { useRules } from './context.ts'
import Phrase from './Phrase.vue'
import RuleBlock from './RuleBlock.vue'
import Tok from './Tok.vue'
import { duration, elapsed } from './words.ts'

type State = 'pending' | 'good' | 'warning' | 'danger'
type Field = 'soon' | 'warn' | 'danger'

const { data, draft, picker, gaps } = useRules()

const H = 3600
const DAY = 86400

/** The states in the order they come after a record; `from` is when each starts. */
const rows = computed(() => {
  const { soon, late } = draft.value.now
  const list: { state: State; from: number; field?: Field; value?: number }[] = []
  if (soon !== undefined) list.push({ state: 'pending', from: 0, field: 'soon', value: soon })
  list.push({ state: 'good', from: soon ?? 0 })
  if (late) list.push({ state: 'warning', from: late.warn, field: 'warn', value: late.warn }, { state: 'danger', from: late.danger, field: 'danger', value: late.danger })
  return list
})

const safe = computed((): { text: MessageKey; from?: number; to?: number } => {
  const { soon, late } = draft.value.now
  if (soon !== undefined && late) return { text: 'rules.now.between', from: soon, to: late.warn }
  if (late) return { text: 'rules.now.within', to: late.warn }
  if (soon !== undefined) return { text: 'rules.now.over', from: soon }
  return { text: 'rules.now.off' }
})

const gap = computed(() => {
  const lastAt = evaluateNow(draft.value, data.root, data.events, data.now).lastAt
  return lastAt === null ? null : data.now - lastAt
})
const current = computed(() => (gap.value === null ? -1 : rows.value.findLastIndex((r) => gap.value! >= r.from)))

const quantile = (q: number) => gaps.value[Math.min(gaps.value.length - 1, Math.floor(gaps.value.length * q))]
const atLeast = (s: number) => DURATIONS.find((d) => d >= s) ?? DURATIONS.at(-1)!
const atMost = (s: number) => DURATIONS.findLast((d) => d <= s) ?? DURATIONS[0]!

function addSoon() {
  const now = draft.value.now
  let soon = atMost(Math.max(H, quantile(0.1) ?? 4 * H))
  if (now.late && soon >= now.late.warn) soon = durationBefore(now.late.warn)
  now.soon = soon
}

function addLate() {
  const now = draft.value.now
  let warn = atLeast(quantile(0.75) ?? DAY)
  if (now.soon !== undefined && warn <= now.soon) warn = durationAfter(now.soon)
  let danger = atLeast(quantile(0.95) ?? 2 * DAY)
  if (danger <= warn) danger = durationAfter(warn)
  now.late = { warn, danger }
}
</script>

<template>
  <RuleBlock :label="t('rules.now.label')">
    <div class="px-4 py-1.5">
      <div v-if="draft.now.soon === undefined" class="row">
        <button class="state add pending" @click="addSoon">{{ t('rules.now.addSoon') }}</button>
      </div>
      <div v-for="(r, i) in rows" :key="r.state" class="row">
        <p class="min-w-0 flex-1 leading-[2.6] text-zinc-500">
          <span class="state" :class="r.state">{{ t(`rules.state.${r.state}`) }}</span>
          <Phrase v-if="r.field" :text="t(r.field === 'soon' ? 'rules.now.soon' : 'rules.now.late')">
            <template #d><Tok @click="picker = { kind: 'duration', field: r.field }">{{ duration(r.value!) }}</Tok></template>
          </Phrase>
          <Phrase v-else :text="t(safe.text)">
            <template #from><span class="text-zinc-700">{{ duration(safe.from!) }}</span></template>
            <template #to><span class="text-zinc-700">{{ duration(safe.to!) }}</span></template>
          </Phrase>
        </p>
        <span v-if="i === current" class="now" :style="{ color: ACCENT[r.state], borderColor: ACCENT[r.state] }">
          {{ t('rules.now.at', { d: elapsed(gap!) }) }}
        </span>
        <span v-else-if="gap !== null && i === current + 1" class="shrink-0 text-xs text-zinc-500">{{ t('rules.now.eta', { d: elapsed(r.from - gap) }) }}</span>
      </div>
      <div v-if="!draft.now.late" class="row">
        <button class="state add warning" @click="addLate">{{ t('rules.now.addLate') }}</button>
      </div>
    </div>
  </RuleBlock>
</template>

<style scoped>
.row {
  display: flex;
  align-items: center;
  gap: 8px;
  min-height: 48px;
}
.state {
  position: relative;
  display: inline-flex;
  align-items: center;
  min-height: 34px;
  margin: 2px 6px 2px 0;
  padding: 0 10px;
  border-radius: 8px;
  font-weight: 700;
  vertical-align: middle;
}
.state.pending {
  background: #dbeafe;
  color: #1d4ed8;
}
.state.good {
  background: #dcfce7;
  color: #15803d;
}
.state.warning {
  background: #fef3c7;
  color: #b45309;
}
.state.danger {
  background: #fee2e2;
  color: #b91c1c;
}
.state.add {
  border: 1.5px dashed;
  background: #fff;
}
.state.add.pending {
  border-color: #93c5fd;
}
.state.add.warning {
  border-color: #fcd34d;
}
/* Stretch the touch target to 44px without changing the look. */
.state.add::after {
  content: '';
  position: absolute;
  inset: -5px -2px;
}
.now {
  flex: none;
  padding: 2px 8px;
  border: 1.5px solid;
  border-radius: 999px;
  font-size: 12px;
  font-weight: 700;
}
</style>
