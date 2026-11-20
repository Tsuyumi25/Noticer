/** A tag's value is stored under `tag:unit`, so a record keeps its unit even after the tag's settings change. */
export const valueKey = (tag: string, unit: string) => `${tag}:${unit}`

export function parseValueKey(key: string): { tag: string; unit: string } | null {
  const at = key.lastIndexOf(':')
  return at > 0 && at < key.length - 1 ? { tag: key.slice(0, at), unit: key.slice(at + 1) } : null
}

/** The numbers an event carries in `unit`, in key order. */
export function valuesIn(facts: Record<string, unknown>, unit: string): number[] {
  return Object.entries(facts).flatMap(([k, v]) => (typeof v === 'number' && parseValueKey(k)?.unit === unit ? [v] : []))
}
