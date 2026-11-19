import type { Block, Filter, Find, Match } from 'server/config'

export const opposite = (m: Match): Match => (m === 'all' ? 'any' : 'all')

/** A row inside a find: which block, which layer of it, which row of that layer. */
export interface RowPath {
  block: number
  layer: number
  row: number
}

/** Where a new row goes: its own block, beside a row in that row's layer, or a new layer under a block. */
export type Place = { kind: 'block' } | { kind: 'layer'; block: number; layer: number } | { kind: 'deeper'; block: number }

export const rowAt = (find: Find, at: RowPath): Filter => find.blocks[at.block]!.layers[at.layer]![at.row]!

export function placeRow(find: Find, place: Place, row: Filter): RowPath {
  if (place.kind === 'block') {
    find.blocks.push({ ops: [opposite(find.match)], layers: [[row]] })
    return { block: find.blocks.length - 1, layer: 0, row: 0 }
  }
  const block = find.blocks[place.block]!
  if (place.kind === 'layer') {
    block.layers[place.layer]!.push(row)
    return { block: place.block, layer: place.layer, row: block.layers[place.layer]!.length - 1 }
  }
  block.layers.push([row])
  const k = block.layers.length - 1
  // Choosing the same connector as the layer above would just flatten the two; a lone first row has none to differ from.
  const loneFirst = k === 1 && block.layers[0]!.length === 1
  block.ops.push(loneFirst && find.blocks.length > 1 ? opposite(find.match) : opposite(block.ops[k - 1]!))
  return { block: place.block, layer: k, row: 0 }
}

export function removeRow(find: Find, at: RowPath) {
  const block = find.blocks[at.block]!
  block.layers[at.layer]!.splice(at.row, 1)
  if (block.layers[at.layer]!.length === 0) {
    block.layers.splice(at.layer, 1)
    block.ops.splice(at.layer, 1)
  }
  if (block.layers.length === 0) find.blocks.splice(at.block, 1)
}

export const canDeepen = (find: Find, at: RowPath) => {
  const block = find.blocks[at.block]!
  return at.layer === block.layers.length - 1 && block.layers.length < 3
}

/** What a connector token switches: the blocks' join, or one layer of one block. */
export type Joint = { kind: 'root' } | { kind: 'layer'; block: number; layer: number }

export function flip(find: Find, joint: Joint) {
  if (joint.kind === 'root') find.match = opposite(find.match)
  else {
    const ops = find.blocks[joint.block]!.ops
    ops[joint.layer] = opposite(ops[joint.layer]!)
  }
}

/** A group of siblings: they share one connector, one color, and one line down from their parent. */
export interface Group {
  match: Match
  joint: Joint
  /** Nesting level of the siblings, which picks their color. */
  level: number
  /** Index of the entry the line hangs from; none for the outermost group. */
  from: number | null
  members: number[]
}

export interface Entry {
  depth: number
  group: Group
  /** Set on a condition; a group row has none. */
  at?: RowPath
  row?: Filter
}

/**
 * The find as rows top to bottom. A block reads as a tree: its last layer joins [everything above, its own rows];
 * a layer whose only member would be the single first row shows that row directly.
 */
export function outline(find: Find): { entries: Entry[]; groups: Group[] } {
  const entries: Entry[] = []
  const groups: Group[] = []
  const add = (entry: Entry) => {
    entry.group.members.push(entries.length)
    entries.push(entry)
  }
  const group = (match: Match, joint: Joint, level: number, from: number | null): Group => {
    const g: Group = { match, joint, level, from, members: [] }
    groups.push(g)
    return g
  }
  function members(b: Block, bi: number, k: number, parent: Group, depth: number) {
    if (k > 0) {
      if (k === 1 && b.layers[0]!.length === 1) add({ depth, group: parent, at: { block: bi, layer: 0, row: 0 }, row: b.layers[0]![0]! })
      else {
        const inner = group(b.ops[k - 1]!, { kind: 'layer', block: bi, layer: k - 1 }, depth + 1, entries.length)
        add({ depth, group: parent })
        members(b, bi, k - 1, inner, depth + 1)
      }
    }
    b.layers[k]!.forEach((row, ri) => add({ depth, group: parent, at: { block: bi, layer: k, row: ri }, row }))
  }

  if (find.blocks.length === 1) {
    const b = find.blocks[0]!
    const k = b.layers.length - 1
    members(b, 0, k, group(b.ops[k]!, { kind: 'layer', block: 0, layer: k }, 0, null), 0)
  } else {
    const top = group(find.match, { kind: 'root' }, 0, null)
    find.blocks.forEach((b, bi) => {
      const k = b.layers.length - 1
      if (k === 0 && b.layers[0]!.length === 1) return add({ depth: 0, group: top, at: { block: bi, layer: 0, row: 0 }, row: b.layers[0]![0]! })
      const inner = group(b.ops[k]!, { kind: 'layer', block: bi, layer: k }, 1, entries.length)
      add({ depth: 0, group: top })
      members(b, bi, k, inner, 1)
    })
  }
  return { entries, groups }
}
