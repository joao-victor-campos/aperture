import { extractTableRefs } from './extractTableRefs'

/**
 * Build a compact, prompt-friendly schema string for the tables referenced in
 * `sql`, using the editor's table→columns map. Returns '' when nothing matches.
 * Each line looks like `orders(id, total, user_id)`.
 */
export function inlineSchemaContext(
  sql: string,
  schema: Record<string, string[]>,
  maxTables = 6
): string {
  const lines: string[] = []
  const seen = new Set<string>()
  for (const ref of extractTableRefs(sql)) {
    if (lines.length >= maxTables) break
    // sqlSchema is keyed by both `dataset.table` and bare `table`.
    const cols = schema[ref.name] ?? schema[ref.name.split('.').pop() ?? ref.name]
    if (!cols || cols.length === 0) continue
    if (seen.has(ref.name)) continue
    seen.add(ref.name)
    lines.push(`${ref.name}(${cols.join(', ')})`)
  }
  return lines.join('\n')
}
