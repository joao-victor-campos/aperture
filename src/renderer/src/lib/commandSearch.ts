/**
 * Pure ranking helper for the ⌘K command palette.
 *
 * A `CommandItem` is the union of "things that can be selected": a table from
 * the catalog, a saved query, a history entry, a connection to switch to,
 * or a static action. The palette component flattens everything into a single
 * list, calls `rankCommands(items, query)`, and renders the result grouped by
 * `kind`.
 *
 * Ranking is intentionally simple: case-insensitive substring match on
 * `searchText`, with prefix matches scoring higher than mid-string matches.
 * Stable sort preserves the input order within ties — which lets the palette
 * pre-sort each category (e.g. recent-first for history) and have that order
 * survive.
 */

export type CommandKind = 'table' | 'saved' | 'history' | 'connection' | 'action'

export type CommandIcon = 'table' | 'bookmark' | 'clock' | 'plug' | 'play' | 'settings' | 'plus' | 'wand'

export interface CommandItem {
  id: string
  kind: CommandKind
  label: string
  sublabel?: string
  /** Lowercased haystack used for ranking. May include label + sublabel + aliases. */
  searchText: string
  action: () => void
  icon?: CommandIcon
}

/**
 * Returns matching items, ordered by match quality.
 * Empty / whitespace query returns the items unchanged (preserves input order).
 */
export function rankCommands(items: CommandItem[], query: string): CommandItem[] {
  const q = query.trim().toLowerCase()
  if (q.length === 0) return items

  type Scored = { item: CommandItem; score: number; idx: number }
  const scored: Scored[] = []

  for (let i = 0; i < items.length; i++) {
    const item = items[i]
    const pos = item.searchText.indexOf(q)
    if (pos === -1) continue
    // Negative score: prefix matches (pos=0) score highest. Tie-break by index for stable sort.
    scored.push({ item, score: -pos, idx: i })
  }

  scored.sort((a, b) => {
    if (a.score !== b.score) return b.score - a.score
    return a.idx - b.idx
  })

  return scored.map((s) => s.item)
}

/** Group ranked items by kind, preserving order within each group. */
export function groupByKind(items: CommandItem[]): Record<CommandKind, CommandItem[]> {
  const out: Record<CommandKind, CommandItem[]> = {
    table: [],
    saved: [],
    history: [],
    connection: [],
    action: [],
  }
  for (const item of items) out[item.kind].push(item)
  return out
}
