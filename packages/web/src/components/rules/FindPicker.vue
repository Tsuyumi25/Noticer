<script setup lang="ts">
import type { Filter } from 'server/config'
import { computed } from 'vue'
import { t } from '../../i18n/index.ts'
import { useRules, type Picker, type TagOp } from './context.ts'
import { canDeepen, placeRow, removeRow, rowAt, type Place, type RowPath } from './find.ts'
import { timeOfDay } from './words.ts'

type FindPicker = Extract<Picker, { kind: 'add' | 'tags' | 'clock' | 'weekday' }>

const { data, draft, picker, findOf, closePicker } = useRules()
const p = computed(() => picker.value as FindPicker)
const find = computed(() => findOf(draft.value, p.value.tab))
const row = computed(() => ('at' in p.value && p.value.at ? rowAt(find.value, p.value.at) : undefined))

const tagGroups = computed(() =>
  [
    ...data.tags.groups.filter((g) => g.tags.length).map((g) => ({ name: g.name, color: g.color, tags: g.tags })),
    { name: t('rules.pick.otherTags'), color: '#9ca3af', tags: data.tags.ungrouped },
  ].filter((g) => g.tags.length),
)

const title = computed(() => {
  const cur = p.value
  if (cur.kind === 'add') return t(cur.place.kind === 'block' ? 'rules.find.add' : cur.place.kind === 'layer' ? 'rules.add.same' : 'rules.add.deeper')
  if (cur.kind === 'tags') return t(op.value === 'not' ? 'rules.pick.tagsNot' : 'rules.pick.tagsHas')
  if (cur.kind === 'clock') return t(cur.field === 'from' ? 'rules.pick.from' : 'rules.pick.to')
  return t('rules.pick.weekday')
})

function addKind(kind: 'has' | 'not' | 'time' | 'weekday') {
  const cur = p.value as Extract<FindPicker, { kind: 'add' }>
  if (kind === 'has' || kind === 'not') {
    picker.value = { kind: 'tags', tab: cur.tab, op: kind, place: cur.place }
    return
  }
  const fresh: Filter = kind === 'time' ? { kind: 'time', from: 6 * 60, to: 10 * 60 } : { kind: 'weekday', is: 'weekday' }
  placeRow(find.value, cur.place, fresh)
  closePicker()
}

function toggleTag(tag: string) {
  const cur = p.value as Extract<FindPicker, { kind: 'tags' }>
  if (!cur.at) {
    picker.value = { ...cur, at: placeRow(find.value, cur.place!, { kind: 'tag', op: cur.op, tags: [tag] }) }
    return
  }
  const r = rowAt(find.value, cur.at)
  if (r.kind !== 'tag') return
  r.tags = r.tags.includes(tag) ? r.tags.filter((x) => x !== tag) : [...r.tags, tag]
}

const chosen = computed(() => (row.value?.kind === 'tag' ? row.value.tags : []))
const op = computed(() => (row.value?.kind === 'tag' ? row.value.op : (p.value as Extract<FindPicker, { kind: 'tags' }>).op))
const OPS: { op: TagOp; label: 'rules.row.hasAny' | 'rules.row.all' | 'rules.row.not' }[] = [
  { op: 'has', label: 'rules.row.hasAny' },
  { op: 'all', label: 'rules.row.all' },
  { op: 'not', label: 'rules.row.not' },
]

function setOp(next: TagOp) {
  const cur = p.value as Extract<FindPicker, { kind: 'tags' }>
  if (row.value?.kind === 'tag') row.value.op = next
  else picker.value = { ...cur, op: next }
}

/** The row's own actions; hidden while a tag row has no tags left, since closing will drop it. */
const actions = computed(() => {
  const cur = p.value
  if (cur.kind === 'add' || !cur.at || (row.value?.kind === 'tag' && row.value.tags.length === 0)) return null
  return { at: cur.at, deeper: canDeepen(find.value, cur.at) }
})

function addBeside(at: RowPath, deeper: boolean) {
  const place: Place = deeper ? { kind: 'deeper', block: at.block } : { kind: 'layer', block: at.block, layer: at.layer }
  picker.value = { kind: 'add', tab: p.value.tab, place }
}

function remove(at: RowPath) {
  removeRow(find.value, at)
  picker.value = null
}

const clock = computed(() => (row.value?.kind === 'time' && p.value.kind === 'clock' ? row.value[p.value.field] : 0))
/** Minutes first keeps the sheet open; the hour sets the time and closes it. */
function setClock(hour: number | null, minute: number | null) {
  const r = row.value
  const cur = p.value
  if (r?.kind !== 'time' || cur.kind !== 'clock') return
  r[cur.field] = (hour ?? Math.floor(clock.value / 60)) * 60 + (minute ?? clock.value % 60)
  if (hour !== null) closePicker()
}

function setWeekday(is: 'weekday' | 'weekend') {
  if (row.value?.kind === 'weekday') row.value.is = is
  closePicker()
}

const KINDS = ['has', 'not', 'time', 'weekday'] as const
</script>

<template>
  <h2 class="px-4 pt-2 text-base font-semibold">{{ title }}</h2>

  <div v-if="p.kind === 'add'" class="mt-3 flex flex-col gap-2 px-4">
    <button v-for="k in KINDS" :key="k" class="opt" @click="addKind(k)">{{ t(`rules.add.${k}`) }}</button>
  </div>

  <template v-else-if="p.kind === 'tags'">
    <div class="mt-3 grid grid-cols-3 gap-2 px-4">
      <button v-for="o in OPS" :key="o.op" class="opt justify-center text-sm" :class="{ on: op === o.op }" @click="setOp(o.op)">{{ t(o.label) }}</button>
    </div>
    <section v-for="g in tagGroups" :key="g.name" class="mt-4 px-4">
      <h3 class="mb-2 border-l-[3px] pl-2 text-[0.9rem] font-semibold" :style="{ borderColor: g.color }">{{ g.name }}</h3>
      <div class="flex flex-wrap gap-2">
        <button v-for="tag in g.tags" :key="tag" class="chip" :class="{ on: chosen.includes(tag) }" @click="toggleTag(tag)">{{ tag }}</button>
      </div>
    </section>
  </template>

  <template v-else-if="p.kind === 'clock' && row?.kind === 'time'">
    <div class="mt-3 grid grid-cols-4 gap-2 px-4">
      <button v-for="m in [0, 15, 30, 45]" :key="m" class="opt justify-center tabular-nums" :class="{ on: clock % 60 === m }" @click="setClock(null, m)">
        :{{ String(m).padStart(2, '0') }}
      </button>
    </div>
    <div class="mt-3 grid grid-cols-4 gap-2 px-4">
      <button v-for="h in 24" :key="h" class="chip justify-center tabular-nums" :class="{ on: Math.floor(clock / 60) === h - 1 }" @click="setClock(h - 1, null)">
        {{ timeOfDay((h - 1) * 60 + (clock % 60)) }}
      </button>
    </div>
  </template>

  <div v-else-if="p.kind === 'weekday' && row?.kind === 'weekday'" class="mt-3 flex flex-col gap-2 px-4">
    <button v-for="is in ['weekday', 'weekend'] as const" :key="is" class="opt" :class="{ on: row.is === is }" @click="setWeekday(is)">
      {{ t(`rules.${is}`) }}
    </button>
  </div>

  <div v-if="actions" class="mt-5 flex flex-col gap-2 px-4">
    <button class="opt" @click="addBeside(actions.at, false)">{{ t('rules.add.same') }}</button>
    <button v-if="actions.deeper" class="opt" @click="addBeside(actions.at, true)">{{ t('rules.add.deeper') }}</button>
    <button class="opt text-red-600" @click="remove(actions.at)">{{ t('rules.remove') }}</button>
  </div>

  <div v-if="p.kind === 'tags'" class="mt-5 px-4">
    <button class="h-12 w-full rounded-xl bg-zinc-100 font-semibold" @click="closePicker">{{ t('common.done') }}</button>
  </div>
</template>

<style scoped>
.opt {
  display: flex;
  min-height: 52px;
  align-items: center;
  padding: 8px 12px;
  border: 1px solid #e5e7eb;
  border-radius: 12px;
  font-weight: 600;
}
.opt.on {
  border-color: #818cf8;
  background: #eef2ff;
  color: #3730a3;
}
.chip {
  display: inline-flex;
  min-height: 44px;
  align-items: center;
  padding: 0 12px;
  border: 2px solid #e5e7eb;
  border-radius: 12px;
  background: white;
  color: #374151;
  font-size: 0.9rem;
  font-weight: 500;
}
.chip.on {
  border-color: #667eea;
  background: #667eea;
  color: white;
}
</style>
