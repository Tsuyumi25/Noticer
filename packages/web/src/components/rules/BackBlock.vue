<script setup lang="ts">
import { Calendar } from 'lucide-vue-next'
import { t } from '../../i18n/index.ts'
import { useRules } from './context.ts'
import Phrase from './Phrase.vue'
import RuleBlock from './RuleBlock.vue'
import SwitchRow from './SwitchRow.vue'
import Tok from './Tok.vue'
import { amount, measureLabel } from './words.ts'

const { data, draft, picker } = useRules()

function toggleRed() {
  const want = draft.value.back?.want
  if (want?.kind !== 'atMost') return
  if (want.red === undefined) want.red = want.n + (draft.value.back!.measure.kind === 'since' ? 3 : 1)
  else delete want.red
}
</script>

<template>
  <RuleBlock :label="t('rules.back.label')" :icon="Calendar" tint="bg-emerald-50 text-emerald-600">
    <template #head>
      <Tok v-if="!draft.back" @click="picker = { kind: 'span' }">{{ t('rules.span.none') }}</Tok>
      <Phrase v-else :text="t('rules.back.sentence')">
        <template #span><Tok @click="picker = { kind: 'span' }">{{ t(`rules.span.${draft.back.span}`) }}</Tok></template>
        <template #measure><Tok @click="picker = { kind: 'measure' }">{{ measureLabel(draft.back.measure) }}</Tok></template>
        <template #want>
          <template v-if="draft.back.want.kind === 'off'">
            <Tok @click="picker = { kind: 'want' }">{{ t('rules.want.off') }}</Tok>
          </template>
          <Phrase v-else-if="draft.back.want.kind === 'between'" :text="t('rules.back.between')">
            <template #word><Tok @click="picker = { kind: 'want' }">{{ t('rules.want.between') }}</Tok></template>
            <template #lo><Tok @click="picker = { kind: 'amount', field: 'lo' }">{{ amount(draft.back.measure, data.units, draft.back.want.lo) }}</Tok></template>
            <template #hi><Tok @click="picker = { kind: 'amount', field: 'hi' }">{{ amount(draft.back.measure, data.units, draft.back.want.hi) }}</Tok></template>
          </Phrase>
          <template v-else>
            <Tok @click="picker = { kind: 'want' }">{{ t(`rules.want.${draft.back.want.kind}`) }}</Tok>
            {{ ' ' }}
            <Tok :tone="draft.back.want.kind === 'atMost' && draft.back.want.red !== undefined ? 'warning' : undefined" @click="picker = { kind: 'amount', field: 'n' }">
              {{ amount(draft.back.measure, data.units, draft.back.want.n) }}
            </Tok>
            <Phrase v-if="draft.back.want.kind === 'atMost' && draft.back.want.red !== undefined" :text="t('rules.back.red')">
              <template #red><Tok tone="danger" @click="picker = { kind: 'amount', field: 'red' }">{{ amount(draft.back.measure, data.units, draft.back.want.red) }}</Tok></template>
            </Phrase>
          </template>
        </template>
      </Phrase>
    </template>
    <template v-if="draft.back" #footer>
      <SwitchRow
        v-if="draft.back.want.kind === 'atMost'"
        :title="t('rules.twoStep')"
        :hint="t('rules.redStepHint')"
        :on="draft.back.want.red !== undefined"
        @click="toggleRed"
      />
    </template>
  </RuleBlock>
</template>
