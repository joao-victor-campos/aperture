/**
 * Serialize result rows to a TSV string (header + one line per row), suitable
 * for clipboard paste into Google Sheets / Excel. Mirrors ResultsTable's
 * formatCell: BigQuery-style { value } objects are unwrapped, other objects are
 * JSON-stringified, null/undefined become empty cells. Embedded tabs/newlines
 * are flattened to spaces so the row/column structure survives the paste.
 */
export function rowsToTsv(rows: Record<string, unknown>[], columns: string[]): string {
  const cell = (v: unknown): string => {
    if (v === null || v === undefined) return ''
    let s: string
    if (typeof v === 'object') {
      const o = v as Record<string, unknown>
      s = 'value' in o && typeof o.value === 'string' ? o.value : JSON.stringify(v)
    } else {
      s = String(v)
    }
    return s.replace(/\t/g, ' ').replace(/\r?\n/g, ' ')
  }
  const header = columns.join('\t')
  if (rows.length === 0) return header
  const body = rows.map((r) => columns.map((c) => cell(r[c])).join('\t')).join('\n')
  return `${header}\n${body}`
}
