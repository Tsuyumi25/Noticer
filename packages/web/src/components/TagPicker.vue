<script setup lang="ts">
import { useQuery, useQueryClient } from '@tanstack/vue-query'
import type { ValueSpec } from 'server/config'
import type { ValueInput } from 'server/facts'
import type { CardTags } from 'server/tags'
import Sortable from 'sortablejs'
import { computed, nextTick, onBeforeUnmount, ref, watch } from 'vue'
import { api } from '../api.ts'
import { t } from '../i18n/index.ts'
import { PALETTE } from '../tagColors.ts'

const props = defineProps<{
  cardId: string
  editing: boolean
  modelValue: string[] | null
  /** Tags that carry a number under this card's root, with the number each one has now. */
  values?: ValueInput[]
  amounts?: Record<string, number | null>
  activeValue?: string | null
}>()
const emit = defineEmits<{ 'update:modelValue': [tags: string[]]; value: [tag: string] }>()

type TagGroup = CardTags['groups'][number]

/** Container id of the tags outside any group; never a real group name. */
const UNGROUPED = '__ungrouped__'
/** Menu container of the card's own tags, which only take a unit. */
const AUTO = '__auto__'

const queryClient = useQueryClient()
const { data } = useQuery({
  queryKey: computed(() => ['cardTags', props.cardId]),
  queryFn: async () => {
    const res = await api.cards[':cardId'].tags.$get({ param: { cardId: props.cardId } })
    if (!res.ok) throw new Error(`tags: ${res.status}`)
    return res.json()
  },
})

// Local copies so an edit shows at once; the server answer re-syncs them after each save.
const groups = ref<TagGroup[]>([])
const hidden = ref<string[]>([])
const defaults = ref<string[]>([])
const history = ref<string[]>([])
const notes = ref<Record<string, string>>({})
/** Tags typed in during this session that live in no group. */
const extra = ref<string[]>([])
const error = ref('')

watch(
  data,
  (d) => {
    if (!d) return
    groups.value = JSON.parse(JSON.stringify(d.groups)) as TagGroup[]
    hidden.value = [...d.hidden]
    defaults.value = [...d.defaults]
    history.value = [...d.ungrouped]
    notes.value = { ...d.notes }
    if (props.modelValue === null) emit('update:modelValue', [...d.defaults])
  },
  { immediate: true },
)

const selected = computed(() => new Set(props.modelValue ?? []))
const grouped = computed(() => new Set(groups.value.flatMap((g) => g.tags.map((t) => t.label))))

// Older settings also stored hidden tags as "group.label".
const isHidden = (label: string) => hidden.value.some((h) => h === label || h.endsWith(`.${label}`))
const shown = (label: string) => label !== data.value?.root && (props.editing || !isHidden(label))
/** The root the card attaches by itself; only edit mode lists it, to set what number it carries. */
const autoTags = computed(() => (data.value ? [data.value.root] : []))

const specOf = computed(() => new Map((props.values ?? []).map((v) => [v.tag, v])))
/** The number a value chip shows: what was set for a picked tag, otherwise what picking it would set. */
function amountText(label: string): string {
  const spec = specOf.value.get(label)!
  const v = selected.value.has(label) || spec.auto ? props.amounts?.[label] : spec.default
  return v === null || v === undefined ? '—' : v.toFixed(spec.decimals)
}

const visibleGroups = computed(() => groups.value.map((g) => ({ ...g, tags: g.tags.filter((t) => shown(t.label)) })))
const ungrouped = computed(() =>
  [...new Set([...history.value, ...extra.value])].filter((l) => !grouped.value.has(l) && shown(l)),
)

function labelsIn(container: string): string[] {
  if (container === UNGROUPED) return ungrouped.value
  return visibleGroups.value.find((g) => g.name === container)?.tags.map((t) => t.label) ?? []
}

// ---------- persistence ----------
async function saveGroups() {
  error.value = ''
  const root = data.value?.root
  if (!root) return
  const res = await api['tag-groups'][':root'].$put({ param: { root }, json: { groups: groups.value } })
  if (!res.ok) error.value = t('tags.saveGroupsFailed', { status: res.status })
  await queryClient.invalidateQueries({ queryKey: ['cardTags'] })
}

async function saveSettings() {
  error.value = ''
  const res = await api.cards[':cardId']['tag-settings'].$put({
    param: { cardId: props.cardId },
    json: { hiddenTags: hidden.value, defaultTags: defaults.value },
  })
  if (!res.ok) error.value = t('tags.saveSettingsFailed', { status: res.status })
  await queryClient.invalidateQueries({ queryKey: ['cardTags', props.cardId] })
}

// ---------- tag edits ----------
function takeTag(label: string): { label: string; emoji: string } {
  for (const g of groups.value) {
    const i = g.tags.findIndex((t) => t.label === label)
    if (i >= 0) return g.tags.splice(i, 1)[0]!
  }
  return { label, emoji: '' }
}

/** Places a tag in a container before the visible tag at `index`, or at the end. */
function placeTag(label: string, container: string, index?: number) {
  const tag = takeTag(label)
  if (container === UNGROUPED) {
    if (!history.value.includes(label) && !extra.value.includes(label)) extra.value.push(label)
    return
  }
  const group = groups.value.find((g) => g.name === container)!
  const before = index === undefined ? undefined : labelsIn(container).filter((l) => l !== label)[index]
  const at = before === undefined ? group.tags.length : group.tags.findIndex((t) => t.label === before)
  group.tags.splice(at, 0, tag)
}

function toggleDefault(label: string) {
  defaults.value = defaults.value.includes(label) ? defaults.value.filter((l) => l !== label) : [...defaults.value, label]
  saveSettings()
}

function toggleHidden(label: string) {
  hidden.value = isHidden(label)
    ? hidden.value.filter((h) => h !== label && !h.endsWith(`.${label}`))
    : [...hidden.value, label]
  saveSettings()
}

function moveGroup(index: number, delta: number) {
  const to = index + delta
  if (to < 0 || to >= groups.value.length) return
  const list = groups.value
  ;[list[index], list[to]] = [list[to]!, list[index]!]
  highlight(list[to]!.name)
  saveGroups()
}

const moving = ref<string | null>(null)
let movingTimer: ReturnType<typeof setTimeout> | undefined
function highlight(name: string) {
  moving.value = name
  clearTimeout(movingTimer)
  movingTimer = setTimeout(async () => {
    moving.value = null
    await nextTick()
    document.querySelector(`[data-group="${CSS.escape(name)}"]`)?.scrollIntoView({ block: 'nearest', behavior: 'smooth' })
  }, 320)
}

// ---------- picking ----------
function toggle(label: string) {
  const next = new Set(selected.value)
  if (next.has(label)) next.delete(label)
  else next.add(label)
  emit('update:modelValue', [...next])
}

let justDragged = false
function onChipClick(label: string, container: string) {
  if (justDragged) return
  if (props.editing) menu.value = { label, container }
  else toggle(label)
}

// ---------- sheets ----------
const menu = ref<{ label: string; container: string } | null>(null)
const moveTarget = ref<string | null>(null)
const prompt = ref<{ title: string; value: string; submit: (v: string) => string | undefined } | null>(null)
const promptError = ref('')

function openPrompt(title: string, value: string, submit: (v: string) => string | undefined) {
  promptError.value = ''
  prompt.value = { title, value, submit }
}

function confirmPrompt() {
  const p = prompt.value
  if (!p) return
  const value = p.value.trim()
  if (!value) return
  const problem = p.submit(value)
  if (problem) promptError.value = problem
  else prompt.value = null
}

function addGroup() {
  openPrompt(t('tags.newGroup'), '', (name) => {
    if (groups.value.some((g) => g.name === name)) return t('tags.groupExists')
    groups.value.push({ name, color: PALETTE[groups.value.length % PALETTE.length]!, tags: [] })
    saveGroups()
  })
}

function addCustom(container: string) {
  openPrompt(container === UNGROUPED ? t('tags.newTagOnce') : t('tags.newTagIn', { group: container }), '', (label) => {
    const exists = grouped.value.has(label) || history.value.includes(label) || extra.value.includes(label)
    if (!exists) {
      if (container === UNGROUPED) extra.value.push(label)
      else {
        groups.value.find((g) => g.name === container)!.tags.push({ label, emoji: '' })
        saveGroups()
      }
    }
    if (!props.editing && !selected.value.has(label)) toggle(label)
  })
}

function changeEmoji(label: string) {
  const tag = groups.value.flatMap((g) => g.tags).find((t) => t.label === label)
  if (!tag) return
  openPrompt(t('tags.emojiFor', { tag: label }), tag.emoji, (emoji) => {
    tag.emoji = emoji
    saveGroups()
  })
}

function moveTo(container: string) {
  const label = moveTarget.value
  moveTarget.value = null
  if (!label) return
  placeTag(label, container)
  saveGroups()
}

// ---------- notes ----------
const noteSheet = ref<{ tag: string; text: string } | null>(null)

async function saveNote() {
  const sheet = noteSheet.value
  if (!sheet) return
  noteSheet.value = null
  error.value = ''
  const text = sheet.text.trim()
  if (text === '') delete notes.value[sheet.tag]
  else notes.value[sheet.tag] = text
  // Every card that can show this tag shows the same note.
  const res = await api['tag-notes'][':tag'].$put({ param: { tag: sheet.tag }, json: { note: text } })
  if (!res.ok) error.value = t('tags.saveNoteFailed', { status: res.status })
  await queryClient.invalidateQueries({ queryKey: ['cardTags'] })
}

// ---------- values ----------
const unitSheet = ref<{ tag: string; unit: string; decimals: number } | null>(null)

function openUnit(tag: string) {
  const spec = specOf.value.get(tag)
  unitSheet.value = { tag, unit: spec?.unit ?? '', decimals: spec?.decimals ?? 0 }
}

async function saveValues(tag: string, spec: ValueSpec | null) {
  error.value = ''
  const root = data.value?.root
  if (!root) return
  const values: Record<string, ValueSpec> = {}
  for (const v of props.values ?? []) {
    values[v.tag] = { unit: v.unit, decimals: v.decimals, ...(v.pinned === undefined ? {} : { default: v.pinned }), ...(v.pad ? { pad: v.pad } : {}) }
  }
  if (spec) values[tag] = spec
  else delete values[tag]
  const res = await api['tag-values'][':root'].$put({ param: { root }, json: { values } })
  if (!res.ok) error.value = t('tags.saveValuesFailed', { status: res.status })
  await queryClient.invalidateQueries({ queryKey: ['cardInputs'] })
}

function confirmUnit() {
  const u = unitSheet.value
  if (!u || !u.unit.trim() || u.unit.includes(':')) return
  const kept = specOf.value.get(u.tag)
  saveValues(u.tag, {
    unit: u.unit.trim(),
    decimals: u.decimals,
    ...(kept?.pinned === undefined ? {} : { default: kept.pinned }),
    ...(kept?.pad ? { pad: kept.pad } : {}),
  })
  unitSheet.value = null
}

defineExpose({ addGroup })

const vFocus = { mounted: (el: HTMLElement) => el.focus() }

// ---------- drag (tags only; groups move with the arrows) ----------
const root = ref<HTMLElement | null>(null)
let sortables: Sortable[] = []

function destroySortables() {
  for (const s of sortables) s.destroy()
  sortables = []
}

watch(
  () => [props.editing, JSON.stringify(visibleGroups.value), ungrouped.value.join('\n')],
  async () => {
    destroySortables()
    if (!props.editing) return
    await nextTick()
    for (const el of root.value?.querySelectorAll<HTMLElement>('[data-container]') ?? []) {
      sortables.push(
        Sortable.create(el, {
          group: 'tags',
          draggable: '[data-tag]',
          animation: 150,
          delay: 400,
          delayOnTouchOnly: true,
          touchStartThreshold: 5,
          ghostClass: 'tag-ghost',
          chosenClass: 'tag-chosen',
          onEnd(e) {
            // Put the DOM back and let Vue render the new order from data.
            e.item.remove()
            e.from.insertBefore(e.item, e.from.children[e.oldIndex!] ?? null)
            justDragged = true
            setTimeout(() => (justDragged = false))
            const from = e.from.dataset.container!
            const to = e.to.dataset.container!
            const label = labelsIn(from)[e.oldDraggableIndex!]
            if (!label || (from === to && e.oldDraggableIndex === e.newDraggableIndex)) return
            placeTag(label, to, e.newDraggableIndex)
            saveGroups()
          },
        }),
      )
    }
  },
  { flush: 'post', immediate: true },
)

onBeforeUnmount(() => {
  destroySortables()
  clearTimeout(movingTimer)
})
</script>

<template>
  <div ref="root" class="picker" :class="{ editing }">
    <p v-if="error" class="mb-2 text-sm text-red-600">{{ error }}</p>
    <section v-if="editing && autoTags.length" class="group">
      <div class="ghead"><h4 class="gtitle" style="border-left-color: #9ca3af">{{ t('tags.auto') }}</h4></div>
      <div class="chips">
        <button v-for="label in autoTags" :key="label" class="chip" @click="menu = { label, container: AUTO }">
          {{ label }}<span v-if="specOf.get(label)" class="text-zinc-400">{{ specOf.get(label)!.unit }}</span>
        </button>
      </div>
    </section>
    <TransitionGroup tag="div" move-class="group-move">
      <section
        v-for="(g, gi) in visibleGroups"
        :key="g.name"
        :data-group="g.name"
        class="group"
        :class="{ moving: moving === g.name }"
      >
        <div class="ghead">
          <h4 class="gtitle" :style="{ borderLeftColor: g.color }">{{ g.name }}</h4>
          <template v-if="editing">
            <button class="gbtn" :disabled="gi === 0" :aria-label="t('tags.moveUp')" @click="moveGroup(gi, -1)">↑</button>
            <button class="gbtn" :disabled="gi === visibleGroups.length - 1" :aria-label="t('tags.moveDown')" @click="moveGroup(gi, 1)">↓</button>
          </template>
        </div>
        <div class="chips" :data-container="g.name">
          <template v-for="t in g.tags" :key="t.label">
            <span
              v-if="!editing && specOf.has(t.label)"
              class="vchip"
              :class="{ on: selected.has(t.label), active: activeValue === t.label }"
              :data-tag="t.label"
            >
              <button class="vname" @click="onChipClick(t.label, g.name)"><span v-if="t.emoji" class="emoji">{{ t.emoji }}</span>{{ t.label }}</button>
              <button class="vamount" @click="emit('value', t.label)">{{ amountText(t.label) }}</button>
            </span>
            <button
              v-else
              class="chip"
              :class="editing ? { on: defaults.includes(t.label), hid: isHidden(t.label) } : { on: selected.has(t.label) }"
              :data-tag="t.label"
              @click="onChipClick(t.label, g.name)"
            >
              <span v-if="t.emoji" class="emoji">{{ t.emoji }}</span>{{ t.label }}
            </button>
          </template>
          <button class="chip add" @click="addCustom(g.name)">{{ t('tags.custom') }}</button>
        </div>
      </section>
    </TransitionGroup>
    <section class="group">
      <div class="ghead"><h4 class="gtitle" style="border-left-color: #9ca3af">{{ t('tags.ungrouped') }}</h4></div>
      <div class="chips" :data-container="UNGROUPED">
        <template v-for="label in ungrouped" :key="label">
          <span v-if="!editing && specOf.has(label)" class="vchip" :class="{ on: selected.has(label), active: activeValue === label }" :data-tag="label">
            <button class="vname" @click="onChipClick(label, UNGROUPED)">{{ label }}</button>
            <button class="vamount" @click="emit('value', label)">{{ amountText(label) }}</button>
          </span>
          <button
            v-else
            class="chip"
            :class="editing ? { on: defaults.includes(label), hid: isHidden(label) } : { on: selected.has(label) }"
            :data-tag="label"
            @click="onChipClick(label, UNGROUPED)"
          >
            {{ label }}
          </button>
        </template>
        <button v-if="!editing" class="chip add" @click="addCustom(UNGROUPED)">{{ t('tags.custom') }}</button>
      </div>
    </section>

    <Teleport to="body">
      <div v-if="menu" class="layer" @click.self="menu = null">
        <div class="bs">
          <p class="bs-title">{{ t('common.quoted', { text: menu.label }) }}</p>
          <p v-if="notes[menu.label]" class="mb-2 text-sm whitespace-pre-line text-zinc-500">{{ notes[menu.label] }}</p>
          <template v-if="menu.container !== AUTO">
            <button class="item" @click="toggleDefault(menu.label); menu = null">{{ defaults.includes(menu.label) ? t('tags.unsetDefault') : t('tags.setDefault') }}</button>
            <button v-if="menu.container !== UNGROUPED" class="item" @click="changeEmoji(menu.label); menu = null">{{ t('tags.changeEmoji') }}</button>
            <button class="item" @click="moveTarget = menu.label; menu = null">{{ t('tags.moveTo') }}</button>
            <button class="item" @click="toggleHidden(menu.label); menu = null">{{ isHidden(menu.label) ? t('tags.unhide') : t('tags.hide') }}</button>
          </template>
          <button class="item" @click="noteSheet = { tag: menu.label, text: notes[menu.label] ?? '' }; menu = null">{{ t('tags.note') }}</button>
          <button class="item" @click="openUnit(menu.label); menu = null">
            {{ t('tags.unit') }}<span class="ml-auto text-zinc-500">{{ specOf.get(menu.label)?.unit ?? '' }}</span>
          </button>
          <button class="close" @click="menu = null">{{ t('common.cancel') }}</button>
        </div>
      </div>
      <div v-if="noteSheet" class="layer" @click.self="noteSheet = null">
        <form class="bs" @submit.prevent="saveNote">
          <p class="bs-title">{{ t('tags.noteFor', { tag: noteSheet.tag }) }}</p>
          <textarea v-model="noteSheet.text" v-focus rows="5" class="note-input" />
          <button type="submit" class="close primary">{{ t('common.ok') }}</button>
          <button type="button" class="close" @click="noteSheet = null">{{ t('common.cancel') }}</button>
        </form>
      </div>
      <div v-if="moveTarget" class="layer" @click.self="moveTarget = null">
        <div class="bs">
          <p class="bs-title">{{ t('tags.moveTitle', { tag: moveTarget }) }}</p>
          <button v-for="g in groups" :key="g.name" class="item" @click="moveTo(g.name)">
            <span class="gtitle" :style="{ borderLeftColor: g.color }">{{ g.name }}</span>
          </button>
          <button class="item" @click="moveTo(UNGROUPED)">
            <span class="gtitle" style="border-left-color: #9ca3af">{{ t('tags.ungrouped') }}</span>
          </button>
          <button class="close" @click="moveTarget = null">{{ t('common.cancel') }}</button>
        </div>
      </div>
      <div v-if="prompt" class="layer" @click.self="prompt = null">
        <form class="bs" @submit.prevent="confirmPrompt">
          <p class="bs-title">{{ prompt.title }}</p>
          <input v-model="prompt.value" v-focus class="input" />
          <p v-if="promptError" class="mt-1 text-sm text-red-600">{{ promptError }}</p>
          <button type="submit" class="close primary">{{ t('common.ok') }}</button>
          <button type="button" class="close" @click="prompt = null">{{ t('common.cancel') }}</button>
        </form>
      </div>
      <div v-if="unitSheet" class="layer" @click.self="unitSheet = null">
        <form class="bs" @submit.prevent="confirmUnit">
          <p class="bs-title">{{ t('tags.unitFor', { tag: unitSheet.tag }) }}</p>
          <input v-model="unitSheet.unit" v-focus class="input" />
          <p class="mt-3 mb-1.5 text-sm text-zinc-500">{{ t('tags.decimals') }}</p>
          <div class="seg">
            <button v-for="d in [0, 1, 2]" :key="d" type="button" :class="{ on: unitSheet.decimals === d }" @click="unitSheet.decimals = d">{{ d }}</button>
          </div>
          <button type="submit" class="close primary">{{ t('common.ok') }}</button>
          <button v-if="specOf.has(unitSheet.tag)" type="button" class="close danger" @click="saveValues(unitSheet.tag, null); unitSheet = null">{{ t('tags.noValue') }}</button>
          <button type="button" class="close" @click="unitSheet = null">{{ t('common.cancel') }}</button>
        </form>
      </div>
    </Teleport>
  </div>
</template>

<style scoped>
.group {
  position: relative;
  margin-top: 12px;
  background: white;
}
.group.moving {
  z-index: 1;
  border-radius: 10px;
  box-shadow:
    0 0 0 6px white,
    0 10px 24px 6px rgb(15 23 42 / 0.16);
}
.group-move {
  transition: transform 300ms cubic-bezier(0.2, 0.8, 0.2, 1);
}
.ghead {
  display: flex;
  align-items: center;
  gap: 4px;
  min-height: 32px;
  margin-bottom: 8px;
}
.gtitle {
  flex: 1;
  margin: 0;
  padding-left: 8px;
  border-left: 3px solid;
  font-size: 0.9rem;
  font-weight: 600;
}
.gbtn {
  position: relative;
  min-width: 36px;
  height: 36px;
  border: 1px solid #e5e7eb;
  border-radius: 8px;
  background: white;
  color: #374151;
}
.gbtn::after {
  content: '';
  position: absolute;
  inset: -4px;
}
.gbtn:disabled {
  opacity: 0.35;
}
.chips {
  display: flex;
  flex-wrap: wrap;
  gap: 8px;
  min-height: 36px;
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
  color: #374151;
  font-size: 0.9rem;
  font-weight: 500;
  user-select: none;
  -webkit-user-select: none;
  -webkit-touch-callout: none;
}
/* Stretch the touch target to 44px without changing the old look. */
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
.chip.hid {
  border-style: dashed;
  opacity: 0.5;
}
.chip.add {
  border-style: dashed;
  color: #6b7280;
}
.tag-ghost {
  opacity: 0.35;
}
.tag-chosen {
  box-shadow: 0 4px 14px rgb(0 0 0 / 0.18);
}
.layer {
  position: fixed;
  inset: 0;
  z-index: 60;
  display: flex;
  align-items: flex-end;
  background: rgb(0 0 0 / 0.4);
}
.bs {
  width: 100%;
  max-height: 80%;
  overflow-y: auto;
  padding: 12px 16px calc(12px + env(safe-area-inset-bottom));
  border-radius: 16px 16px 0 0;
  background: white;
}
.bs-title {
  margin-bottom: 8px;
  font-weight: 600;
}
.item {
  display: flex;
  align-items: center;
  width: 100%;
  min-height: 48px;
  border-bottom: 1px solid #f1f5f9;
  font-size: 16px;
  text-align: left;
}
.close {
  width: 100%;
  height: 48px;
  margin-top: 8px;
  border-radius: 12px;
  background: #f4f4f5;
  font-size: 16px;
  font-weight: 600;
}
.close.primary {
  background: #4f46e5;
  color: white;
}
.close.danger {
  color: #dc2626;
}
.vchip {
  display: inline-flex;
  align-items: stretch;
  border: 2px solid #e5e7eb;
  border-radius: 12px;
  background: white;
  color: #374151;
  font-size: 0.9rem;
  font-weight: 500;
  overflow: hidden;
}
.vchip .vname {
  position: relative;
  display: inline-flex;
  align-items: center;
  gap: 4px;
  padding: 8px 10px 8px 12px;
}
.vchip .vamount {
  position: relative;
  min-width: 44px;
  padding: 8px 10px;
  border-left: 1px solid #e5e7eb;
  background: #f8fafc;
  color: #a1a1aa;
  font-variant-numeric: tabular-nums;
}
.vchip .vname::after,
.vchip .vamount::after {
  content: '';
  position: absolute;
  inset: -4px 0;
}
.vchip.on {
  border-color: #667eea;
  background: #667eea;
  color: white;
}
.vchip.on .vamount {
  border-left-color: rgb(255 255 255 / 0.35);
  background: #5a67d8;
  color: white;
  font-weight: 700;
}
.vchip.active {
  outline: 2px solid #312e81;
  outline-offset: 1px;
}
.vchip .emoji {
  font-size: 1.2rem;
  line-height: 1;
}
.seg {
  display: grid;
  grid-auto-columns: 1fr;
  grid-auto-flow: column;
  gap: 8px;
}
.seg button {
  height: 44px;
  border: 1px solid #e5e7eb;
  border-radius: 10px;
}
.seg button.on {
  border-color: #818cf8;
  background: #eef2ff;
  color: #3730a3;
  font-weight: 600;
}
.note-input {
  width: 100%;
  padding: 10px 12px;
  border: 1px solid #d4d4d8;
  border-radius: 10px;
  font-size: 16px;
  resize: none;
}
.input {
  width: 100%;
  height: 44px;
  padding: 0 12px;
  border: 1px solid #d4d4d8;
  border-radius: 10px;
  font-size: 16px;
}
</style>
