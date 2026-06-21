import snowflake from 'snowflake-sdk'
import type { WebContents } from 'electron'
import type {
  SnowflakeConnection,
  Dataset,
  Table,
  TableField,
  TableSearchHit,
  QueryResult
} from '../../shared/types'
import {
  runWithLifecycle, elapsed,
  cancelRunningQuery as _cancelRunningQuery,
} from './queryRuntime'

const DEFAULT_PAGE_SIZE = 100

// Suppress verbose SDK logging in production
snowflake.configure({ logLevel: 'ERROR' })

// ── Connection cache ─────────────────────────────────────────────────────────
// Persistent Connection objects reused across calls, keyed by connection.id
const connectionCache = new Map<string, snowflake.Connection>()

// ── Completed statements ──────────────────────────────────────────────────────
// Retained after execution for server-side pagination via streamRows({ start, end })
const completedStatements = new Map<string, snowflake.RowStatement>()

// ── Connection management ────────────────────────────────────────────────────

async function getConnection(conn: SnowflakeConnection): Promise<snowflake.Connection> {
  const existing = connectionCache.get(conn.id)
  if (existing && existing.isUp()) return existing

  // Strip the .snowflakecomputing.com suffix if the user entered the full hostname.
  // The SDK appends it automatically — passing the full domain doubles it.
  const accountId = conn.account.replace(/\.snowflakecomputing\.com$/i, '')

  const sfConn = snowflake.createConnection({
    account: accountId,
    username: conn.username,
    password: conn.password,
    warehouse: conn.warehouse,
    database: conn.database,
    schema: conn.schema,
    role: conn.role,
    application: 'Aperture'
  })

  await new Promise<void>((resolve, reject) => {
    sfConn.connect((err) => {
      if (err) reject(err)
      else resolve()
    })
  })

  connectionCache.set(conn.id, sfConn)
  return sfConn
}

// ── Low-level helpers ────────────────────────────────────────────────────────

/**
 * Execute a SQL statement and collect all rows — suitable for metadata queries
 * (SHOW, DESCRIBE) that return small result sets.
 */
function executeAll(
  sfConn: snowflake.Connection,
  sqlText: string
): Promise<Record<string, unknown>[]> {
  return new Promise((resolve, reject) => {
    sfConn.execute({
      sqlText,
      complete: (err, _stmt, rows) => {
        if (err) reject(err)
        else resolve((rows ?? []) as Record<string, unknown>[])
      }
    })
  })
}

/**
 * Execute a SQL statement with streamResult: true. Returns the Statement
 * (which has metadata like numRows / queryId) without loading all rows into
 * memory — the caller then calls streamPage() to pull specific row ranges.
 */
function executeStream(
  sfConn: snowflake.Connection,
  sqlText: string
): { promise: Promise<snowflake.RowStatement>; statement: snowflake.RowStatement } {
  let resolveStmt!: (s: snowflake.RowStatement) => void
  let rejectStmt!: (e: unknown) => void
  const promise = new Promise<snowflake.RowStatement>((res, rej) => {
    resolveStmt = res
    rejectStmt = rej
  })

  // execute() returns the Statement synchronously — store it immediately so
  // cancelRunningQuery can reach it before the complete callback fires.
  const statement = sfConn.execute({
    sqlText,
    streamResult: true,
    complete: (err, stmt) => {
      if (err) rejectStmt(err)
      else resolveStmt(stmt)
    }
  })

  return { promise, statement }
}

/**
 * Stream a contiguous range of rows [start, end] (inclusive) from an already-
 * executed Statement. Row keys are normalized via serializeRow().
 */
function streamPage(
  stmt: snowflake.RowStatement,
  start: number,
  end: number
): Promise<Record<string, unknown>[]> {
  return new Promise((resolve, reject) => {
    const rows: Record<string, unknown>[] = []
    const stream = stmt.streamRows({ start, end })
    stream.on('data', (row: Record<string, unknown>) => rows.push(serializeRow(row)))
    stream.on('end', () => resolve(rows))
    stream.on('error', reject)
  })
}

/**
 * Convert non-serializable JS values to IPC-safe equivalents:
 *   Date  → ISO string
 *   BigInt → string
 * Everything else is passed through as-is.
 */
function serializeRow(row: Record<string, unknown>): Record<string, unknown> {
  const out: Record<string, unknown> = {}
  for (const [k, v] of Object.entries(row)) {
    if (v instanceof Date) out[k] = v.toISOString()
    else if (typeof v === 'bigint') out[k] = v.toString()
    else out[k] = v
  }
  return out
}

/** Pick a value that might be stored under either lowercase or UPPERCASE key. */
function pick(row: Record<string, unknown>, key: string): unknown {
  return row[key] ?? row[key.toUpperCase()] ?? row[key.toLowerCase()]
}

function str(row: Record<string, unknown>, key: string): string {
  return String(pick(row, key) ?? '')
}

// ── Public adapter API ───────────────────────────────────────────────────────

export async function testConnection(
  connection: SnowflakeConnection
): Promise<{ ok: boolean; error?: string }> {
  try {
    const sfConn = await getConnection(connection)
    await executeAll(sfConn, 'SELECT 1 AS ping')
    return { ok: true }
  } catch (err) {
    connectionCache.delete(connection.id)
    return { ok: false, error: (err as Error).message }
  }
}

/**
 * Returns all schemas accessible to the current role as Dataset objects.
 * Dataset IDs have the form "DATABASE_NAME.SCHEMA_NAME".
 * When connection.database is set, scope to that database to reduce noise.
 */
export async function listDatasets(connection: SnowflakeConnection): Promise<Dataset[]> {
  const sfConn = await getConnection(connection)
  const sql = connection.database
    ? `SHOW SCHEMAS IN DATABASE ${connection.database}`
    : 'SHOW SCHEMAS IN ACCOUNT'

  const rows = await executeAll(sfConn, sql)
  return rows
    .filter((r) => {
      // Skip Snowflake internal schemas
      const name = str(r, 'name')
      return name !== 'INFORMATION_SCHEMA'
    })
    .map((r) => {
      // SHOW SCHEMAS IN DATABASE omits database_name; fall back to connection.database
      const dbName = str(r, 'database_name') || connection.database || ''
      const schemaName = str(r, 'name')
      const id = `${dbName}.${schemaName}`
      const comment = str(r, 'comment')
      return {
        id,
        projectId: connection.account,
        name: id,
        description: comment || undefined
      } satisfies Dataset
    })
}

/**
 * Returns all tables and views in the given schema.
 * @param datasetId — "DATABASE_NAME.SCHEMA_NAME" (as returned by listDatasets)
 */
export async function listTables(
  connection: SnowflakeConnection,
  datasetId: string
): Promise<Table[]> {
  const sfConn = await getConnection(connection)

  const [tableRows, viewRows] = await Promise.all([
    executeAll(sfConn, `SHOW TABLES IN SCHEMA ${datasetId}`).catch(() => []),
    executeAll(sfConn, `SHOW VIEWS IN SCHEMA ${datasetId}`).catch(() => [])
  ])

  const mapRow = (r: Record<string, unknown>, type: Table['type']): Table => {
    const name = str(r, 'name')
    const rowsVal = pick(r, 'rows')
    const bytesVal = pick(r, 'bytes')
    const comment = str(r, 'comment')
    return {
      id: name,
      datasetId,
      projectId: connection.account,
      name,
      type,
      description: comment || undefined,
      rowCount: rowsVal != null && rowsVal !== '' ? Number(rowsVal) : undefined,
      sizeBytes: bytesVal != null && bytesVal !== '' ? Number(bytesVal) : undefined
    }
  }

  return [
    ...tableRows.map((r) => mapRow(r, 'TABLE')),
    ...viewRows.map((r) => mapRow(r, 'VIEW'))
  ]
}

/**
 * Returns column definitions for a table.
 * @param datasetId — "DATABASE_NAME.SCHEMA_NAME"
 * @param tableId   — table or view name
 */
export async function getTableSchema(
  connection: SnowflakeConnection,
  datasetId: string,
  tableId: string
): Promise<TableField[]> {
  const sfConn = await getConnection(connection)
  const rows = await executeAll(sfConn, `DESCRIBE TABLE ${datasetId}.${tableId}`)

  return rows.map((r) => {
    // The nullable column is named "null?" in DESCRIBE output
    const nullable = str(r, 'null?') || str(r, 'NULL?')
    return {
      name: str(r, 'name'),
      type: str(r, 'type'),
      mode: nullable.toUpperCase() === 'Y' ? 'NULLABLE' : 'REQUIRED',
      description: str(r, 'comment') || undefined
    } satisfies TableField
  })
}

/**
 * Bulk column fetch for a whole schema via INFORMATION_SCHEMA.COLUMNS in one query.
 * @param datasetId — "DATABASE.SCHEMA"
 */
export async function getDatasetColumns(
  connection: SnowflakeConnection,
  datasetId: string
): Promise<Record<string, TableField[]>> {
  const sfConn = await getConnection(connection)
  const [dbName, schemaName] = datasetId.split('.')
  const sql = `SELECT TABLE_NAME, COLUMN_NAME, DATA_TYPE, IS_NULLABLE
                 FROM ${dbName}.INFORMATION_SCHEMA.COLUMNS
                WHERE TABLE_SCHEMA = '${schemaName.replace(/'/g, "''")}'
                ORDER BY TABLE_NAME, ORDINAL_POSITION`
  const rows = await executeAll(sfConn, sql)
  const out: Record<string, TableField[]> = {}
  for (const r of rows) {
    const tableName = str(r, 'TABLE_NAME')
    ;(out[tableName] ??= []).push({
      name: str(r, 'COLUMN_NAME'),
      type: str(r, 'DATA_TYPE'),
      mode: str(r, 'IS_NULLABLE').toUpperCase() === 'YES' ? 'NULLABLE' : 'REQUIRED'
    })
  }
  return out
}

/**
 * Catalog-wide table search.
 *   - If connection.database is set, uses that DB's INFORMATION_SCHEMA (fast, scoped).
 *   - Otherwise falls back to `SHOW TABLES LIKE '%query%' IN ACCOUNT` (capped at 10k by Snowflake).
 */
export async function searchTables(
  connection: SnowflakeConnection,
  query: string,
  limit: number
): Promise<TableSearchHit[]> {
  const sfConn = await getConnection(connection)
  // Snowflake binding placeholders are `?`; the SDK escapes them safely.
  const pattern = `%${query}%`

  if (connection.database) {
    const sql = `SELECT TABLE_CATALOG, TABLE_SCHEMA, TABLE_NAME, TABLE_TYPE
                   FROM ${connection.database}.INFORMATION_SCHEMA.TABLES
                  WHERE TABLE_NAME ILIKE '${pattern.replace(/'/g, "''")}'
                  LIMIT ${limit}`
    const rows = await executeAll(sfConn, sql)
    return rows.map((r) => {
      const dbName = str(r, 'TABLE_CATALOG')
      const schemaName = str(r, 'TABLE_SCHEMA')
      const tableName = str(r, 'TABLE_NAME')
      const tableType = str(r, 'TABLE_TYPE').toUpperCase()
      return {
        datasetId: `${dbName}.${schemaName}`,
        tableId: tableName,
        name: tableName,
        type: tableType === 'VIEW' ? 'VIEW' : 'TABLE'
      } satisfies TableSearchHit
    })
  }

  // Fallback: account-wide SHOW TABLES (no INFORMATION_SCHEMA available without a DB)
  const sql = `SHOW TABLES LIKE '${pattern.replace(/'/g, "''")}' IN ACCOUNT`
  const rows = await executeAll(sfConn, sql)
  return rows.slice(0, limit).map((r) => {
    const dbName = str(r, 'database_name')
    const schemaName = str(r, 'schema_name')
    const tableName = str(r, 'name')
    return {
      datasetId: `${dbName}.${schemaName}`,
      tableId: tableName,
      name: tableName,
      type: 'TABLE'
    } satisfies TableSearchHit
  })
}

/**
 * Execute a user query. Streams the first page of results and keeps the
 * Statement for subsequent getQueryPage() calls. Sends QUERY_LOG heartbeats
 * to the renderer and enforces a 180s timeout.
 */
export async function runQuery(
  connection: SnowflakeConnection,
  sql: string,
  tabId: string,
  webContents: WebContents
): Promise<QueryResult> {
  const sfConn = await getConnection(connection)
  const start = Date.now()

  return runWithLifecycle({
    tabId,
    webContents,
    timeoutMessage: 'Query timed out after 180 seconds. The statement has been cancelled.',
    execute: async ({ log, registerCancel }) => {
      log('Submitting query to Snowflake…')
      const { promise: stmtPromise, statement: earlyStmt } = executeStream(sfConn, sql)
      // Register immediately for early cancellation (before complete fires).
      registerCancel(() => new Promise<void>((res) => { earlyStmt.cancel(() => res()) }))

      const stmt = await stmtPromise
      const queryId = stmt.getQueryId()
      log(`Query complete · ${queryId} · Fetching first page…`)

      const totalRows = stmt.getNumRows()
      const pageEnd = Math.min(DEFAULT_PAGE_SIZE, totalRows)
      const rows = pageEnd > 0 ? await streamPage(stmt, 0, pageEnd - 1) : []

      const columns =
        rows.length > 0
          ? Object.keys(rows[0])
          : (stmt.getColumns() ?? []).map((c) => c.getName())

      const hasMore = totalRows > DEFAULT_PAGE_SIZE
      const totalLabel = ` (${totalRows.toLocaleString()} total)`
      log(`Fetched ${rows.length.toLocaleString()} rows${totalLabel} · ${elapsed(start)}`)

      completedStatements.set(tabId, stmt)

      return {
        columns,
        rows,
        rowCount: rows.length,
        executionTimeMs: Date.now() - start,
        totalRows,
        pageToken: hasMore ? String(DEFAULT_PAGE_SIZE) : null,
        hasMore
      } satisfies QueryResult
    }
  })
}

/**
 * Fetch the next page of results for a previously executed query.
 * @param pageToken — numeric string offset (e.g. "100", "200")
 */
export async function getQueryPage(tabId: string, pageToken: string): Promise<QueryResult> {
  const stmt = completedStatements.get(tabId)
  if (!stmt) throw new Error('No completed statement found for this tab. Re-run the query.')

  const start = parseInt(pageToken, 10)
  const totalRows = stmt.getNumRows()
  const end = Math.min(start + DEFAULT_PAGE_SIZE - 1, totalRows - 1)
  const rows = start < totalRows ? await streamPage(stmt, start, end) : []

  const columns =
    rows.length > 0
      ? Object.keys(rows[0])
      : (stmt.getColumns() ?? []).map((c) => c.getName())

  const nextOffset = start + DEFAULT_PAGE_SIZE
  const hasMore = nextOffset < totalRows

  return {
    columns,
    rows,
    rowCount: rows.length,
    executionTimeMs: 0,
    totalRows,
    pageToken: hasMore ? String(nextOffset) : null,
    hasMore
  }
}

/**
 * Cancel the running statement for the given tab. No-op if no query is active.
 */
export const cancelRunningQuery = _cancelRunningQuery

/**
 * Validate a query without executing it by running EXPLAIN.
 * Snowflake has no byte-cost dry-run, so bytesProcessed is always 0.
 */
export async function dryRunQuery(
  connection: SnowflakeConnection,
  sql: string
): Promise<{ bytesProcessed: number; plan?: string; planFormat?: 'text' | 'json' }> {
  const sfConn = await getConnection(connection)
  const rows = await executeAll(sfConn, `EXPLAIN ${sql}`)
  const plan = rows.length > 0
    ? rows.map((r) => Object.values(r).join(' | ')).join('\n')
    : undefined
  return { bytesProcessed: 0, plan, planFormat: plan ? 'text' : undefined }
}

/**
 * Destroy the cached connection for the given connection ID.
 * Called when the user updates or deletes a connection.
 */
export function invalidateClient(connectionId: string): void {
  const sfConn = connectionCache.get(connectionId)
  if (!sfConn) return
  connectionCache.delete(connectionId)
  sfConn.destroy((err) => {
    if (err) { /* ignore — connection may already be gone */ }
  })
}
