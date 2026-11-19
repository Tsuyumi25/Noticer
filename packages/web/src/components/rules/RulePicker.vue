<script setup lang="ts">
import type { BackRule, Measure, Rules, Want } from 'server/config'
import { dayStarts } from 'server/rules'
import { computed } from 'vue'
import { locale, t, tn, type MessageKey } from '../../i18n/index.ts'
import { ACCENT } from '../../status.ts'
import { DURATIONS, nextDuration, PREVIEW_DAYS, useRules, type Trial } from './context.ts'
import FindPicker from './FindPicker.vue'
import { amount, clock, duration, elapsed, measureLabel, statusWord } from './words.ts'

const { data, draft, tab, picker, findOf, counted, trial, days, closePicker: close } = useRules()
const p = computed(() => picker.value!)
const FIND_KINDS = new Set(['add', 'tags', 'hour', 'weekday'])

const DAY = 86400
const H = 3600

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
    case 'remind':
      return {
        title: t('rules.pick.remind'),
        list: [
          opt('worry', t('rules.remind.worry'), (r) => (r.now = r.now.kind === 'worry' ? r.now : { kind: 'worry', after: DAY }), { desc: t('rules.remind.worryDesc'), on: draft.value.now.kind === 'worry' }),
          opt('soon', t('rules.remind.soon'), (r) => (r.now = r.now.kind === 'soon' ? r.now : { kind: 'soon', within: 4 * H }), { desc: t('rules.remind.soonDesc'), on: draft.value.now.kind === 'soon' }),
          opt('off', t('rules.remind.off'), (r) => (r.now = { kind: 'off' }), { desc: t('rules.remind.offDesc'), on: draft.value.now.kind === 'off' }),
        ],
      }
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
      const measures: Measure[] = [{ kind: 'times' }, { kind: 'since' }, ...data.facts.flatMap((f): Measure[] => [{ kind: 'total', fact: f.key }, { kind: 'last', fact: f.key }])]
      return {
        title: t('rules.pick.measure'),
        list: measures.map((m) => {
          const fact = 'fact' in m ? (data.facts.find((f) => f.key === m.fact)?.name ?? '') : ''
          return opt(`${m.kind}-${'fact' in m ? m.fact : ''}`, measureLabel(m, data.facts), (r) => r.back && setMeasure(r.back, m), {
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

const gaps = computed(() => {
  const since = data.now - 90 * DAY
  const times = counted(draft.value.find)
    .map((e) => e.eventAt)
    .filter((at) => at >= since)
  return times.slice(1).map((at, i) => at - times[i]!)
})
const durationChoices = computed(() => {
  if (p.value.kind !== 'duration') return []
  const field = p.value.field
  const now = draft.value.now
  const current = now.kind === 'worry' ? (field === 'panic' ? now.panic : now.after) : now.kind === 'soon' ? now.within : undefined
  const sorted = [...gaps.value].sort((a, b) => a - b)
  const median = sorted[Math.floor(sorted.length / 2)]
  let list = median === undefined ? DURATIONS : DURATIONS.filter((d) => d >= median / 6 && d <= sorted.at(-1)! * 1.5)
  if (list.length < 6) list = DURATIONS
  if (field === 'panic' && now.kind === 'worry') list = list.filter((d) => d > now.after)
  if (current !== undefined && !list.includes(current)) list = [...list, current].sort((a, b) => a - b)
  return list.map((d) => ({
    d,
    on: d === current,
    over: gaps.value.length ? Math.round((gaps.value.filter((g) => g > d).length / gaps.value.length) * 100) : null,
    trial: trial((r) => setDuration(r, field, d)),
  }))
})
function setDuration(r: Rules, field: 'after' | 'panic' | 'within', d: number) {
  const now = r.now
  if (now.kind === 'soon' && field === 'within') now.within = d
  if (now.kind !== 'worry') return
  if (field === 'panic') now.panic = d
  if (field === 'after') {
    now.after = d
    if (now.panic !== undefined && now.panic <= d) now.panic = nextDuration(d)
  }
}
const durationSub = computed(() => {
  const sorted = [...gaps.value].sort((a, b) => a - b)
  const median = sorted[Math.floor(sorted.length / 2)]
  return median === undefined ? t('rules.pick.durationNoData') : t('rules.pick.durationSub', { median: elapsed(median), max: elapsed(sorted.at(-1)!) })
})

const amountChoices = computed(() => {
  if (p.value.kind !== 'amount' || !draft.value.back) return []
  const field = p.value.field
  const back = draft.value.back
  const want: Partial<Record<'n' | 'red' | 'lo' | 'hi', number>> = back.want.kind === 'off' ? {} : back.want
  const current = want[field] ?? 0
  const step = back.measure.kind === 'total' ? 5 : 1
  return Array.from({ length: 12 }, (_, i) => current + (i - 5) * step)
    .filter((v) => v >= 0 && (field !== 'red' || v > (want.n ?? 0)))
    .map((v) => ({ v, on: v === current, trial: trial((r) => setAmount(r, field, v)) }))
})
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
      <section class="flex max-h-[82dvh] w-full flex-col rounded-t-2xl bg-white pb-[env(safe-area-inset-bottom)]">
        <div class="mx-auto mt-2 h-1 w-10 shrink-0 rounded-full bg-zinc-300" />
        <div class="min-h-0 flex-1 overflow-y-auto overscroll-contain pb-4">
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

          <template v-else-if="p.kind === 'duration'">
            <h2 class="px-4 pt-2 text-base font-semibold">{{ fieldTitle(p.field) }}</h2>
            <p class="px-4 pt-0.5 text-sm text-zinc-500">{{ durationSub }}</p>
            <div class="mt-3 grid grid-cols-3 gap-2 px-4">
              <button
                v-for="c in durationChoices"
                :key="c.d"
                class="chip"
                :class="{ on: c.on }"
                @click="(setDuration(draft, (p as { field: 'after' | 'panic' | 'within' }).field, c.d), close())"
              >
                <span class="inline-flex items-center gap-1.5"><i class="dot" :style="{ background: ACCENT[c.trial.model.status] }" />{{ duration(c.d) }}</span>
                <span v-if="c.over !== null" class="text-[11px] font-normal opacity-70">{{ t('rules.pick.over', { n: c.over }) }}</span>
              </button>
            </div>
            <p class="px-4 pt-3 text-xs text-zinc-500">{{ t('rules.pick.dotHint') }}</p>
          </template>

          <template v-else-if="p.kind === 'amount' && draft.back">
            <h2 class="px-4 pt-2 text-base font-semibold">{{ fieldTitle(p.field) }}</h2>
            <p class="px-4 pt-0.5 text-sm text-zinc-500">{{ t('rules.pick.amountSub') }}</p>
            <div class="mt-3 grid grid-cols-3 gap-2 px-4">
              <button
                v-for="c in amountChoices"
                :key="c.v"
                class="chip"
                :class="{ on: c.on }"
                @click="(setAmount(draft, (p as { field: 'n' | 'red' | 'lo' | 'hi' }).field, c.v), close())"
              >
                <span>{{ amount(draft.back.measure, data.facts, c.v) }}</span>
                <span class="bar w-full"><b v-for="x in tally(c.trial)" :key="x.s" :style="{ width: x.width, background: FILL[x.s] }" /></span>
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
                  : `${draft.back ? measureLabel(draft.back.measure, data.facts) : ''} ${draft.back ? amount(draft.back.measure, data.facts, day.value) : day.value}`
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
