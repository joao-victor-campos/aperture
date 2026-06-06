/**
 * Returns true if the SQL is a SELECT (or WITH…SELECT) that lacks a LIMIT
 * clause at the outermost level. Returns false for non-SELECT statements
 * (INSERT, CREATE, UPDATE, DELETE, etc.) and for queries that already have LIMIT.
 */
export function detectMissingLimit(sql: string): boolean {
  // 1. Strip line comments, block comments, and string literals
  const cleaned = stripNoise(sql)

  // 2. Check if this is a SELECT or WITH...SELECT (not DDL/DML)
  const trimmed = cleaned.trim()
  if (!trimmed) return false
  const upper = trimmed.toUpperCase()
  if (!upper.startsWith('SELECT') && !upper.startsWith('WITH')) return false

  // 3. Tokenize the cleaned SQL and look for LIMIT at paren depth 0
  return !hasLimitAtDepthZero(cleaned)
}

/**
 * Remove line comments (-- ...\n), block comments, and single-quoted strings.
 * Replaces them with spaces so surrounding tokens don't merge.
 */
function stripNoise(sql: string): string {
  let result = ''
  let i = 0
  while (i < sql.length) {
    // Line comment
    if (sql[i] === '-' && sql[i + 1] === '-') {
      const end = sql.indexOf('\n', i)
      i = end === -1 ? sql.length : end + 1
      result += ' '
      continue
    }
    // Block comment
    if (sql[i] === '/' && sql[i + 1] === '*') {
      const end = sql.indexOf('*/', i + 2)
      i = end === -1 ? sql.length : end + 2
      result += ' '
      continue
    }
    // Single-quoted string literal
    if (sql[i] === "'") {
      i++
      while (i < sql.length) {
        if (sql[i] === "'" && sql[i + 1] === "'") {
          i += 2 // escaped quote
        } else if (sql[i] === "'") {
          i++
          break
        } else {
          i++
        }
      }
      result += ' '
      continue
    }
    result += sql[i]
    i++
  }
  return result
}

/**
 * Walk through the cleaned SQL tokens and check if LIMIT appears
 * at parenthesis depth 0 (outermost level).
 */
function hasLimitAtDepthZero(sql: string): boolean {
  // Tokenize: split on word boundaries but respect parens
  let depth = 0
  // Use a regex to find word tokens and parens
  const tokenRegex = /[()]|\b\w+\b/gi
  let match: RegExpExecArray | null
  while ((match = tokenRegex.exec(sql)) !== null) {
    const token = match[0]
    if (token === '(') {
      depth++
    } else if (token === ')') {
      depth = Math.max(0, depth - 1)
    } else if (depth === 0 && token.toUpperCase() === 'LIMIT') {
      return true
    }
  }
  return false
}
