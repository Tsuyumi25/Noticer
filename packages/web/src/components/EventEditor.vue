<script setup lang="ts">
import { useQuery } from '@tanstack/vue-query'
import { PURE_CARD } from 'server/pure'
import { computed, ref } from 'vue'
import { configQuery } from '../queries.ts'
import { asVersion, versionPick, type ConflictEvent } from '../versions.ts'
import CheckinSheet from './CheckinSheet.vue'
import QuickNoteSheet from './QuickNoteSheet.vue'

const props = defineProps<{ event: ConflictEvent; docked?: boolean }>()
const emit = defineEmits<{ close: [] }>()

const { data: config } = useQuery(configQuery)
const card = computed(() => config.value?.cards.find((c) => c.id === props.event.cardId))

const version = ref(0)
const switched = ref(false)
function showVersion(index: number) {
  version.value = index
  switched.value = true
}

const sheet = ref<InstanceType<typeof CheckinSheet> | InstanceType<typeof QuickNoteSheet> | null>(null)
defineExpose({
  get dirty() {
    return sheet.value?.dirty ?? false
  },
  requestClose: () => sheet.value?.requestClose(),
})
</script>

<template>
  <QuickNoteSheet
    v-if="event.cardId === PURE_CARD"
    ref="sheet"
    :key="`${event.id}-${version}`"
    :event="asVersion(event, version)"
    :versions="versionPick(event, version)"
    :instant="switched"
    :docked="docked"
    @version="showVersion"
    @close="emit('close')"
  />
  <CheckinSheet
    v-else-if="card"
    ref="sheet"
    :key="`${event.id}-${version}`"
    :card="{ id: card.id, name: card.name, emoji: card.emoji }"
    :event="asVersion(event, version)"
    :versions="versionPick(event, version)"
    :instant="switched"
    :docked="docked"
    @version="showVersion"
    @close="emit('close')"
  />
</template>
