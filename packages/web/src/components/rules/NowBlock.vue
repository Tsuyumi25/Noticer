<script setup lang="ts">
import { Clock } from 'lucide-vue-next'
import { t } from '../../i18n/index.ts'
import { nextDuration, useRules } from './context.ts'
import Phrase from './Phrase.vue'
import RuleBlock from './RuleBlock.vue'
import SwitchRow from './SwitchRow.vue'
import Tok from './Tok.vue'
import { duration } from './words.ts'

const { draft, picker } = useRules()

function toggleTwoStep() {
  const now = draft.value.now
  if (now.kind !== 'worry') return
  if (now.panic === undefined) now.panic = nextDuration(now.after)
  else delete now.panic
}
</script>

<template>
  <RuleBlock :label="t('rules.now.label')" :icon="Clock" tint="bg-orange-50 text-orange-600">
    <template #head>
      <Tok v-if="draft.now.kind === 'off'" @click="picker = { kind: 'remind' }">{{ t('rules.kind.off') }}</Tok>
      <Phrase v-else-if="draft.now.kind === 'soon'" :text="t('rules.now.soon')">
        <template #within><Tok tone="pending" @click="picker = { kind: 'duration', field: 'within' }">{{ duration(draft.now.within) }}</Tok></template>
        <template #kind><Tok @click="picker = { kind: 'remind' }">{{ t('rules.kind.soon') }}</Tok></template>
      </Phrase>
      <template v-else>
        <Phrase :text="t('rules.now.worry')">
          <template #after>
            <Tok :tone="draft.now.panic === undefined ? 'danger' : 'warning'" @click="picker = { kind: 'duration', field: 'after' }">{{ duration(draft.now.after) }}</Tok>
          </template>
          <template #kind><Tok @click="picker = { kind: 'remind' }">{{ t('rules.kind.worry') }}</Tok></template>
        </Phrase>
        <Phrase v-if="draft.now.panic !== undefined" :text="t('rules.now.panic')">
          <template #panic><Tok tone="danger" @click="picker = { kind: 'duration', field: 'panic' }">{{ duration(draft.now.panic) }}</Tok></template>
        </Phrase>
      </template>
    </template>
    <template v-if="draft.now.kind === 'worry'" #footer>
      <SwitchRow :title="t('rules.twoStep')" :hint="t('rules.twoStepHint')" :on="draft.now.panic !== undefined" @click="toggleTwoStep" />
    </template>
  </RuleBlock>
</template>
