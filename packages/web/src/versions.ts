import type { EventVersion } from 'server/events'
import type { SheetEvent } from './components/CheckinSheet.vue'
import { absoluteTime } from './time.ts'

export type ConflictEvent = SheetEvent & { cardId: string; versions: EventVersion[] }

interface VersionTab {
  label: string
  deleted: boolean
}

export interface VersionPick {
  tabs: VersionTab[]
  current: number
}

export function versionPick(event: ConflictEvent, current: number, now = Date.now()): VersionPick | undefined {
  if (event.versions.length === 0) return undefined
  return { tabs: event.versions.map((v) => ({ label: `${v.device} · ${absoluteTime(v.editedAt * 1000, now)}`, deleted: v.deleted })), current }
}

export const pickedDeleted = (pick: VersionPick | undefined) => pick?.tabs[pick.current]?.deleted ?? false

export function asVersion(event: ConflictEvent, index: number): SheetEvent {
  const v = event.versions[index]
  if (!v || v.deleted) return event
  return { ...event, eventAt: v.eventAt ?? event.eventAt, note: v.note, tags: v.tags, facts: v.facts }
}
