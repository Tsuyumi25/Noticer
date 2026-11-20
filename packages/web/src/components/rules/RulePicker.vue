<script setup lang="ts">
import type { BackRule, Measure, Rules, Want } from 'server/config'
import { dayStarts, DURATIONS, durationAfter, durationBefore } from 'server/rules'
import { computed, ref, watch } from 'vue'
import { locale, t, tn, type MessageKey } from '../../i18n/index.ts'
import { ACCENT } from '../../status.ts'
import ValuePad from '../ValuePad.vue'
import { PREVIEW_DAYS, useRules, type Trial } from './context.ts'
import FindPicker from './FindPicker.vue'
import { amount, clock, elapsed, measureLabel, statusWord } from './words.ts'

const { data, draft, tab, picker, findOf, counted, gaps, trial, days, closePicker: close } = useRules()
const p = computed(() => picker.value!)
const FIND_KINDS = new Set(['add', 'tags', 'hour', 'weekday'])

const H = 3600
const DAY = 86400

const find = computed(() => ('tab' in p.value ? findOf(draft.value, p.value.tab) : draft.value.find))
type Option = { key: string; label: string; desc?: string; on?: boolean; trial?: Trial; pick: () => void }

function setMeasure(back: BackRule, measure: Measure) {
  back.measure = measure
  if (measure.kind === 'last') back.want = { kind: 'off' }
  else if (back.want.kind === 'off') back.want = measure.kind === 'since' ? { kind: 'atMost', n: 7 } : { kind: 'atLeast', n: measure.kind === 'total' ? 20 : 1 }
}
function setWant(back: BackRule, kind: Want['kind']) {
  const w = back.want
  const base = 'n' in w ? w.n : 'lo' in w ? w.lo : back.measure.kind === 'total' ? 20 : back.measure.kind === 'since' ? 7 : 2
  back.want = kind === 'between' ? { kind, lo: base, hi: base + 1 } : kind === 'off' ? { kind } : { kind, n: base }
}
function setSpan(rules: Rules, span: BackRule['span'] | 'none') {
  if (span === 'none') rules.back = null
  else if (rules.back) rules.back.span = span
  else rules.back = { span, measure: { kind: 'times' }, want: { kind: 'atLeast', n: 1 } }
}

const options = computed<{ title: string; sub?: string; list: Option[] } | null>(() => {
  const cur = p.value
  const apply = (mutate: (r: Rules) => void) => () => {
    mutate(draft.value)
    close()
  }
  const opt = (key: string, label: string, mutate: ((r: Rules) => void) | null, extra: Partial<Option> = {}): Option => ({
    key,
    label,
    trial: mutate ? trial(mutate) : undefined,
    pick: mutate ? apply(mutate) : () => {},
    ...extra,
  })
  switch (cur.kind) {
    case 'span':
      return {
        title: t('rules.pick.span'),
        list: (['day', 'week', 'none'] as const).map((span) =>
          opt(span, t(`rules.span.${span}`), (r) => setSpan(r, span), {
            desc: t(`rules.span.${span}Desc`),
            on: (draft.value.back?.span ?? 'none') === span,
          }),
        ),
      }
    case 'measure': {
      const measures: Measure[] = [{ kind: 'times' }, { kind: 'since' }, ...data.units.flatMap((u): Measure[] => [{ kind: 'total', unit: u.unit }, { kind: 'last', unit: u.unit }])]
      return {
        title: t('rules.pick.measure'),
        list: measures.map((m) => {
          const fact = 'unit' in m ? m.unit : ''
          return opt(`${m.kind}-${fact}`, measureLabel(m), (r) => r.back && setMeasure(r.back, m), {
            desc: t(`rules.measure.${m.kind}Desc`, { fact }),
            on: JSON.stringify(draft.value.back?.measure) === JSON.stringify(m),
          })
        }),
      }
    }
    case 'want':
      return {
        title: t('rules.pick.want'),
        sub: t('rules.pick.wantSub'),
        list: (['atLeast', 'atMost', 'between', 'off'] as const).map((kind) =>
          opt(kind, t(`rules.want.${kind}`), (r) => r.back && setWant(r.back, kind), {
            desc: t(`rules.want.${kind}Desc`),
            on: draft.value.back?.want.kind === kind,
          }),
        ),
      }
    default:
      return null
  }
})

type Field = 'soon' | 'warn' | 'danger'
type DurationUnit = 'minute' | 'hour' | 'day' | 'week'
const UNIT_SECONDS: Record<DurationUnit, number> = { minute: 60, hour: H, day: DAY, week: 7 * DAY }
const UNITS = Object.keys(UNIT_SECONDS) as DurationUnit[]
/** The largest unit that shows these seconds with at most one decimal. */
const unitFor = (s: number): DurationUnit => [...UNITS].reverse().find((u) => s >= UNIT_SECONDS[u] && Number.isInteger((s / UNIT_SECONDS[u]) * 10)) ?? 'minute'

const durationField = computed(() => (p.value.kind === 'duration' ? p.value.field : null))
const durationNow = computed(() => {
  const f = durationField.value
  const { soon, late } = draft.value.now
  return f === null ? undefined : f === 'soon' ? soon : late?.[f]
})
const durationUnit = ref<DurationUnit>('hour')
/** Seconds shown when the pad (re)opens; follows what was typed across a unit switch. */
const durationSeconds = ref<number | null>(null)
watch(
  durationField,
  (f) => {
    if (f === null) return
    const s = durationNow.value ?? null
    durationSeconds.value = s
    durationUnit.value = s === null ? 'hour' : unitFor(s)
  },
  { immediate: true },
)
const durationPad = ref<{ current: number | null } | null>(null)
function switchUnit(unit: DurationUnit) {
  const typed = durationPad.value?.current
  if (typed != null) durationSeconds.value = Math.round(typed * UNIT_SECONDS[durationUnit.value])
  durationUnit.value = unit
}

/** Common gaps between records, as tidy durations the field can take, in the unit on show. */
const durationCandidates = computed(() => {
  const f = durationField.value
  if (f === null) return []
  const { soon, late } = draft.value.now
  const lo = f === 'warn' ? soon : f === 'danger' ? late?.warn : undefined
  const hi = f === 'soon' ? late?.warn : f === 'warn' ? late?.danger : undefined
  const tidy = (s: number) => DURATIONS.reduce((a, b) => (Math.abs(b - s) < Math.abs(a - s) ? b : a))
  const q = (x: number) => gaps.value[Math.min(gaps.value.length - 1, Math.floor(gaps.value.length * x))]!
  const picks = gaps.value.length ? [0.1, 0.5, 0.75, 0.95].map((x) => tidy(q(x))) : [4 * H, DAY, 3 * DAY, 7 * DAY]
  const per = UNIT_SECONDS[durationUnit.value]
  return [...new Set(picks)]
    .filter((d) => (lo === undefined || d > lo) && (hi === undefined || d < hi) && Number.isInteger((d / per) * 10))
    .sort((a, b) => a - b)
    .map((d) => d / per)
})

/** The edited bound wins; the others move out of its way. */
function setDuration(field: Field, seconds: number) {
  const now = draft.value.now
  if (field === 'soon') {
    now.soon = seconds
    if (now.late && now.late.warn <= seconds) now.late.warn = durationAfter(seconds)
  } else if (now.late) {
    now.late[field] = seconds
    if (field === 'warn' && now.soon !== undefined && now.soon >= seconds) now.soon = durationBefore(seconds)
    if (field === 'danger' && now.late.warn >= seconds) now.late.warn = durationBefore(seconds)
    if (now.soon !== undefined && now.soon >= now.late.warn) now.soon = durationBefore(now.late.warn)
  }
  if (now.late && now.late.danger <= now.late.warn) now.late.danger = durationAfter(now.late.warn)
  close()
}
function doneDuration(value: number | null) {
  const f = durationField.value
  if (f === null) return
  if (value === null || value <= 0) return close()
  setDuration(f, Math.round(value * UNIT_SECONDS[durationUnit.value]))
}
function removeSide(field: Field) {
  if (field === 'soon') delete draft.value.now.soon
  else delete draft.value.now.late
  close()
}

type AmountField = 'n' | 'red' | 'lo' | 'hi'
const amountField = computed(() => (p.value.kind === 'amount' && draft.value.back ? p.value.field : null))
const amountPad = computed(() => {
  const field = amountField.value
  const back = draft.value.back
  if (field === null || !back) return null
  const m = back.measure
  const want: Partial<Record<AmountField, number>> = back.want.kind === 'off' ? {} : back.want
  const decimals = 'unit' in m ? (data.units.find((u) => u.unit === m.unit)?.decimals ?? 0) : 0
  const unit = 'unit' in m ? m.unit : m.kind === 'since' ? t('time.unit.day') : t('rules.timesUnit')
  return { field, unit, decimals, value: want[field] ?? null, min: field === 'red' ? (want.n ?? 0) : -1 }
})
/** Tidy amounts near what the last four weeks actually reached. */
const amountCandidates = computed(() => {
  const pad = amountPad.value
  if (!pad) return []
  const seen = (days(draft.value)?.values ?? []).filter((v): v is number => v !== null && v > 0).sort((a, b) => a - b)
  if (!seen.length) return []
  const tidy = (v: number) => {
    const step = pad.decimals > 0 ? 10 ** -pad.decimals : v >= 1000 ? 100 : v >= 100 ? 50 : v >= 20 ? 5 : 1
    return Number((Math.round(v / step) * step).toFixed(pad.decimals))
  }
  const picks = [0.25, 0.5, 0.75, 0.9].map((q) => tidy(seen[Math.min(seen.length - 1, Math.floor(seen.length * q))]!))
  return [...new Set(picks)].filter((v) => v > pad.min).sort((a, b) => a - b)
})
function doneAmount(value: number | null) {
  const pad = amountPad.value
  if (pad && value !== null && value > pad.min) setAmount(draft.value, pad.field, value)
  close()
}
function removeRed() {
  const w = draft.value.back?.want
  if (w?.kind === 'atMost') delete w.red
  close()
}
function setAmount(r: Rules, field: 'n' | 'red' | 'lo' | 'hi', v: number) {
  const w = r.back?.want
  if (!w || w.kind === 'off') return
  if (w.kind === 'between' && (field === 'lo' || field === 'hi')) {
    w[field] = v
    if (w.lo > w.hi) [w.lo, w.hi] = [w.hi, w.lo]
  } else if (w.kind !== 'between' && field === 'n') {
    w.n = v
    if (w.kind === 'atMost' && w.red !== undefined && w.red <= v) w.red = v + 1
  } else if (w.kind === 'atMost' && field === 'red') w.red = v
}

const records = computed(() => {
  if (p.value.kind !== 'records') return null
  const f = find.value
  const hit = new Set(counted(f))
  const rows = [...data.events].reverse().map((e) => ({ e, ok: hit.has(e) }))
  return { rows, n: hit.size, miss: rows.length - hit.size }
})

const day = computed(() => {
  if (p.value.kind !== 'day') return null
  const index = p.value.index
  const starts = dayStarts(data.now, PREVIEW_DAYS)
  const start = starts[index]!
  const strip = days(draft.value)
  const backFind = findOf(draft.value, 'back')
  const hit = new Set(counted(backFind))
  return {
    date: new Intl.DateTimeFormat(locale.value, { month: 'numeric', day: 'numeric', weekday: 'short' }).format(start * 1000),
    value: strip?.values[index] ?? null,
    state: strip?.states[index] ?? 'none',
    events: data.events.filter((e) => e.eventAt >= start && e.eventAt < starts[index + 1]!).map((e) => ({ e, ok: hit.has(e) })),
  }
})

const fieldTitle = (field: string) => t(`rules.pick.${field}` as MessageKey)
const tally = (tr: Trial) => {
  const total = tr.tally.reduce((sum, [, n]) => sum + n, 0) || 1
  return tr.tally.filter(([, n]) => n).map(([s, n]) => ({ s, width: `${(n / total) * 100}%` }))
}
const FILL: Record<string, string> = { good: '#34d399', warning: '#fbbf24', danger: '#f87171' }
</script>

<template>
  <Teleport to="body">
    <div class="fixed inset-0 z-[60] flex items-end bg-black/40" @click.self="close">
      <section class="flex max-h-[82dvh] w-full flex-col rounded-t-2xl bg-white" :class="{ 'pb-[env(safe-area-inset-bottom)]': p.kind !== 'duration' && !amountPad }">
        <div class="mx-auto mt-2 h-1 w-10 shrink-0 rounded-full bg-zinc-300" />
        <ValuePad
          v-if="amountPad"
          class="border-t-0"
          :label="fieldTitle(amountPad.field)"
          :unit="amountPad.unit"
          :decimals="amountPad.decimals"
          :value="amountPad.value"
          :candidates="amountCandidates"
          :removable="amountPad.field === 'red'"
          @done="doneAmount"
          @remove="removeRed"
          @cancel="close"
        />
        <ValuePad
          v-else-if="p.kind === 'duration'"
          ref="durationPad"
          :key="durationUnit"
          class="border-t-0"
          :label="fieldTitle(p.field)"
          :unit="t(`time.unit.${durationUnit}`)"
          :decimals="1"
          :value="durationSeconds === null ? null : durationSeconds / UNIT_SECONDS[durationUnit]"
          :candidates="durationCandidates"
          trim
          removable
          @done="doneDuration"
          @remove="removeSide((p as { field: Field }).field)"
          @cancel="close"
        >
          <template #aside>
            <span class="unitseg">
              <button v-for="u in UNITS" :key="u" :class="{ on: durationUnit === u }" @click="switchUnit(u)">{{ t(`time.unit.${u}`) }}</button>
            </span>
          </template>
        </ValuePad>
        <div v-else class="min-h-0 flex-1 overflow-y-auto overscroll-contain pb-4">
          <FindPicker v-if="FIND_KINDS.has(p.kind)" />
          <template v-else-if="options">
            <h2 class="px-4 pt-2 text-base font-semibold">{{ options.title }}</h2>
            <p v-if="options.sub" class="px-4 pt-0.5 text-sm text-zinc-500">{{ options.sub }}</p>
            <div class="mt-3 flex flex-col gap-2 px-4">
              <button v-for="o in options.list" :key="o.key" class="opt" :class="{ on: o.on }" @click="o.pick">
                <span class="flex min-w-0 flex-1 flex-col text-left">
                  <span class="font-semibold">{{ o.label }}</span>
                  <span v-if="o.desc" class="desc text-xs">{{ o.desc }}</span>
                </span>
                <span v-if="o.trial" class="flex shrink-0 flex-col items-end gap-1 text-xs text-zinc-600">
                  <span>{{ tn('rules.records', o.trial.n) }}</span>
                  <span v-if="tab === 'now'" class="inline-flex items-center gap-1">
                    <i class="dot" :style="{ background: ACCENT[o.trial.model.status] }" />
                    {{ o.trial.model.nowHours === null ? statusWord(o.trial.model.status) : elapsed(o.trial.model.nowHours * H) }}
                  </span>
                  <span v-else class="bar"><b v-for="x in tally(o.trial)" :key="x.s" :style="{ width: x.width, background: FILL[x.s] }" /></span>
                </span>
              </button>
            </div>
          </template>

          <template v-else-if="records">
            <h2 class="px-4 pt-2 text-base font-semibold">{{ t('rules.pick.records', { n: records.n, miss: records.miss }) }}</h2>
            <ol class="mt-2 divide-y divide-zinc-100">
              <li v-for="x in records.rows" :key="x.e.id" class="flex gap-3 px-4 py-2.5" :class="{ 'text-zinc-400': !x.ok }">
                <span class="w-4 shrink-0 text-center text-lg leading-5 font-bold" :class="x.ok ? 'text-emerald-600' : 'text-zinc-400'">{{ x.ok ? '+' : '−' }}</span>
                <time class="w-24 shrink-0 text-sm tabular-nums" :class="{ 'text-zinc-500': x.ok }">{{ clock(x.e.eventAt) }}</time>
                <span class="flex min-w-0 flex-1 flex-wrap gap-1"><span v-for="tag in x.e.tags.filter((y) => y !== data.root)" :key="tag" class="tagpill">{{ tag }}</span></span>
              </li>
            </ol>
          </template>

          <template v-else-if="day">
            <h2 class="px-4 pt-2 text-base font-semibold">
              {{ day.date }} ·
              {{
                day.value === null
                  ? t('rules.pick.dayNoData')
                  : `${draft.back ? measureLabel(draft.back.measure) : ''} ${draft.back ? amount(draft.back.measure, data.units, day.value) : day.value}`
              }}
              → {{ statusWord(day.state) }}
            </h2>
            <ol v-if="day.events.length" class="mt-2 divide-y divide-zinc-100">
              <li v-for="x in day.events" :key="x.e.id" class="flex gap-3 px-4 py-2.5" :class="{ 'text-zinc-400': !x.ok }">
                <span class="w-4 shrink-0 text-center text-lg leading-5 font-bold" :class="x.ok ? 'text-emerald-600' : 'text-zinc-400'">{{ x.ok ? '+' : '−' }}</span>
                <time class="w-12 shrink-0 text-sm tabular-nums">{{ clock(x.e.eventAt).split(' ').at(-1) }}</time>
                <span class="flex min-w-0 flex-1 flex-wrap gap-1"><span v-for="tag in x.e.tags.filter((y) => y !== data.root)" :key="tag" class="tagpill">{{ tag }}</span></span>
              </li>
            </ol>
            <p v-else class="px-4 pt-4 text-center text-zinc-400">{{ t('review.dayEmpty') }}</p>
          </template>
        </div>
      </section>
    </div>
  </Teleport>
</template>

<style scoped>
.unitseg {
  display: inline-flex;
  padding: 2px;
  border-radius: 10px;
  background: #f4f4f5;
}
.unitseg button {
  position: relative;
  min-width: 44px;
  height: 32px;
  border-radius: 8px;
  color: #71717a;
  font-size: 14px;
}
.unitseg button::after {
  content: '';
  position: absolute;
  inset: -6px 0;
}
.unitseg button.on {
  background: white;
  color: #18181b;
  font-weight: 600;
  box-shadow: 0 1px 2px rgb(0 0 0 / 0.1);
}
.opt {
  display: flex;
  min-height: 60px;
  align-items: center;
  gap: 12px;
  padding: 8px 12px;
  border: 1px solid #e5e7eb;
  border-radius: 12px;
}
.opt .desc {
  color: #71717a;
}
.opt.on {
  border-color: #818cf8;
  background: #eef2ff;
  color: #3730a3;
}
.opt.on .desc {
  color: #6366f1;
}
.chip {
  position: relative;
  display: inline-flex;
  min-height: 52px;
  flex-direction: column;
  align-items: flex-start;
  justify-content: center;
  gap: 2px;
  padding: 6px 12px;
  border: 2px solid #e5e7eb;
  border-radius: 12px;
  background: white;
  color: #374151;
  font-size: 0.9rem;
  font-weight: 500;
  text-align: left;
}
.chip.on {
  border-color: #667eea;
  background: #667eea;
  color: white;
}
.chip:disabled {
  opacity: 0.35;
}
.dot {
  display: inline-block;
  width: 9px;
  height: 9px;
  border-radius: 50%;
}
.bar {
  display: inline-flex;
  width: 64px;
  height: 8px;
  overflow: hidden;
  border-radius: 4px;
  background: #e5e7eb;
}
.bar b {
  height: 100%;
}
.tagpill {
  padding: 1px 8px;
  border-radius: 999px;
  background: #f4f4f5;
  font-size: 0.85rem;
}
</style>
