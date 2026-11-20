<script setup lang="ts">
import { dayStarts, evaluateNow } from 'server/rules'
import { valuesIn } from 'server/values'
import { Calendar, Clock } from 'lucide-vue-next'
import { computed, type Component } from 'vue'
import { locale, t, type MessageKey } from '../../i18n/index.ts'
import WaterCard from '../WaterCard.vue'
import { PREVIEW_DAYS, useRules, type Tab } from './context.ts'
import { nowReason } from './words.ts'

const { data, draft, tab, picker, model, days, counted } = useRules()

const card = computed(() => model(draft.value))
const lastAt = computed(() => evaluateNow(draft.value, data.root, data.events, data.now).lastAt)

// 2023-01-01 was a Sunday.
const weekdays = computed(() =>
  Array.from({ length: 7 }, (_, i) => new Intl.DateTimeFormat(locale.value, { weekday: 'narrow' }).format(new Date(2023, 0, 1 + i))),
)

const decimals = computed(() => {
  const measure = draft.value.back?.measure
  return measure && 'unit' in measure ? (data.units.find((u) => u.unit === measure.unit)?.decimals ?? 0) : 0
})

/** Without a looking-back rule the report only marks days with records, showing the day's last number if the card keeps one. */
function loggedDay(start: number, end: number) {
  const list = counted(draft.value.find).filter((e) => e.eventAt >= start && e.eventAt < end)
  if (!list.length) return { state: 'none', value: '' }
  const unit = data.units[0]
  const last = unit ? list.map((e) => valuesIn(e.facts, unit.unit)[0]).findLast((v) => v !== undefined) : undefined
  return { state: 'logged', value: last !== undefined ? last.toFixed(unit!.decimals) : unit ? '' : String(list.length) }
}

const calendar = computed(() => {
  const starts = dayStarts(data.now, PREVIEW_DAYS)
  const strip = days(draft.value)
  return {
    lead: new Date(starts[0]! * 1000).getDay(),
    cells: starts.slice(0, -1).map((start, i) => {
      const day = new Date(start * 1000).getDate()
      if (!strip) return { day, ...loggedDay(start, starts[i + 1]!) }
      const value = strip.values[i] ?? null
      return { day, state: strip.states[i]!, value: value === null || value === 0 ? '' : value.toFixed(decimals.value) }
    }),
  }
})

const legend = computed(() => (draft.value.back ? (['good', 'warning', 'danger', 'none'] as const) : (['logged', 'none'] as const)))

const TABS: { key: Tab; icon: Component; label: MessageKey; hint: MessageKey }[] = [
  { key: 'now', icon: Clock, label: 'card.since', hint: 'rules.tab.nowHint' },
  { key: 'back', icon: Calendar, label: 'rules.tab.back', hint: 'rules.tab.backHint' },
]
</script>

<template>
  <div class="bg-white px-4 pt-1 pb-3">
    <div class="grid grid-cols-2 gap-2">
      <button v-for="x in TABS" :key="x.key" class="choice" :class="{ on: tab === x.key }" @click="tab = x.key">
        <span class="inline-flex items-center gap-1.5"><component :is="x.icon" :size="16" />{{ t(x.label) }}</span>
        <span class="text-[11px] font-normal opacity-70">{{ t(x.hint) }}</span>
      </button>
    </div>

    <template v-if="tab === 'now'">
      <div class="mx-auto mt-3 w-[calc(50%-4px)]"><WaterCard :card="card" /></div>
      <p class="mt-2 text-center text-[13px] leading-snug text-zinc-600">{{ nowReason(draft.now, lastAt, data.now, card.status) }}</p>
    </template>

    <template v-else>
      <div class="mt-3 grid grid-cols-7 gap-1 pb-1 text-center text-xs text-zinc-400">
        <span v-for="(w, i) in weekdays" :key="i">{{ w }}</span>
      </div>
      <div class="grid grid-cols-7 gap-1">
        <span v-for="n in calendar.lead" :key="`lead-${n}`" />
        <button
          v-for="(c, i) in calendar.cells"
          :key="i"
          class="cell"
          :class="[`s-${c.state}`, { today: i === calendar.cells.length - 1 }]"
          @click="picker = { kind: 'day', index: i }"
        >
          <span class="text-[13px] leading-tight font-medium text-zinc-900 tabular-nums">{{ c.day }}</span>
          <span class="value">{{ c.value }}</span>
        </button>
      </div>
      <p class="mt-2 flex flex-wrap items-center justify-center gap-x-3 gap-y-1 text-[11px] text-zinc-500">
        <span v-for="s in legend" :key="s" class="inline-flex items-center gap-1">
          <i class="swatch" :class="`s-${s}`" />{{ t(`rules.legend.${s}`) }}
        </span>
        <span>· {{ t('rules.tapDay') }}</span>
      </p>
    </template>
  </div>
</template>

<style scoped>
.choice {
  display: flex;
  min-height: 52px;
  flex-direction: column;
  align-items: center;
  justify-content: center;
  border: 1px solid #e5e7eb;
  border-radius: 12px;
  color: #6b7280;
}
.choice.on {
  border-color: #818cf8;
  background: #eef2ff;
  color: #3730a3;
  font-weight: 600;
}
.cell {
  display: flex;
  min-height: 40px;
  flex-direction: column;
  align-items: center;
  justify-content: center;
  border-radius: 10px;
  color: #3f3f46;
}
.value {
  min-height: 12px;
  font-size: 11px;
  font-weight: 600;
  line-height: 12px;
  font-variant-numeric: tabular-nums;
}
.swatch {
  width: 12px;
  height: 12px;
  border-radius: 4px;
}
.s-none {
  border: 1.5px dashed #e5e7eb;
}
.s-good,
.s-good-carry {
  background: #d1fae5;
  color: #065f46;
}
.s-good-carry {
  background: none;
  border: 1.5px dashed #6ee7b7;
}
.s-logged {
  background: #e0e7ff;
  color: #3730a3;
}
.s-warning,
.s-pending {
  background: #fde68a;
  color: #92400e;
}
.s-danger {
  background: #fecaca;
  color: #991b1b;
}
.today {
  box-shadow: inset 0 0 0 2px #4f46e5;
}
</style>
