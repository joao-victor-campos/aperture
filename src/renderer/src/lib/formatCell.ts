export function formatCell(value: unknown): string {
  if (value === null || value === undefined) return 'NULL'
  if (typeof value === 'object') {
    // BigQuery wraps DATE / DATETIME / TIMESTAMP / NUMERIC as { value: "..." }
    const v = value as Record<string, unknown>
    if ('value' in v && typeof v.value === 'string') return v.value
    return JSON.stringify(value)
  }
  return String(value)
}
