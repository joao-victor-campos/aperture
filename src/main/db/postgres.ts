import { Pool, Client, PoolClient } from 'pg'
import type { WebContents } from 'electron'
import { CHANNELS } from '../../shared/ipc'
import type { PostgresConnection, Dataset, Table, TableField, QueryResult } from '../../shared/types'

const QUERY_TIMEOUT_MS = 180_000
const HEARTBEAT_INTERVAL_MS = 10_000

// Pool cache keyed by connection ID
const pools = new Map<string, Pool>()

// Active clients keyed by tab ID — used for cancellation via PID
interface RunningQuery {
  client: PoolClient
  pid: number
  connectionId: string
  webContents: WebContents
}
const runningQueries = new Map<string, RunningQuery>()

// Cache results for pagination (mimicking BigQuery's behavior)
const cachedResults = new Map<string, any[]>()

const DEFAULT_PAGE_SIZE = 100

function getPool(connection: PostgresConnection): Pool {
  if (pools.has(connection.id)) return pools.get(connection.id)!
  
  const pool = new Pool({
    host: connection.host,
    port: connection.port || 5432,
    database: connection.database,
    user: connection.user,
    password: connection.password,
    max: 10,
    idleTimeoutMillis: 30000
  })
  
  pools.set(connection.id, pool)
  return pool
}

export async function testConnection(connection: PostgresConnection): Promise<{ ok: boolean; error?: string }> {
  const pool = getPool(connection)
  try {
    const client = await pool.connect()
    client.release()
    return { ok: true }
  } catch (err) {
    pools.delete(connection.id)
    return { ok: false, error: (err as Error).message }
  }
}

// In Postgres, "Datasets" are equivalent to "Schemas"
export async function listDatasets(connection: PostgresConnection): Promise<Dataset[]> {
  const pool = getPool(connection)
  const res = await pool.query(`
    SELECT schema_name FROM information_schema.schemata 
    WHERE schema_name NOT IN ('information_schema', 'pg_catalog')
  `)
  return res.rows.map((r) => ({
    id: r.schema_name,
    projectId: connection.database, // Using DB name as project context
    name: r.schema_name
  }))
}

export async function listTables(connection: PostgresConnection, datasetId: string): Promise<Table[]> {
  const pool = getPool(connection)
  const res = await pool.query(`
    SELECT table_name, table_type 
    FROM information_schema.tables 
    WHERE table_schema = $1
  `, [datasetId])
  
  return res.rows.map((t) => ({
    id: t.table_name,
    datasetId,
    projectId: connection.database,
    name: t.table_name,
    type: t.table_type === 'VIEW' ? 'VIEW' : 'TABLE'
  }))
}

export async function getTableSchema(connection: PostgresConnection, datasetId: string, tableId: string): Promise<TableField[]> {
  const pool = getPool(connection)
  const res = await pool.query(`
    SELECT column_name, data_type, is_nullable, column_default
    FROM information_schema.columns
    WHERE table_schema = $1 AND table_name = $2
    ORDER BY ordinal_position
  `, [datasetId, tableId])

  return res.rows.map((c) => ({
    name: c.column_name,
    type: c.data_type,
    mode: c.is_nullable === 'YES' ? 'NULLABLE' : 'REQUIRED'
  }))
}

export async function runQuery(
  connection: PostgresConnection,
  sql: string,
  tabId: string,
  webContents: WebContents
): Promise<QueryResult> {
  const pool = getPool(connection)
  const start = Date.now()
  const log = (message: string) => {
    if (!webContents.isDestroyed()) {
      webContents.send(CHANNELS.QUERY_LOG, { tabId, message })
    }
  }

  log('Connecting to Postgres...')
  const client = await pool.connect()
  
  try {
    // Get backend PID so we can cancel this specific query if needed
    const pidRes = await client.query('SELECT pg_backend_pid()')
    const pid = pidRes.rows[0].pg_backend_pid
    runningQueries.set(tabId, { client, pid, connectionId: connection.id, webContents })

    log(`Query started · PID: ${pid}`)
    
    let heartbeatTimer = setInterval(() => {
      log(`Still running… ${Math.round((Date.now() - start)/1000)}s elapsed`)
    }, HEARTBEAT_INTERVAL_MS)

    // Set a statement timeout for this specific query
    await client.query(`SET statement_timeout = ${QUERY_TIMEOUT_MS}`)

    const res = await client.query(sql)
    clearInterval(heartbeatTimer)

    const rows = res.rows
    const columns = rows.length > 0 ? Object.keys(rows[0]) : []
    
    // Store in cache for pagination (Postgres doesn't save results like BQ)
    cachedResults.set(tabId, rows)

    log(`Done · ${rows.length.toLocaleString()} rows fetched · ${Date.now() - start}ms`)

    return {
      columns,
      rows: rows.slice(0, DEFAULT_PAGE_SIZE),
      rowCount: rows.length,
      executionTimeMs: Date.now() - start,
      hasMore: rows.length > DEFAULT_PAGE_SIZE,
      pageToken: rows.length > DEFAULT_PAGE_SIZE ? '1' : null 
    }
  } catch (err) {
    log(`Error: ${(err as Error).message}`)
    throw err
  } finally {
    runningQueries.delete(tabId)
    client.release()
  }
}

export async function getQueryPage(tabId: string, pageToken: string): Promise<QueryResult> {
  const allRows = cachedResults.get(tabId)
  if (!allRows) throw new Error('No cached results found.')

  const page = parseInt(pageToken)
  const start = page * DEFAULT_PAGE_SIZE
  const end = start + DEFAULT_PAGE_SIZE
  const rows = allRows.slice(start, end)

  return {
    columns: allRows.length > 0 ? Object.keys(allRows[0]) : [],
    rows,
    rowCount: rows.length,
    executionTimeMs: 0,
    pageToken: allRows.length > end ? (page + 1).toString() : null,
    hasMore: allRows.length > end
  }
}

export async function cancelRunningQuery(tabId: string): Promise<void> {
  const running = runningQueries.get(tabId)
  if (!running) return

  const { pid, webContents, connectionId } = running
  logToWebContents(webContents, tabId, 'Cancelling Postgres process...')
  
  // We need a separate connection to issue the cancel command
  const pool = pools.get(connectionId)
  if (pool) await pool.query('SELECT pg_cancel_backend($1)', [pid])
  
  runningQueries.delete(tabId)
}

export async function dryRunQuery(connection: PostgresConnection, sql: string): Promise<{ bytesProcessed: number }> {
  const pool = getPool(connection)
  // Postgres doesn't have "bytes processed" metrics like BQ, but we can use EXPLAIN
  await pool.query(`EXPLAIN ${sql}`)
  return { bytesProcessed: 0 } // Always 0 as Postgres is not a billing-per-byte model
}

export function invalidateClient(connectionId: string): void {
  const pool = pools.get(connectionId)
  if (!pool) return
  pools.delete(connectionId)
  // Fire and forget; we only need to drop the pool from cache.
  void pool.end().catch(() => {})
}

function logToWebContents(webContents: WebContents, tabId: string, message: string) {
  if (!webContents.isDestroyed()) {
    webContents.send(CHANNELS.QUERY_LOG, { tabId, message })
  }
}