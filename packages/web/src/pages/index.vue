<script setup lang="ts">
import { useQuery } from '@tanstack/vue-query'
import { ref } from 'vue'
import { api } from '../api.ts'
import CheckinSheet from '../components/CheckinSheet.vue'
import SleepCard from '../components/SleepCard.vue'
import WaterCard from '../components/WaterCard.vue'

const opened = ref<{ name: string; emoji: string } | null>(null)

const { data, isPending, isError } = useQuery({
  queryKey: ['dashboard'],
  queryFn: async () => {
    const res = await api.dashboard.$get({ query: {} })
    if (!res.ok) throw new Error(`dashboard: ${res.status}`)
    return res.json()
  },
  refetchInterval: 60_000,
})
</script>

<template>
  <div class="dashboard min-h-dvh">
  <main class="mx-auto flex max-w-2xl flex-col gap-3 p-3">
    <p v-if="isPending" class="p-6 text-center text-white/80">載入中…</p>
    <p v-else-if="isError" class="p-6 text-center text-white">讀取失敗</p>
    <template v-else-if="data">
      <template v-if="data.sleep">
        <h2 class="section">😴 作息</h2>
        <SleepCard :sleep="data.sleep" @open="opened = $event" />
      </template>
      <template v-if="data.urgent.length">
        <h2 class="section">⚠️ 需要注意</h2>
        <div class="grid grid-cols-2 gap-2">
          <WaterCard v-for="card in data.urgent" :key="card.id" :card="card" class="cursor-pointer" @click="opened = card" />
        </div>
      </template>
      <template v-if="data.others.length">
        <h2 class="section">✅ 其他活動</h2>
        <div class="grid grid-cols-2 gap-2">
          <WaterCard v-for="card in data.others" :key="card.id" :card="card" class="cursor-pointer" @click="opened = card" />
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
