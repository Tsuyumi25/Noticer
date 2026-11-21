<script setup lang="ts">
import { useMutation, useQuery, useQueryClient } from '@tanstack/vue-query'
import { Lock, Plus } from 'lucide-vue-next'
import { computed, onMounted, onUnmounted, ref } from 'vue'
import { api } from '../api.ts'
import { t, tn } from '../i18n/index.ts'
import { useSheetDrag } from '../sheetDrag.ts'

/** A card is a quick note with one tag locked in: pick that tag, then the ones it starts with picked. */
const emit = defineEmits<{ close: [] }>()

const { data: cards } = useQuery({
  queryKey: ['cards'],
  queryFn: async () => {
    const res = await api.cards.$get()
    if (!res.ok) throw new Error(`cards: ${res.status}`)
    return res.json()
  },
})
const { data: start } = useQuery({
  queryKey: ['pure'],
  queryFn: async () => {
    const res = await api.pure.$get()
    if (!res.ok) throw new Error(`pure: ${res.status}`)
    return res.json()
  },
})

const root = ref<string | null>(null)
const query = ref('')
const rootEmoji = computed(() => new Map((start.value?.roots ?? []).map((r) => [r.tag, r.emoji])))
const usedBy = computed(() => {
  const counts = new Map<string, number>()
  for (const card of cards.value ?? []) counts.set(card.root, (counts.get(card.root) ?? 0) + 1)
  return counts
})
const candidates = computed(() => {
  const q = query.value.trim()
  const tags = start.value?.tags ?? []
  return q === '' ? tags : tags.filter((tag) => tag.includes(q))
})
const typedNew = computed(() => {
  const q = query.value.trim()
  return q !== '' && !(start.value?.tags ?? []).includes(q) ? q : null
})

const { data: list } = useQuery({
  queryKey: computed(() => ['rootTags', root.value]),
  enabled: computed(() => root.value !== null),
  queryFn: async () => {
    const res = await api.roots[':tag'].tags.$get({ param: { tag: root.value! } })
    if (!res.ok) throw new Error(`root tags: ${res.status}`)
    return res.json()
  },
})
const groups = computed(() => (list.value?.groups ?? []).filter((g) => g.tags.length > 0))
const siblings = computed(() => (cards.value ?? []).filter((card) => card.root === root.value))

const copyOf = ref<string | null>(null)
const defaults = ref<string[]>([])
const picked = computed(() => new Set(defaults.value))
const name = ref('')
const nameTouched = ref(false)
const emoji = ref('')
const emojiTouched = ref(false)
const autoName = computed(() => defaults.value.at(-1) ?? root.value ?? '')
const shownName = computed({
  get: () => (nameTouched.value ? name.value : autoName.value),
  set: (v: string) => {
    nameTouched.value = true
    name.value = v
  },
})
const shownEmoji = computed({
  get: () => (emojiTouched.value ? emoji.value : (cards.value?.find((c) => c.id === copyOf.value)?.emoji ?? rootEmoji.value.get(root.value ?? '') ?? '')),
  set: (v: string) => {
    emojiTouched.value = true
    emoji.value = v
  },
})

function chooseRoot(tag: string) {
  root.value = tag
  copyOf.value = null
  defaults.value = []
}
function startFrom(cardId: string | null) {
  copyOf.value = cardId
  defaults.value = [...(cards.value?.find((c) => c.id === cardId)?.defaultTags ?? [])]
}
function toggle(tag: string) {
  defaults.value = picked.value.has(tag) ? defaults.value.filter((x) => x !== tag) : [...defaults.value, tag]
}

const ready = computed(() => root.value !== null && shownName.value.trim() !== '' && shownEmoji.value.trim() !== '')
const queryClient = useQueryClient()
const create = useMutation({
  mutationFn: async () => {
    const res = await api.cards.$post({
      json: {
        name: shownName.value,
        emoji: shownEmoji.value,
        root: root.value!,
        defaultTags: defaults.value,
        ...(copyOf.value === null ? {} : { copyOf: copyOf.value }),
      },
    })
    if (!res.ok) throw new Error(t('builder.failed', { status: res.status }))
  },
  onSuccess: () => {
    for (const key of ['cards', 'dashboard', 'config', 'pure', 'cardTags']) queryClient.invalidateQueries({ queryKey: [key] })
    leave()
  },
})

const confirming = ref(false)
const { sheet, sheetStyle, backdrop, animated, leaving, leave, settle, isLeaveEnd, onTouchStart, onTouchMove, onTouchEnd } = useSheetDrag({
  onRequestClose: requestClose,
  canDrag: () => !confirming.value,
})
function requestClose() {
  if (leaving.value) return
  if (root.value === null) return leave()
  settle()
  confirming.value = true
}
function onTransitionEnd(e: TransitionEvent) {
  if (isLeaveEnd(e)) emit('close')
}
function onKeydown(e: KeyboardEvent) {
  if (e.key !== 'Escape') return
  if (confirming.value) confirming.value = false
  else requestClose()
}
onMounted(() => window.addEventListener('keydown', onKeydown))
onUnmounted(() => window.removeEventListener('keydown', onKeydown))
</script>

<template>
  <Teleport to="body">
    <div class="fixed inset-0 z-50">
      <div class="absolute inset-0 bg-black" :class="{ 'sheet-animated': animated }" :style="{ opacity: backdrop }" />
      <section
        ref="sheet"
        class="full-sheet"
        :class="{ 'sheet-animated': animated }"
        :style="sheetStyle"
        @touchstart="onTouchStart"
        @touchmove="onTouchMove"
        @touchend="onTouchEnd"
        @touchcancel="onTouchEnd"
        @transitionend="onTransitionEnd"
      >
        <div class="mx-auto mt-2 h-1 w-10 shrink-0 rounded-full bg-zinc-300" />
        <div class="flex h-12 shrink-0 items-center px-4">
          <h2 class="text-lg font-semibold">{{ t('builder.title') }}</h2>
        </div>

        <div v-if="root === null" class="flex min-h-0 flex-1 flex-col">
          <div class="shrink-0 px-4 pb-2">
            <p class="mb-1.5 text-sm text-zinc-500">{{ t('builder.pickTag') }}</p>
            <input v-model="query" class="h-11 w-full rounded-xl border border-zinc-300 px-3 text-base" :aria-label="t('builder.pickTag')" />
          </div>
          <ul class="min-h-0 flex-1 divide-y divide-zinc-100 overflow-y-auto overscroll-contain border-t border-zinc-100">
            <li v-if="typedNew">
              <button class="flex h-12 w-full items-center gap-2 px-4 text-indigo-600" @click="chooseRoot(typedNew)">
                <Plus :size="18" />{{ t('builder.newTag', { tag: typedNew }) }}
              </button>
            </li>
            <li v-for="tag in candidates" :key="tag">
              <button class="flex h-12 w-full items-center justify-between px-4" @click="chooseRoot(tag)">
                <span>{{ rootEmoji.get(tag) ?? '' }} {{ tag }}</span>
                <span v-if="usedBy.get(tag)" class="text-sm text-zinc-400">{{ tn('builder.cards', usedBy.get(tag)!) }}</span>
              </button>
            </li>
          </ul>
        </div>

        <div v-else class="min-h-0 flex-1 overflow-y-auto overscroll-contain px-4 pb-4">
          <div class="flex items-center gap-2">
            <span class="chip on"><Lock :size="14" />{{ rootEmoji.get(root) ?? '' }} {{ root }}</span>
            <button class="h-11 px-2 font-semibold text-indigo-600" @click="root = null">{{ t('builder.change') }}</button>
          </div>

          <template v-if="siblings.length">
            <h4 class="gtitle mt-4" style="border-left-color: #9ca3af">{{ t('builder.startFrom') }}</h4>
            <div class="chips">
              <button class="chip" :class="{ on: copyOf === null }" @click="startFrom(null)">{{ t('builder.blank') }}</button>
              <button v-for="card in siblings" :key="card.id" class="chip" :class="{ on: copyOf === card.id }" @click="startFrom(card.id)">
                <span class="emoji">{{ card.emoji }}</span>{{ t('builder.copy', { name: card.name }) }}
              </button>
            </div>
          </template>

          <div v-for="g in groups" :key="g.name" class="mt-4">
            <h4 class="gtitle" :style="{ borderLeftColor: g.color }">{{ g.name }}</h4>
            <div class="chips">
              <button v-for="x in g.tags" :key="x.label" class="chip" :class="{ on: picked.has(x.label) }" @click="toggle(x.label)">
                <span v-if="x.emoji" class="emoji">{{ x.emoji }}</span>{{ x.label }}
              </button>
            </div>
          </div>
          <div v-if="list?.ungrouped.length" class="mt-4">
            <h4 class="gtitle" style="border-left-color: #9ca3af">{{ t('tags.ungrouped') }}</h4>
            <div class="chips">
              <button v-for="tag in list.ungrouped" :key="tag" class="chip" :class="{ on: picked.has(tag) }" @click="toggle(tag)">{{ tag }}</button>
            </div>
          </div>

          <div class="mt-6 flex gap-3">
            <label class="w-20 shrink-0">
              <span class="mb-1 block text-sm text-zinc-500">{{ t('builder.emoji') }}</span>
              <input v-model="shownEmoji" class="h-11 w-full rounded-xl border border-zinc-300 text-center text-xl" />
            </label>
            <label class="min-w-0 flex-1">
              <span class="mb-1 block text-sm text-zinc-500">{{ t('builder.name') }}</span>
              <input v-model="shownName" class="h-11 w-full rounded-xl border border-zinc-300 px-3 text-base" />
            </label>
          </div>
        </div>

        <footer class="shrink-0 border-t border-zinc-200 px-4 pt-3 pb-[calc(0.75rem+env(safe-area-inset-bottom))]">
          <p v-if="create.error.value" class="mb-2 text-center text-sm text-red-600">{{ create.error.value.message }}</p>
          <div class="flex gap-3">
            <button class="h-12 flex-1 rounded-xl bg-zinc-100 font-semibold" @click="requestClose">{{ t('common.cancel') }}</button>
            <button
              class="h-12 flex-1 rounded-xl bg-indigo-600 font-semibold text-white disabled:opacity-40"
              :disabled="!ready || create.isPending.value || leaving"
              @click="create.mutate()"
            >
              {{ t('builder.create') }}
            </button>
          </div>
        </footer>
      </section>

      <div v-if="confirming" class="absolute inset-0 flex items-end bg-black/40" @click.self="confirming = false">
        <div role="alertdialog" :aria-label="t('sheet.discardLabel')" class="w-full rounded-t-2xl bg-white p-4 pb-[calc(1rem+env(safe-area-inset-bottom))]">
          <p class="mb-1 text-center font-semibold">{{ t('sheet.discardTitle') }}</p>
          <p class="mb-4 text-center text-sm text-zinc-500">{{ t('sheet.discardBody') }}</p>
          <button class="mb-2 h-12 w-full rounded-xl bg-red-500 font-semibold text-white" @click="confirming = false; leave()">{{ t('sheet.discard') }}</button>
          <button class="h-12 w-full rounded-xl bg-zinc-100 font-semibold" @click="confirming = false">{{ t('sheet.keepEditing') }}</button>
        </div>
      </div>
    </div>
  </Teleport>
</template>

<style scoped>
.chips {
  display: flex;
  flex-wrap: wrap;
  gap: 8px;
}
.chip {
  position: relative;
  display: inline-flex;
  align-items: center;
  gap: 4px;
  padding: 8px 12px;
  border: 2px solid #e5e7eb;
  border-radius: 12px;
  background: white;
  font-size: 0.95rem;
}
.chip::after {
  content: '';
  position: absolute;
  inset: -4px 0;
}
.chip .emoji {
  font-size: 1.2rem;
  line-height: 1;
}
.chip.on {
  border-color: #667eea;
  background: #667eea;
  color: white;
}
.gtitle {
  margin: 0 0 8px;
  padding-left: 8px;
  border-left: 3px solid;
  font-size: 0.9rem;
  font-weight: 600;
}
</style>
