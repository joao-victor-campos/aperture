import type { HistoryEntry } from '@shared/types'

/**
 * Case-insensitive substring filter over a history entry's SQL body and
 * connection name. An empty or whitespace-only query returns the input
 * unchanged.
 */
export function filterHistory(entries: HistoryEntry[], query: string): HistoryEntry[] {
  const q = query.trim().toLowerCase()
  if (!q) return entries
  return entries.filter(
    (e) =>
      e.sql.toLowerCase().includes(q) ||
      e.connectionName.toLowerCase().includes(q),
  )
}
