import type { QueryParam } from '@shared/types'
import { validateParam } from './validateParams'

/**
 * Replace every known {{name}} occurrence in `sql` with its type-rendered value.
 * Returns { error } (naming the offending param) on the first missing-value /
 * invalid-number / invalid-boolean failure. Unknown {{...}} tokens (no matching
 * param — e.g. ones that live inside a comment and were never surfaced as inputs)
 * are left verbatim.
 */
export function substituteParams(
  sql: string,
  params: QueryParam[],
): { sql: string } | { error: string } {
  const byName = new Map(params.map((p) => [p.name, p]))
  let error: string | null = null
  const out = sql.replace(/\{\{\s*([A-Za-z_][A-Za-z0-9_]*)\s*\}\}/g, (whole, name: string) => {
    const param = byName.get(name)
    if (!param) return whole // unknown token — leave as-is
    const rendered = renderValue(param)
    if ('error' in rendered) {
      error ??= rendered.error
      return whole
    }
    return rendered.value
  })
  if (error) return { error }
  return { sql: out }
}

function renderValue(p: QueryParam): { value: string } | { error: string } {
  const error = validateParam(p)
  if (error) return { error }
  if (p.type === 'raw') return { value: p.value }
  switch (p.type) {
    case 'text':
      return { value: `'${p.value.replace(/'/g, "''")}'` }
    case 'number':
      return { value: p.value.trim() }
    case 'boolean':
      return { value: p.value.trim().toLowerCase() }
  }
  return { value: '' } // unreachable; satisfies the type checker
}
