/**
 * Returns the ordered, de-duplicated list of {{name}} parameter names referenced
 * in `sql`. Comments and string literals are stripped first, so a {{...}} that
 * appears inside a string or comment is not treated as a parameter. Param names
 * match [A-Za-z_][A-Za-z0-9_]* with optional surrounding whitespace.
 */
export function extractParams(sql: string): string[] {
  const cleaned = stripNoise(sql)
  const re = /\{\{\s*([A-Za-z_][A-Za-z0-9_]*)\s*\}\}/g
  const seen = new Set<string>()
  const out: string[] = []
  let m: RegExpExecArray | null
  while ((m = re.exec(cleaned)) !== null) {
    const name = m[1]
    if (!seen.has(name)) {
      seen.add(name)
      out.push(name)
    }
  }
  return out
}

/**
 * Replace line comments, block comments, and single/double/backtick-quoted
 * strings with spaces so {{...}} inside them is not detected.
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
