import type { CardConfig, Config, FactInput } from './config.ts'
import type { DB } from './db.ts'

export type FactRow = { k: string; type: 'integer' | 'real' | 'text'; value: number | string }

export type CardInput = FactInput & { key: string; last: number | string | null }

export function cardInputs(db: DB, config: Config, card: CardConfig): CardInput[] {
  const last = db.prepare<[string], { value: number | string }>(
    `SELECT f.value FROM checkin_facts f JOIN events e ON e.id = f.checkin_id
     WHERE f.k = ? ORDER BY e.event_at DESC, e.id DESC LIMIT 1`,
  )
  return (card.facts ?? []).map((key) => ({ ...config.factInputs[key]!, key, last: last.get(key)?.value ?? null }))
}

export type FactsResult = { ok: true; rows: FactRow[] } | { ok: false; status: 400 | 422; error: string }

export function readFacts(config: Config, card: CardConfig, given: Record<string, number | string>): FactsResult {
  const keys = card.facts ?? []
  const unknown = Object.keys(given).find((k) => !keys.includes(k))
  if (unknown !== undefined) return { ok: false, status: 400, error: `card ${card.id} has no fact ${unknown}` }

  const rows: FactRow[] = []
  for (const k of keys) {
    const input = config.factInputs[k]!
    const value = given[k]
    if (value === undefined) {
      if (input.required) return { ok: false, status: 422, error: `${k} is required` }
      continue
    }
    if (input.kind === 'number') {
      const fits =
        typeof value === 'number' &&
        value >= input.min &&
        value <= input.max &&
        Number(value.toFixed(input.decimals)) === value
      if (!fits) return { ok: false, status: 400, error: `${k} must be a number in ${input.min}–${input.max} with at most ${input.decimals} decimals` }
      rows.push({ k, type: input.decimals === 0 ? 'integer' : 'real', value })
    } else {
      if (!input.options.some((o) => o.value === value)) return { ok: false, status: 400, error: `${k} is not one of its options` }
      rows.push({ k, type: 'text', value })
    }
  }
  return { ok: true, rows }
}
