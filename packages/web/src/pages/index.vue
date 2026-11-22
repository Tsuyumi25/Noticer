<script setup lang="ts">
import { useQuery } from '@tanstack/vue-query'
import { computed, ref } from 'vue'
import { useRoute, useRouter } from 'vue-router'
import CardBoard from '../components/CardBoard.vue'
import CheckinSheet, { type SheetCard } from '../components/CheckinSheet.vue'
import EventEditor from '../components/EventEditor.vue'
import RecentPanel from '../components/RecentPanel.vue'
import ReviewSheet from '../components/ReviewSheet.vue'
import SleepCard from '../components/SleepCard.vue'
import WaterCard from '../components/WaterCard.vue'
import { t } from '../i18n/index.ts'
import { vLongPress } from '../longPress.ts'
import { configQuery, dashboardQuery } from '../queries.ts'
import { isDesktop } from '../viewport.ts'
import type { ConflictEvent } from '../versions.ts'

const opened = ref<SheetCard | null>(null)
const editing = ref<ConflictEvent | null>(null)

const { data, isPending, isError } = useQuery({ ...dashboardQuery, refetchInterval: 60_000 })
const { data: config } = useQuery(configQuery)

const route = useRoute()
const router = useRouter()
const reviewing = computed(() => (typeof route.query.review === 'string' ? route.query.review : null))
const openReview = (cardId: string) => router.push({ query: { review: cardId } })
function closeReview() {
  if (window.history.state?.back) router.back()
  else router.replace({ query: {} })
}
</script>

<template>
  <div v-if="isDesktop" class="dashboard flex h-[calc(100dvh-56px)] gap-3.5 p-3.5">
    <main class="relative min-w-0 flex-[7] overflow-hidden">
      <p v-if="isPending" class="p-6 text-center text-white/80">{{ t('common.loading') }}</p>
      <p v-else-if="isError" class="p-6 text-center text-white">{{ t('common.loadFailed') }}</p>
      <CardBoard v-else-if="data && config" :dashboard="data" :layout="config.layout" @open="opened = $event" @review="openReview" />
    </main>
    <RecentPanel class="min-w-0 flex-[3]" @edit="editing = $event" />
  </div>
  <div v-else class="dashboard min-h-dvh">
  <main class="mx-auto flex max-w-2xl flex-col gap-3 p-3">
    <p v-if="isPending" class="p-6 text-center text-white/80">{{ t('common.loading') }}</p>
    <p v-else-if="isError" class="p-6 text-center text-white">{{ t('common.loadFailed') }}</p>
    <template v-else-if="data">
      <template v-if="data.sleep">
        <h2 class="section">{{ t('dashboard.sleep') }}</h2>
        <SleepCard :sleep="data.sleep" @open="opened = $event" @review="openReview" />
      </template>
      <template v-if="data.urgent.length">
        <h2 class="section">{{ t('dashboard.urgent') }}</h2>
        <div class="grid grid-cols-2 gap-2">
          <WaterCard
            v-for="card in data.urgent"
            :key="card.id"
            v-long-press="() => openReview(card.id)"
            :card="card"
            class="cursor-pointer"
            @click="opened = card"
          />
        </div>
      </template>
      <template v-if="data.others.length">
        <h2 class="section">{{ t('dashboard.others') }}</h2>
        <div class="grid grid-cols-2 gap-2">
          <WaterCard
            v-for="card in data.others"
            :key="card.id"
            v-long-press="() => openReview(card.id)"
            :card="card"
            class="cursor-pointer"
            @click="opened = card"
          />
        </div>
      </template>
    </template>
  </main>
  </div>
  <CheckinSheet v-if="opened" :key="opened.name" :card="opened" @close="opened = null" />
  <EventEditor v-if="editing" :key="editing.id" :event="editing" @close="editing = null" />
  <ReviewSheet
    v-if="reviewing"
    :key="reviewing"
    :card-id="reviewing"
    :sleep="reviewing === data?.sleep?.sleepCard.id || reviewing === data?.sleep?.wakeCard.id"
    @close="closeReview"
  />
</template>

<style scoped>
.dashboard {
  background: linear-gradient(135deg, #667eea 0%, #764ba2 100%);
}
.section {
  margin-bottom: -4px;
  padding: 0 0.25rem;
  font-size: 0.875rem;
  font-weight: 600;
  color: rgb(255 255 255 / 0.85);
}
</style>
