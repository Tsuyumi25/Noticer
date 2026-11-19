<script setup lang="ts">
import { useQuery } from '@tanstack/vue-query'
import { ref } from 'vue'
import { useRouter } from 'vue-router'
import CheckinSheet, { type SheetCard } from '../components/CheckinSheet.vue'
import SleepCard from '../components/SleepCard.vue'
import WaterCard from '../components/WaterCard.vue'
import { t } from '../i18n/index.ts'
import { vLongPress } from '../longPress.ts'
import { dashboardQuery } from '../queries.ts'

const opened = ref<SheetCard | null>(null)

const { data, isPending, isError } = useQuery({ ...dashboardQuery, refetchInterval: 60_000 })

const router = useRouter()
const openReview = (cardId: string) => router.push(`/cards/${cardId}`)
</script>

<template>
  <div class="dashboard min-h-dvh">
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
  <CheckinSheet v-if="opened" :key="opened.name" :card="opened" @close="opened = null" />
  </div>
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
