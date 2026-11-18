import type { CardConfig, Config, TagGroup } from './config.ts'
import type { DB } from './db.ts'

/** Cards with a bucket share their parent's tag groups; the rest own the groups under their own tag. */
export function cardRoot(card: CardConfig): string {
  return card.bucket ?? card.tag
}

export interface CardTags {
  root: string
  /** Attached on submit without being picked: the card's tag and its bucket. */
  auto: string[]
  groups: TagGroup[]
  hidden: string[]
  defaults: string[]
  /** Tags used alongside the root before but not placed in any group, most used first. */
  ungrouped: string[]
}

export function cardTags(db: DB, config: Config, card: CardConfig): CardTags {
  const root = cardRoot(card)
  const groups = config.tagGroups[root]?.groups ?? []
  const auto = [...new Set([card.tag, ...(card.bucket ? [card.bucket] : [])])]
  const known = new Set([root, ...auto, ...groups.flatMap((g) => g.tags.map((t) => t.label))])
  const used = db
    .prepare<[string], { name: string }>(
      `SELECT t.name FROM checkin_tags ct JOIN tags_dict t ON t.id = ct.tag_id
       WHERE ct.checkin_id IN (
         SELECT r.checkin_id FROM checkin_tags r JOIN tags_dict rt ON rt.id = r.tag_id WHERE rt.name = ?
       )
       GROUP BY t.name ORDER BY COUNT(*) DESC, t.name`,
    )
    .all(root)
  return {
    root,
    auto,
    groups,
    hidden: card.hiddenTags ?? [],
    defaults: card.defaultTags ?? [],
    ungrouped: used.map((r) => r.name).filter((name) => !known.has(name)),
  }
}
