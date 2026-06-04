import type { ConnectionEngine } from '@shared/types'

/**
 * Builds a `SELECT * FROM … LIMIT 100` statement with engine-appropriate quoting.
 *
 * - BigQuery: backtick-quoted  `project.dataset.table`
 * - Snowflake: double-quoted   "DATABASE"."SCHEMA"."TABLE"  (datasetId is "DB.SCHEMA")
 * - Postgres:  double-quoted   "schema"."table"
 */
export function buildSelectQuery(
  engine: ConnectionEngine,
  projectId: string,
  datasetId: string,
  tableId: string
): string {
  if (engine === 'bigquery') {
    return `SELECT * FROM \`${projectId}.${datasetId}.${tableId}\` LIMIT 100`
  }
  if (engine === 'snowflake') {
    // datasetId is stored as "DATABASE.SCHEMA" — split and quote each part individually
    const parts = [...datasetId.split('.'), tableId].map(quoteIdent)
    return `SELECT * FROM ${parts.join('.')} LIMIT 100`
  }
  // Postgres (and any future engine): schema.table, double-quoted
  return `SELECT * FROM ${quoteIdent(datasetId)}.${quoteIdent(tableId)} LIMIT 100`
}

/** Double-quotes an identifier, escaping any embedded double-quotes. */
export function quoteIdent(ident: string): string {
  return `"${ident.replace(/"/g, '""')}"`
}
