import type { InferResponseType } from 'hono/client'
import type { Filter, Find, Rules } from 'server/config'
import { cardModel, type CardModel } from 'server/dashboard'
import { evaluateDays, matchesFind, type DailyState } from 'server/rules'
import { computed, inject, provide, ref, type InjectionKey } from 'vue'
import type { api } from '../../api.ts'
import { removeRow, rowAt, type Place, type RowPath } from './find.ts'

export type RulesData = InferResponseType<(typeof api.cards)[':cardId']['rules']['$get'], 200>
export type Tab = 'now' | 'back'
export type CountedState = Extract<DailyState, 'good' | 'warning' | 'danger'>

export type TagOp = Extract<Filter, { kind: 'tag' }>['op']

export type Picker =
  | { kind: 'add'; tab: Tab; place: Place }
  /** Without `at` the row does not exist yet; the first tag picked creates it at `place`. */
  | { kind: 'tags'; tab: Tab; op: TagOp; at?: RowPath; place?: Place }
  | { kind: 'hour'; tab: Tab; at: RowPath; field: 'from' | 'to' }
  | { kind: 'weekday'; tab: Tab; at: RowPath }
  | { kind: 'records'; tab: Tab }
  | { kind: 'span' | 'measure' | 'want' }
  | { kind: 'duration'; field: 'soon' | 'warn' | 'danger' }
  | { kind: 'amount'; field: 'n' | 'red' | 'lo' | 'hi' }
  | { kind: 'day'; index: number }

export type Trial = { n: number; model: CardModel; tally: [CountedState, number][] }

export const PREVIEW_DAYS = 28

const COUNTED: CountedState[] = ['good', 'warning', 'danger']

/** Rules are plain JSON; this also copies out of reactive proxies. */
export const cloneRules = (rules: Rules): Rules => JSON.parse(JSON.stringify(rules))

function createRules(data: RulesData) {
  const draft = ref<Rules>(cloneRules(data.rules))
  const tab = ref<Tab>('now')
  const picker = ref<Picker | null>(null)
  const saved = JSON.stringify(data.rules)
  const dirty = computed(() => JSON.stringify(draft.value) !== saved)

  const findOf = (rules: Rules, t: Tab): Find => (t === 'back' && rules.back?.find) || rules.find
  const counted = (find: Find) => data.events.filter((e) => matchesFind(find, data.root, e))
  /** Gaps between counted records over the last 90 days, shortest first. */
  const gaps = computed(() => {
    const times = counted(draft.value.find)
      .map((e) => e.eventAt)
      .filter((at) => at >= data.now - 90 * 86400)
    return times.slice(1).map((at, i) => at - times[i]!).sort((a, b) => a - b)
  })
  const model = (rules: Rules) => cardModel({ ...data.card, rules }, data.events, data.now)
  const days = (rules: Rules) => evaluateDays(rules, data.root, data.events, data.now, PREVIEW_DAYS)
  const tally = (rules: Rules): [CountedState, number][] => {
    const states = days(rules)?.states ?? []
    return COUNTED.map((s) => [s, states.filter((x) => x === s || (s === 'good' && x === 'good-carry')).length])
  }

  function trial(mutate: (rules: Rules) => void): Trial {
    const copy = cloneRules(draft.value)
    mutate(copy)
    return { n: counted(findOf(copy, tab.value)).length, model: model(copy), tally: tally(copy) }
  }

  /** Closing a tag picker whose row ended up with no tags drops the row. */
  function closePicker() {
    const p = picker.value
    if (p?.kind === 'tags' && p.at) {
      const find = findOf(draft.value, p.tab)
      const row = rowAt(find, p.at)
      if (row.kind === 'tag' && row.tags.length === 0) removeRow(find, p.at)
    }
    picker.value = null
  }

  return { data, draft, tab, picker, dirty, findOf, counted, gaps, model, days, trial, tally, closePicker }
}

export type RulesContext = ReturnType<typeof createRules>
const KEY: InjectionKey<RulesContext> = Symbol('rules')

export function provideRules(data: RulesData): RulesContext {
  const context = createRules(data)
  provide(KEY, context)
  return context
}

export function useRules(): RulesContext {
  const context = inject(KEY)
  if (!context) throw new Error('useRules needs provideRules above it')
  return context
}
