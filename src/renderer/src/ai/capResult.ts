import type { QueryResult } from '@shared/types'

/**
 * Serialize a query result into a compact string for the model's tool_result.
 * Sends column names + the first `limit` rows + the total row count, so token
 * cost stays bounded on large results.
 */
export function capResult(result: QueryResult, limit = 50): string {
  const total = result.totalRows ?? result.rowCount
  const rows = result.rows.slice(0, limit)
  return JSON.stringify({
    columns: result.columns,
    rows,
    rowCount: result.rowCount,
    totalRows: total,
    truncated: result.rows.length > limit,
    executionTimeMs: result.executionTimeMs,
  })
}
