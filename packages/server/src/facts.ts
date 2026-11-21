import type { CardConfig, Config, FactInput, ValueSpec } from './config.ts'
import type { DB } from './db.ts'
import { parseValueKey, valueKey } from './values.ts'

export type FactRow = { k: string; type: 'integer' | 'real' | 'text'; value: number | string }

export type ChoiceInput = FactInput & { key: string }

export type ValueInput = Omit<ValueSpec, 'default'> & {
  tag: string
  /** Attached by the card itself, so it is in every event the sheet makes. */
  auto: boolean
  /** The default the settings fix, if any. */
  pinned?: number
  /** What the sheet puts in: the pinned default, else the latest value for `latest`, else the most frequent one. */
  default: number | null
  /** Values worth one tap: this tag's own frequent ones first, then other tags' in the same unit. */
  candidates: number[]
  /**
   * Only for the card's own tags, which are in the event from the start: open the keypad at once
   * when the default went out unchanged less often than it was changed.
   */
  open: boolean
}

export interface CardInputs {
  values: ValueInput[]
  choices: ChoiceInput[]
}

const RECENT = 200
const SETTLED = 30

function byCount(values: number[]): number[] {
  const counts = new Map<number, number>()
  for (const v of values) counts.set(v, (counts.get(v) ?? 0) + 1)
  return [...counts.entries()].sort((a, b) => b[1] - a[1]).map(([v]) => v)
}

/** How often the default would have gone out unchanged: the previous value for `latest`, the fixed default for `sum`. */
function keptShare(spec: ValueSpec, own: number[], fallback: number | null): number {
  const recent = own.slice(0, SETTLED)
  if (spec.keep === 'latest') {
    const pairs = recent.slice(0, -1).map((v, i) => v === recent[i + 1])
    return pairs.length ? pairs.filter(Boolean).length / pairs.length : 0
  }
  return recent.length ? recent.filter((v) => v === fallback).length / recent.length : 0
}

export function cardInputs(db: DB, config: Config, card: CardConfig): CardInputs {
  const root = card.root
  const specs = Object.entries(config.tagGroups[root]?.values ?? {})
  const rows = db
    .prepare<[string], { k: string; value: number }>(
      `SELECT f.k, f.value FROM checkin_facts f JOIN events e ON e.id = f.checkin_id
       WHERE EXISTS (SELECT 1 FROM checkin_tags ct JOIN tags_dict t ON t.id = ct.tag_id WHERE ct.checkin_id = e.id AND t.name = ?)
       ORDER BY e.event_at DESC, e.id DESC`,
    )
    .all(root)
  const recent = new Map<string, number[]>()
  for (const r of rows) {
    if (typeof r.value !== 'number' || !parseValueKey(r.k)) continue
    const list = recent.get(r.k) ?? []
    if (list.length < RECENT) list.push(r.value)
    recent.set(r.k, list)
  }

  const values = specs.map(([tag, spec]): ValueInput => {
    const own = recent.get(valueKey(tag, spec.unit)) ?? []
    const pool = specs.filter(([t, s]) => t !== tag && s.unit === spec.unit).flatMap(([t, s]) => recent.get(valueKey(t, s.unit)) ?? [])
    const frequent = byCount(own)
    const fallback = spec.default ?? (spec.keep === 'latest' ? (own[0] ?? null) : (frequent[0] ?? byCount(pool)[0] ?? null))
    const candidates = spec.keep === 'latest' ? [] : [...new Set([...frequent.slice(0, 4), ...byCount(pool)])].slice(0, 4)
    const { default: pinned, ...rest } = spec
    return {
      ...rest,
      ...(pinned === undefined ? {} : { pinned }),
      tag,
      auto: tag === root,
      default: fallback,
      candidates,
      open: tag === root && (own.length === 0 || keptShare(spec, own, fallback) < 0.5),
    }
  })
  const choices = (card.facts ?? []).map((key) => ({ ...config.factInputs[key]!, key }))
  return { values, choices }
}

export type FactsResult = { ok: true; rows: FactRow[] } | { ok: false; status: 400 | 422; error: string }

/** Values come as `tag:unit` keys for tags in the event; choices under the card's fact keys. */
export function readFacts(config: Config, card: CardConfig, given: Record<string, number | string>, tags: string[]): FactsResult {
  const specs = config.tagGroups[card.root]?.values ?? {}
  const choices = card.facts ?? []
  const rows: FactRow[] = []
  for (const [k, value] of Object.entries(given)) {
    if (choices.includes(k)) continue
    const key = parseValueKey(k)
    const spec = key ? specs[key.tag] : undefined
    if (!key || !spec || spec.unit !== key.unit) return { ok: false, status: 400, error: `card ${card.id} takes no value ${k}` }
    if (!tags.includes(key.tag)) return { ok: false, status: 400, error: `${k} belongs to a tag this event does not carry` }
    const fits = typeof value === 'number' && value >= 0 && Number(value.toFixed(spec.decimals)) === value
    if (!fits) return { ok: false, status: 400, error: `${k} must be a non-negative number with at most ${spec.decimals} decimals` }
    rows.push({ k, type: spec.decimals === 0 ? 'integer' : 'real', value })
  }
  for (const k of choices) {
    const input = config.factInputs[k]!
    const value = given[k]
    if (value === undefined) {
      if (input.required) return { ok: false, status: 422, error: `${k} is required` }
      continue
    }
    if (!input.options.some((o) => o.value === value)) return { ok: false, status: 400, error: `${k} is not one of its options` }
    rows.push({ k, type: 'text', value })
  }
  return { ok: true, rows }
}
