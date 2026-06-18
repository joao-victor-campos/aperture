// Shared collator: case-insensitive, locale-aware, natural numeric ordering.
const collator = new Intl.Collator(undefined, { sensitivity: 'base', numeric: true })

/**
 * Comparator for `Array.prototype.sort` over any `{ name: string }` shape
 * (Dataset, Table, …). Sorts alphabetically, case-insensitively, with
 * natural numeric ordering (`t2` before `t10`).
 */
export function byName<T extends { name: string }>(a: T, b: T): number {
  return collator.compare(a.name, b.name)
}
