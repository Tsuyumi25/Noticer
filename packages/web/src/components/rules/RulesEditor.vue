<script setup lang="ts">
import BackBlock from './BackBlock.vue'
import { provideRules, type RulesData } from './context.ts'
import FindBlock from './FindBlock.vue'
import NowBlock from './NowBlock.vue'
import RulePicker from './RulePicker.vue'
import RulesPreview from './RulesPreview.vue'
import FoundRecords from './FoundRecords.vue'

const props = defineProps<{ data: RulesData }>()
const { draft, tab, picker, dirty, closePicker } = provideRules(props.data)

defineExpose({ draft, picker, dirty, closePicker })
</script>

<template>
  <RulesPreview />
  <template v-if="tab === 'now'">
    <FindBlock tab="now" />
    <NowBlock />
  </template>
  <template v-else>
    <BackBlock />
    <FindBlock v-if="draft.back" tab="back" />
  </template>
  <FoundRecords />
  <RulePicker v-if="picker" />
</template>
