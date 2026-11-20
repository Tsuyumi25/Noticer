<script setup lang="ts">
import type { Filter } from 'server/config'
import { Funnel, Plus } from 'lucide-vue-next'
import { computed } from 'vue'
import { t } from '../../i18n/index.ts'
import { cloneRules, useRules, type Tab } from './context.ts'
import { flip, outline, type Entry, type RowPath } from './find.ts'
import Phrase from './Phrase.vue'
import RuleBlock from './RuleBlock.vue'
import SwitchRow from './SwitchRow.vue'
import Tok from './Tok.vue'
import { hour } from './words.ts'

const props = defineProps<{ tab: Tab }>()
const { data, draft, picker, findOf } = useRules()

const find = computed(() => findOf(draft.value, props.tab))
/** Looking back reuses the Now find until it gets its own. */
const same = computed(() => props.tab === 'back' && !draft.value.back?.find)

function toggleSame() {
  const back = draft.value.back
  if (!back) return
  if (back.find) delete back.find
  else back.find = cloneRules(draft.value).find
}

// A row's connector token starts at lane(depth); a group's line drops from under its token and ticks right into each member's token.
const lane = (depth: number) => 34 + depth * 28
const DROP = 16
const MID = 28
const TOKEN_BOTTOM = 49
const LEVELS = 4
const LINE = ['bg-[#b9c9dc]', 'bg-[#bcd6c3]', 'bg-[#dcc9ab]', 'bg-[#d5c2d4]']

type Line = { cls: string; style: Record<string, string> }

const rows = computed(() => {
  const { entries, groups } = outline(find.value)
  return entries.map((entry, i) => {
    const lines: Line[] = []
    for (const g of groups) {
      if (g.from === null && g.members.length < 2) continue
      const start = g.from ?? g.members[0]!
      const end = g.members.at(-1)!
      if (i < start || i > end) continue
      const x = (g.from === null ? lane(-1) : lane(entries[g.from]!.depth)) + DROP
      const color = LINE[g.level % LEVELS]!
      const down = `${color} -ml-px w-0.5`
      if (i > start) lines.push({ cls: down, style: { left: `${x}px`, top: '0', height: `${MID}px` } })
      if (i < end) lines.push({ cls: down, style: { left: `${x}px`, top: `${i === g.from ? TOKEN_BOTTOM : MID}px`, bottom: '0' } })
      if (g.members.includes(i)) lines.push({ cls: `${color} h-0.5`, style: { left: `${x}px`, top: `${MID - 1}px`, width: `${lane(entry.depth) - x}px` } })
    }
    return { entry, lines, connector: entry.group.members.length > 1 }
  })
})

const TONES = ['level0', 'level1', 'level2', 'level3'] as const
const tone = (entry: Entry) => TONES[entry.group.level % LEVELS]!
/** 「包含」 with one tag, 「包含其中一個」 with several. */
const opLabel = (row: Extract<Filter, { kind: 'tag' }>) =>
  t(row.op === 'has' ? (row.tags.length > 1 ? 'rules.row.hasAny' : 'rules.row.has') : row.op === 'all' ? 'rules.row.all' : 'rules.row.not')
const openTags = (at: RowPath, row: Extract<Filter, { kind: 'tag' }>) => (picker.value = { kind: 'tags', tab: props.tab, op: row.op, at })
</script>

<template>
  <RuleBlock :label="t('rules.find.label')" :icon="Funnel" tint="bg-indigo-50 text-indigo-600">
    <template v-if="tab === 'back'" #top>
      <SwitchRow :title="t('rules.sameFind')" :on="same" @click="toggleSame" />
    </template>
    <template v-if="!same" #head>
      <Phrase :text="t(find.blocks.length ? 'rules.find.head' : 'rules.find.all')">
        <template #root><b class="font-semibold">{{ t('common.quoted', { text: data.root }) }}</b></template>
      </Phrase>
      <template v-if="find.blocks.length">{{ t('rules.find.where') }}</template>
    </template>

    <template v-if="!same">
      <div
        v-for="(r, i) in rows"
        :key="i"
        class="relative border-t border-zinc-100 py-1 pr-4"
        :style="{ paddingLeft: `${r.connector ? lane(r.entry.depth) : 16}px` }"
      >
        <i v-for="(l, j) in r.lines" :key="j" class="absolute" :class="l.cls" :style="l.style" />
        <p class="leading-[2.6]">
          <template v-if="r.connector">
            <Tok :tone="tone(r.entry)" @click="flip(find, r.entry.group.joint)">{{ r.entry.group.match === 'all' ? 'AND' : 'OR' }}</Tok>{{ ' ' }}
          </template>
          <template v-if="r.entry.row?.kind === 'tag'">
            <Tok tone="muted" @click="openTags(r.entry.at!, r.entry.row)">{{ opLabel(r.entry.row) }}</Tok>{{ ' ' }}
            <template v-for="(tag, j) in r.entry.row.tags" :key="tag">
              <span v-if="j > 0" class="px-0.5 text-zinc-400">、</span>
              <Tok @click="openTags(r.entry.at!, r.entry.row)">{{ tag }}</Tok>
            </template>
          </template>
          <Phrase v-else-if="r.entry.row?.kind === 'time'" :text="t('rules.row.time')">
            <template #from><Tok @click="picker = { kind: 'hour', tab, at: r.entry.at!, field: 'from' }">{{ hour(r.entry.row.from) }}</Tok></template>
            <template #to><Tok @click="picker = { kind: 'hour', tab, at: r.entry.at!, field: 'to' }">{{ hour(r.entry.row.to) }}</Tok></template>
          </Phrase>
          <Phrase v-else-if="r.entry.row?.kind === 'weekday'" :text="t('rules.row.weekday')">
            <template #is><Tok @click="picker = { kind: 'weekday', tab, at: r.entry.at! }">{{ t(`rules.${r.entry.row.is}`) }}</Tok></template>
          </Phrase>
        </p>
      </div>

      <button
        class="flex min-h-12 w-full items-center gap-2 border-t border-zinc-100 px-4 font-medium text-indigo-600"
        @click="picker = { kind: 'add', tab, place: { kind: 'block' } }"
      >
        <Plus :size="18" />{{ t('rules.find.add') }}
      </button>
    </template>
  </RuleBlock>
</template>
