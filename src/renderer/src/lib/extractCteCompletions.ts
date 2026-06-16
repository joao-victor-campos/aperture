export interface CteDef {
  name: string
  columns: string[]
}

export interface CteOption {
  label: string
  type: string
}

/** Find the matching close paren index for an open paren at `open`. */
function matchParen(s: string, open: number): number {
  let depth = 0
  for (let i = open; i < s.length; i++) {
    if (s[i] === '(') depth++
    else if (s[i] === ')') {
      depth--
      if (depth === 0) return i
    }
  }
  return -1
}

/** Split a select list on top-level commas (depth 0). */
function splitTopLevel(list: string): string[] {
  const parts: string[] = []
  let depth = 0
  let start = 0
  for (let i = 0; i < list.length; i++) {
    const c = list[i]
    if (c === '(') depth++
    else if (c === ')') depth--
    else if (c === ',' && depth === 0) {
      parts.push(list.slice(start, i))
      start = i + 1
    }
  }
  parts.push(list.slice(start))
  return parts.map((p) => p.trim()).filter(Boolean)
}

/** Derive an output column name from a select-list item, or null if not derivable. */
function columnNameFromItem(item: string): string | null {
  const asMatch = /\bas\s+([A-Za-z_][A-Za-z0-9_]*)\s*$/i.exec(item)
  if (asMatch) return asMatch[1]
  const tail = /([A-Za-z_][A-Za-z0-9_]*)\s*$/.exec(item)
  if (!tail) return null
  return tail[1]
}

/**
 * Parse top-level CTEs from a `WITH name AS ( SELECT … ) [, name2 AS (…)]` clause.
 * Best-effort: top-level CTE list only (no nested/recursive scoping). Never throws.
 */
export function extractCteCompletions(sql: string): CteDef[] {
  const withIdx = /\bwith\b/i.exec(sql)
  if (!withIdx) return []
  const defs: CteDef[] = []
  let cursor = withIdx.index + withIdx[0].length

  const nameRe = /\s*([A-Za-z_][A-Za-z0-9_]*)\s+as\s*\(/iy
  while (cursor < sql.length) {
    nameRe.lastIndex = cursor
    const m = nameRe.exec(sql)
    if (!m) break
    const name = m[1]
    const open = nameRe.lastIndex - 1
    const close = matchParen(sql, open)
    if (close === -1) break
    const body = sql.slice(open + 1, close)

    let columns: string[] = []
    const selMatch = /\bselect\b/i.exec(body)
    if (selMatch) {
      const afterSelect = body.slice(selMatch.index + selMatch[0].length)
      const fromMatch = /\bfrom\b/i.exec(afterSelect)
      const listText = fromMatch ? afterSelect.slice(0, fromMatch.index) : afterSelect
      if (!/^\s*\*\s*$/.test(listText)) {
        columns = splitTopLevel(listText)
          .map(columnNameFromItem)
          .filter((c): c is string => c !== null)
      }
    }
    defs.push({ name, columns })

    cursor = close + 1
    const comma = /^\s*,/.exec(sql.slice(cursor))
    if (!comma) break
    cursor += comma[0].length
  }
  return defs
}

/**
 * Given the document and the text immediately before the cursor, return CTE-based
 * completion options: a CTE's columns when `textBefore` ends with `cteName.`,
 * otherwise the CTE names (offered where a table is expected).
 */
export function cteCompletionOptions(sql: string, textBefore: string): CteOption[] {
  const defs = extractCteCompletions(sql)
  if (defs.length === 0) return []

  const dotMatch = /([A-Za-z_][A-Za-z0-9_]*)\.\s*[A-Za-z0-9_]*$/.exec(textBefore)
  if (dotMatch) {
    const cte = defs.find((d) => d.name.toLowerCase() === dotMatch[1].toLowerCase())
    if (!cte) return []
    return cte.columns.map((c) => ({ label: c, type: 'property' }))
  }
  return defs.map((d) => ({ label: d.name, type: 'class' }))
}
