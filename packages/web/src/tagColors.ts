import type { CardConfig, Config } from 'server/config'

export const PALETTE = ['#3b82f6', '#f59e0b', '#10b981', '#8b5cf6', '#ec4899', '#ef4444', '#14b8a6', '#84cc16']

/** The colour of the group each tag sits in; a tag grouped under two roots takes the first. */
export function tagColors(config: Pick<Config, 'tagGroups'>): Map<string, string> {
  const colors = new Map<string, string>()
  for (const root of Object.values(config.tagGroups)) {
    for (const group of root.groups) for (const tag of group.tags) if (!colors.has(tag.label)) colors.set(tag.label, group.color)
  }
  return colors
}

/** A card's colour: its root's first group, otherwise a palette colour fixed by the card id. */
export function cardColor(config: Pick<Config, 'tagGroups'>, card: CardConfig): string {
  const first = config.tagGroups[card.bucket ?? card.tag]?.groups[0]?.color
  if (first) return first
  let hash = 0
  for (const ch of card.id) hash = (hash * 31 + ch.charCodeAt(0)) >>> 0
  return PALETTE[hash % PALETTE.length]!
}
