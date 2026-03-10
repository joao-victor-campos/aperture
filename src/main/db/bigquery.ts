import { BigQuery, Job } from '@google-cloud/bigquery'
import type { WebContents } from 'electron'
import { CHANNELS } from '../../shared/ipc'
import type { Connection, Dataset, Table, TableField, QueryResult } from '../../shared/types'

const QUERY_TIMEOUT_MS = 180_000
const HEARTBEAT_INTERVAL_MS = 10_000

// BigQuery client cache, keyed by connection ID
const clients = new Map<string, BigQuery>()

// Active running jobs, keyed by tab ID — used for cancellation
interface RunningJob {
  job: Job
  webContents: WebContents
}
const runningJobs = new Map<string, RunningJob>()

function getClient(connection: Connection): BigQuery {
  if (clients.has(connection.id)) return clients.get(connection.id)!
  const options: ConstructorParameters<typeof BigQuery>[0] = { projectId: connection.projectId }
  if (connection.credentialType === 'service-account' && connection.serviceAccountPath) {
    options.keyFilename = connection.serviceAccountPath
  }
  const client = new BigQuery(options)
  clients.set(connection.id, client)
  return client
}

function elapsed(startMs: number): string {
  const s = Math.round((Date.now() - startMs) / 1000)
  const m = Math.floor(s / 60)
  return m > 0 ? `${m}m ${s % 60}s` : `${s}s`
}

export async function testConnection(
  connection: Connection
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

export async function listDatasets(connection: Connection): Promise<Dataset[]> {
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

export async function listTables(connection: Connection, datasetId: string): Promise<Table[]> {
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

export async function getTableSchema(
  connection: Connection,
  datasetId: string,
  tableId: string
): Promise<TableField[]> {
  const client = getClient(connection)
  const [metadata] = await client.dataset(datasetId).table(tableId).getMetadata()
  return mapFields((metadata.schema?.fields ?? []) as Record<string, unknown>[])
}

export async function runQuery(
  connection: Connection,
  sql: string,
  tabId: string,
  webContents: WebContents
): Promise<QueryResult> {
  const client = getClient(connection)
  const start = Date.now()

  const log = (message: string) => {
    if (!webContents.isDestroyed()) {
      webContents.send(CHANNELS.QUERY_LOG, { tabId, message })
    }
  }

  // ── 1. Create the job (gives us a handle for cancellation) ──────────────
  log('Creating BigQuery job…')
  const [job] = await client.createQueryJob({ query: sql, useLegacySql: false })
  log(`Job created · ${job.id}`)
  log('Waiting for results…')

  runningJobs.set(tabId, { job: job as RunningJob['job'], webContents })

  // ── 2. Cleanup helper (idempotent) ───────────────────────────────────────
  let done = false
  let heartbeatTimer: ReturnType<typeof setInterval> | null = null
  let timeoutTimer: ReturnType<typeof setTimeout> | null = null

  const cleanup = () => {
    if (done) return
    done = true
    if (heartbeatTimer) clearInterval(heartbeatTimer)
    if (timeoutTimer) clearTimeout(timeoutTimer)
    runningJobs.delete(tabId)
  }

  // ── 3. Heartbeat every 10s so user sees progress ─────────────────────────
  heartbeatTimer = setInterval(() => {
    log(`Still running… ${elapsed(start)} elapsed`)
  }, HEARTBEAT_INTERVAL_MS)

  // ── 4. Core query promise ────────────────────────────────────────────────
  const queryPromise = job
    .getQueryResults({ autoPaginate: true })
    .then(([rows]) => {
      cleanup()
      const columns = rows.length > 0 ? Object.keys(rows[0] as object) : []
      // Statistics live in job.metadata after the job completes, not in the response payload
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      const statsBytes = (job.metadata as any)?.statistics?.query?.totalBytesProcessed
      const bytes = statsBytes != null ? Number(statsBytes) : undefined
      const byteLabel = bytes != null ? ` · ${formatBytes(bytes)} processed` : ''
      log(`Done · ${rows.length.toLocaleString()} rows · ${elapsed(start)}${byteLabel}`)
      return {
        columns,
        rows: rows as Record<string, unknown>[],
        rowCount: rows.length,
        executionTimeMs: Date.now() - start,
        bytesProcessed: bytes
      } satisfies QueryResult
    })
    .catch((err: Error) => {
      cleanup()
      throw err
    })

  // Prevent unhandled rejection after Promise.race settles
  queryPromise.catch(() => {})

  // ── 5. 180s timeout race ─────────────────────────────────────────────────
  const timeoutPromise = new Promise<never>((_, reject) => {
    timeoutTimer = setTimeout(async () => {
      log(`Timeout reached (180s) · Cancelling job…`)
      try {
        await job.cancel()
      } catch {
        // ignore cancel errors
      }
      cleanup()
      reject(new Error('Query timed out after 180 seconds. The job has been cancelled.'))
    }, QUERY_TIMEOUT_MS)
  })

  return Promise.race([queryPromise, timeoutPromise])
}

export async function cancelRunningQuery(tabId: string): Promise<void> {
  const running = runningJobs.get(tabId)
  if (!running) return
  const { job, webContents } = running
  if (!webContents.isDestroyed()) {
    webContents.send(CHANNELS.QUERY_LOG, { tabId, message: 'Cancelled by user.' })
  }
  try {
    await job.cancel()
  } catch {
    // ignore — job may have already completed
  }
  runningJobs.delete(tabId)
}

export async function dryRunQuery(
  connection: Connection,
  sql: string
): Promise<{ bytesProcessed: number }> {
  const client = getClient(connection)
  // Use createQueryJob with dryRun so we get a Job object whose metadata
  // carries statistics.query.totalBytesProcessed without executing the query.
  const [job] = await client.createQueryJob({ query: sql, useLegacySql: false, dryRun: true })
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const statsBytes = (job.metadata as any)?.statistics?.query?.totalBytesProcessed
  return { bytesProcessed: statsBytes != null ? Number(statsBytes) : 0 }
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
