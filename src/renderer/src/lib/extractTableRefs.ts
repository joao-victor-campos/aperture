export interface TableRef {
  name: string
  alias?: string
}

// Keywords that may immediately follow a table name and must NOT be read as an alias.
const ALIAS_STOPWORDS = new Set([
  'ON', 'USING', 'WHERE', 'GROUP', 'ORDER', 'LIMIT', 'HAVING', 'JOIN', 'LEFT', 'RIGHT',
  'INNER', 'OUTER', 'FULL', 'CROSS', 'UNION', 'SET', 'VALUES', 'SELECT', 'WITH', 'AND',
  'OR', 'AS', 'OFFSET', 'WINDOW', 'QUALIFY', 'INTO',
])

/**
 * Strip line/block comments and single/double/backtick-quoted strings, replacing
 * each with a space so token boundaries are preserved.
 */
function stripNoise(sql: string): string {
  let out = ''
  let i = 0
  while (i < sql.length) {
    const c = sql[i]
    if (c === '-' && sql[i + 1] === '-') {
      const end = sql.indexOf('\n', i)
      i = end === -1 ? sql.length : end
      out += ' '
      continue
    }
    if (c === '/' && sql[i + 1] === '*') {
      const end = sql.indexOf('*/', i + 2)
      i = end === -1 ? sql.length : end + 2
      out += ' '
      continue
    }
    if (c === "'" || c === '"' || c === '`') {
      const quote = c
      i++
      while (i < sql.length) {
        if (sql[i] === quote && sql[i + 1] === quote) { i += 2; continue }
        if (sql[i] === quote) { i++; break }
        i++
      }
      out += ' '
      continue
    }
    out += c
    i++
  }
  return out
}

/**
 * Extract the tables a SQL statement references, with optional aliases.
 * Heuristic (not a full parser): scans for FROM / JOIN / UPDATE / INTO and reads
 * the following dotted identifier as the table name, plus an optional alias.
 * Tolerant of partial / mid-typing SQL — never throws.
 */
export function extractTableRefs(sql: string): TableRef[] {
  const cleaned = stripNoise(sql)
  const refs: TableRef[] = []
  const seen = new Set<string>()

  const ident = '[A-Za-z_][A-Za-z0-9_]*(?:\\.[A-Za-z_][A-Za-z0-9_]*)*'
  const aliasIdent = '[A-Za-z_][A-Za-z0-9_]*'
  const stopwordsPattern = Array.from(ALIAS_STOPWORDS).join('|')
  const re = new RegExp(
    `\\b(?:from|join|update|into)\\s+(${ident})(?:\\s+(?:as\\s+)?(?!${stopwordsPattern}\\b)(${aliasIdent}))?`,
    'gi',
  )

  let m: RegExpExecArray | null
  while ((m = re.exec(cleaned)) !== null) {
    const name = m[1]
    const aliasCandidate = m[2]
    const alias =
      aliasCandidate && !ALIAS_STOPWORDS.has(aliasCandidate.toUpperCase())
        ? aliasCandidate
        : undefined
    const key = `${name.toLowerCase()}|${alias?.toLowerCase() ?? ''}`
    if (seen.has(key)) continue
    seen.add(key)
    refs.push(alias ? { name, alias } : { name })
  }

  return refs
}
