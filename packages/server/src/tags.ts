import type { CardConfig, Config, TagGroup } from './config.ts'
import type { DB } from './db.ts'

/** Cards with a bucket share their parent's tag groups; the rest own the groups under their own tag. */
export function cardRoot(card: Pick<CardConfig, 'tag' | 'bucket'>): string {
  return card.bucket ?? card.tag
}

/** A tag's option list: the groups pinned on it and every other tag that has appeared with it, most used first. */
export interface RootTags {
  groups: TagGroup[]
  ungrouped: string[]
}

export function rootTags(db: DB, config: Config, root: string, exclude: string[] = []): RootTags {
  const groups = config.tagGroups[root]?.groups ?? []
  const known = new Set([root, ...exclude, ...groups.flatMap((g) => g.tags.map((t) => t.label))])
  const used = db
    .prepare<[string], { name: string }>(
      `SELECT t.name FROM checkin_tags ct JOIN tags_dict t ON t.id = ct.tag_id
       WHERE ct.checkin_id IN (
         SELECT r.checkin_id FROM checkin_tags r JOIN tags_dict rt ON rt.id = r.tag_id WHERE rt.name = ?
       )
       GROUP BY t.name ORDER BY COUNT(*) DESC, t.name`,
    )
    .all(root)
  return { groups, ungrouped: used.map((r) => r.name).filter((name) => !known.has(name)) }
}

/** Every tag ever recorded, most used first. */
export function allTags(db: DB): string[] {
  return db
    .prepare<[], { name: string }>(
      `SELECT t.name FROM tags_dict t JOIN checkin_tags ct ON ct.tag_id = t.id GROUP BY t.id ORDER BY COUNT(*) DESC, t.name`,
    )
    .all()
    .map((r) => r.name)
}

export interface CardTags extends RootTags {
  root: string
  /** Attached on submit without being picked: the card's tag and its bucket. */
  auto: string[]
  hidden: string[]
  defaults: string[]
}

export function cardTags(db: DB, config: Config, card: CardConfig): CardTags {
  const root = cardRoot(card)
  const auto = [...new Set([card.tag, ...(card.bucket ? [card.bucket] : [])])]
  return { root, auto, ...rootTags(db, config, root, auto), hidden: card.hiddenTags ?? [], defaults: card.defaultTags ?? [] }
}
