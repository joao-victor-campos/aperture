/**
 * Pure page-slice helper. Returns the rows for a zero-based page index at the
 * given page size. Out-of-range pages return an empty array.
 */
export function paginate<T>(rows: T[], page: number, pageSize: number): T[] {
  const start = page * pageSize
  return rows.slice(start, start + pageSize)
}
