import { BigQuery, Job } from '@google-cloud/bigquery'
import type { WebContents } from 'electron'
import type { BigQueryConnection, Dataset, Table, TableField, TableSearchHit, QueryResult } from '../../shared/types'
import {
  runWithLifecycle, elapsed,
  cancelRunningQuery as _cancelRunningQuery,
  runCapped, groupColumnsByTable,
} from './queryRuntime'

// BigQuery client cache, keyed by connection ID
const clients = new Map<string, BigQuery>()

// Completed jobs, keyed by tab ID — used for fetching subsequent pages
const completedJobs = new Map<string, Job>()

const DEFAULT_PAGE_SIZE = 100

function getClient(connection: BigQueryConnection): BigQuery {
  if (clients.has(connection.id)) return clients.get(connection.id)!
  const options: ConstructorParameters<typeof BigQuery>[0] = { projectId: connection.projectId }
  if (connection.credentialType === 'service-account' && connection.serviceAccountPath) {
    options.keyFilename = connection.serviceAccountPath
  }
  const client = new BigQuery(options)
  clients.set(connection.id, client)
  return client
}

export async function testConnection(
  connection: BigQueryConnection
): Promise<{ ok: boolean; error?: string }> {
  try {
    const client = getClient(connection)
    await client.getDatasets({ maxResults: 1 })
    return { ok: true }
  } catch (err) {
    clients.delete(connection.id)
    return { ok: false, error: (err as Error).message }
  }
}

export async function listDatasets(connection: BigQueryConnection): Promise<Dataset[]> {
  const client = getClient(connection)
  const [datasets] = await client.getDatasets()
  return datasets.map((d) => ({
    id: d.id!,
    projectId: connection.projectId,
    name: d.id!,
    location: (d.metadata?.location as string) ?? undefined,
    description: (d.metadata?.description as string) ?? undefined
  }))
}

export async function listTables(connection: BigQueryConnection, datasetId: string): Promise<Table[]> {
  const client = getClient(connection)
  const [tables] = await client.dataset(datasetId).getTables()
  return tables.map((t) => ({
    id: t.id!,
    datasetId,
    projectId: connection.projectId,
    name: t.id!,
    type: (t.metadata?.type as Table['type']) ?? 'TABLE',
    description: (t.metadata?.description as string) ?? undefined,
    rowCount: t.metadata?.numRows ? Number(t.metadata.numRows) : undefined,
    sizeBytes: t.metadata?.numBytes ? Number(t.metadata.numBytes) : undefined
  }))
}

/**
 * Catalog-wide table search across all datasets in the project.
 * BigQuery has no project-wide INFORMATION_SCHEMA without specifying a region,
 * so we fan out one `INFORMATION_SCHEMA.TABLES` query per dataset.
 *
 * Concurrency cap of 5 prevents API rate-limit storms on large projects.
 * Results are truncated to `limit` after merging.
 */
export async function searchTables(
  connection: BigQueryConnection,
  query: string,
  limit: number
): Promise<TableSearchHit[]> {
  const client = getClient(connection)
  const [datasets] = await client.getDatasets()
  const datasetIds = datasets.map((d) => d.id!).filter(Boolean)

  // Escape % and _ in the LIKE pattern; BigQuery doesn't have ILIKE, use LOWER(...) LIKE LOWER(...)
  const escaped = query.replace(/\\/g, '\\\\').replace(/%/g, '\\%').replace(/_/g, '\\_')
  const pattern = `%${escaped}%`
  const perDatasetLimit = Math.min(limit, 50)

  const CONCURRENCY = 5
  const hits: TableSearchHit[] = []

  await runCapped(datasetIds, CONCURRENCY, async (datasetId) => {
    if (hits.length >= limit) return
    try {
      const sql = `
        SELECT table_name, table_type
          FROM \`${connection.projectId}.${datasetId}.INFORMATION_SCHEMA.TABLES\`
         WHERE LOWER(table_name) LIKE LOWER(@pattern) ESCAPE '\\\\'
         LIMIT ${perDatasetLimit}
      `
      const [rows] = await client.query({ query: sql, params: { pattern } })
      for (const r of rows as Record<string, unknown>[]) {
        hits.push({
          datasetId,
          tableId: r.table_name as string,
          name: r.table_name as string,
          type:
            (r.table_type as string) === 'VIEW' ||
            (r.table_type as string) === 'MATERIALIZED VIEW'
              ? 'VIEW'
              : 'TABLE'
        } satisfies TableSearchHit)
      }
    } catch {
      // Skip datasets we can't query (permission errors, regional mismatches)
    }
  })

  return hits.slice(0, limit)
}

/**
 * Bulk column fetch for an entire dataset in a single INFORMATION_SCHEMA.COLUMNS
 * query. Returns coarse column name + type per table (enough for autocomplete);
 * the full-fidelity nested schema still comes from getTableSchema.
 */
export async function getDatasetColumns(
  connection: BigQueryConnection,
  datasetId: string
): Promise<Record<string, TableField[]>> {
  const client = getClient(connection)
  const query = `
    SELECT table_name, column_name, data_type
      FROM \`${connection.projectId}.${datasetId}.INFORMATION_SCHEMA.COLUMNS\`
     ORDER BY table_name, ordinal_position
  `
  const [rows] = await client.query({ query })
  return groupColumnsByTable(rows as Record<string, unknown>[], (r) => ({
    tableId: r.table_name as string,
    field: { name: r.column_name as string, type: r.data_type as string, mode: 'NULLABLE' },
  }))
}

export async function getTableSchema(
  connection: BigQueryConnection,
  datasetId: string,
  tableId: string
): Promise<TableField[]> {
  const client = getClient(connection)
  const [metadata] = await client.dataset(datasetId).table(tableId).getMetadata()
  return mapFields((metadata.schema?.fields ?? []) as Record<string, unknown>[])
}

export async function runQuery(
  connection: BigQueryConnection,
  sql: string,
  tabId: string,
  webContents: WebContents
): Promise<QueryResult> {
  const client = getClient(connection)
  const start = Date.now()

  return runWithLifecycle({
    tabId,
    webContents,
    timeoutMessage: 'Query timed out after 180 seconds. The job has been cancelled.',
    execute: async ({ log, registerCancel }) => {
      log('Creating BigQuery job…')
      const [job] = await client.createQueryJob({ query: sql, useLegacySql: false })
      log(`Job created · ${job.id}`)
      log('Waiting for results…')
      registerCancel(async () => { await job.cancel() })

      const [rows, nextQuery, apiResponse] = await job.getQueryResults({
        autoPaginate: false,
        maxResults: DEFAULT_PAGE_SIZE,
      })

      const columns = rows.length > 0 ? Object.keys(rows[0] as object) : []
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      const statsBytes = (job.metadata as any)?.statistics?.query?.totalBytesProcessed
      const bytes = statsBytes != null ? Number(statsBytes) : undefined
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      const totalRowsStr = (apiResponse as any)?.totalRows
      const totalRows = totalRowsStr != null ? Number(totalRowsStr) : undefined
      const pageToken = nextQuery?.pageToken ?? null
      const byteLabel = bytes != null ? ` · ${formatBytes(bytes)} processed` : ''
      const totalLabel = totalRows != null ? ` (${totalRows.toLocaleString()} total)` : ''
      log(`Done · ${rows.length.toLocaleString()} rows fetched${totalLabel} · ${elapsed(start)}${byteLabel}`)

      completedJobs.set(tabId, job)

      return {
        columns,
        rows: rows as Record<string, unknown>[],
        rowCount: rows.length,
        executionTimeMs: Date.now() - start,
        bytesProcessed: bytes,
        totalRows,
        pageToken,
        hasMore: pageToken != null
      } satisfies QueryResult
    }
  })
}

export async function getQueryPage(
  tabId: string,
  pageToken: string
): Promise<QueryResult> {
  const job = completedJobs.get(tabId)
  if (!job) throw new Error('No completed job found for this tab. Re-run the query.')

  const [rows, nextQuery, apiResponse] = await job.getQueryResults({
    autoPaginate: false,
    maxResults: DEFAULT_PAGE_SIZE,
    pageToken
  })

  const columns = rows.length > 0 ? Object.keys(rows[0] as object) : []
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const totalRowsStr = (apiResponse as any)?.totalRows
  const totalRows = totalRowsStr != null ? Number(totalRowsStr) : undefined
  const nextPageToken = nextQuery?.pageToken ?? null

  return {
    columns,
    rows: rows as Record<string, unknown>[],
    rowCount: rows.length,
    executionTimeMs: 0,
    totalRows,
    pageToken: nextPageToken,
    hasMore: nextPageToken != null
  }
}

export const cancelRunningQuery = _cancelRunningQuery

export async function dryRunQuery(
  connection: BigQueryConnection,
  sql: string
): Promise<{ bytesProcessed: number; plan?: string; planFormat?: 'text' | 'json' }> {
  const client = getClient(connection)
  // Use createQueryJob with dryRun so we get a Job object whose metadata
  // carries statistics.query.totalBytesProcessed without executing the query.
  const [job] = await client.createQueryJob({ query: sql, useLegacySql: false, dryRun: true })
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const stats = (job.metadata as any)?.statistics?.query
  const statsBytes = stats?.totalBytesProcessed
  const queryPlan = stats?.queryPlan
  return {
    bytesProcessed: statsBytes != null ? Number(statsBytes) : 0,
    plan: queryPlan ? JSON.stringify(queryPlan, null, 2) : undefined,
    planFormat: queryPlan ? 'json' : undefined
  }
}

export function invalidateClient(connectionId: string): void {
  clients.delete(connectionId)
}

function mapFields(fields: Record<string, unknown>[]): TableField[] {
  return fields.map((f) => ({
    name: f.name as string,
    type: f.type as string,
    mode: (f.mode as TableField['mode']) ?? 'NULLABLE',
    description: (f.description as string) ?? undefined,
    fields: f.fields ? mapFields(f.fields as Record<string, unknown>[]) : undefined
  }))
}

function formatBytes(bytes: number): string {
  if (bytes < 1e6) return `${(bytes / 1e3).toFixed(1)} KB`
  if (bytes < 1e9) return `${(bytes / 1e6).toFixed(1)} MB`
  return `${(bytes / 1e9).toFixed(2)} GB`
}
