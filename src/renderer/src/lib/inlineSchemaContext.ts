import { extractTableRefs } from './extractTableRefs'

/**
 * Build a compact, prompt-friendly context string from the editor's
 * table→columns map (`sqlSchema`, keyed by both `dataset.table` and bare
 * `table`). Includes two parts (either may be empty):
 *   - "Available tables: …" — the catalog tables the user has browsed, so the
 *     model can suggest real table names (e.g. right after FROM).
 *   - "orders(id, total)" lines — columns of the tables referenced in `sql`.
 * Returns '' when the schema map is empty.
 */
export function inlineSchemaContext(
  sql: string,
  schema: Record<string, string[]>,
  maxRefTables = 6,
  maxCatalogTables = 40
): string {
  const parts: string[] = []

  // Available catalog tables — only the fully-qualified (dotted) keys, so each
  // table appears once (the map also stores a bare-name alias).
  const tables = Object.keys(schema).filter((k) => k.includes('.'))
  if (tables.length > 0) {
    parts.push(`Available tables: ${tables.slice(0, maxCatalogTables).join(', ')}`)
  }

  // Columns of referenced tables.
  const seen = new Set<string>()
  let refCount = 0
  for (const ref of extractTableRefs(sql)) {
    if (refCount >= maxRefTables) break
    const cols = schema[ref.name] ?? schema[ref.name.split('.').pop() ?? ref.name]
    if (!cols || cols.length === 0) continue
    if (seen.has(ref.name)) continue
    seen.add(ref.name)
    parts.push(`${ref.name}(${cols.join(', ')})`)
    refCount++
  }

  return parts.join('\n')
}
