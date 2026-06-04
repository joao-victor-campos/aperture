/**
 * Pure helper: filter and sort a flat array of result rows.
 *
 * Filtering: each non-empty `filters` entry is a case-insensitive substring
 *            match against the string representation of the cell value.
 *            All active filters are ANDed together.
 *
 * Sorting:   `sortCol` names the column; `sortDir` is 'asc' or 'desc'.
 *            NULL / undefined values always sort last regardless of direction.
 */
export function filterSortRows(
  rows: Record<string, unknown>[],
  filters: Record<string, string>,
  sortCol: string | null,
  sortDir: 'asc' | 'desc'
): Record<string, unknown>[] {
  // ── Filter ──────────────────────────────────────────────────────────────────
  const activeFilters = Object.entries(filters).filter(([, v]) => v.trim() !== '')
  let result = rows
  if (activeFilters.length > 0) {
    result = rows.filter((row) =>
      activeFilters.every(([col, query]) => {
        const cell = row[col]
        if (cell === null || cell === undefined) return false
        return String(cell).toLowerCase().includes(query.trim().toLowerCase())
      })
    )
  }

  // ── Sort ────────────────────────────────────────────────────────────────────
  if (sortCol !== null) {
    result = [...result].sort((a, b) => {
      const av = a[sortCol]
      const bv = b[sortCol]
      // NULLs always last
      if (av === null || av === undefined) return 1
      if (bv === null || bv === undefined) return -1

      let cmp: number
      if (typeof av === 'number' && typeof bv === 'number') {
        cmp = av - bv
      } else {
        cmp = String(av).localeCompare(String(bv), undefined, { sensitivity: 'base', numeric: true })
      }
      return sortDir === 'asc' ? cmp : -cmp
    })
  }

  return result
}
