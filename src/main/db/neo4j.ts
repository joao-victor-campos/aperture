import neo4j from 'neo4j-driver'
import type { Driver, Session, Integer, Node, Relationship, Path } from 'neo4j-driver'
import type { WebContents } from 'electron'
import { CHANNELS } from '../../shared/ipc'
import type {
  Neo4jConnection,
  Neo4jNode,
  Neo4jRelationship,
  Neo4jPath,
  Dataset,
  Table,
  TableField,
  TableSearchHit,
  QueryResult,
} from '../../shared/types'

const QUERY_TIMEOUT_MS = 180_000
const HEARTBEAT_INTERVAL_MS = 10_000
const DEFAULT_PAGE_SIZE = 100
const SCHEMA_SAMPLE_SIZE = 50

// ── Driver cache ───────────────────────────────────────────────────────────────
// Persistent Driver objects reused across calls, keyed by connection.id.
const driverCache = new Map<string, Driver>()

// ── Helpers ─────────────────────────────────────────────────────────────────────

function databaseName(connection: Neo4jConnection): string {
  return connection.database?.trim() || 'neo4j'
}

function getDriver(connection: Neo4jConnection): Driver {
  const existing = driverCache.get(connection.id)
  if (existing) return existing
  const driver = neo4j.driver(
    connection.uri,
    neo4j.auth.basic(connection.username, connection.password),
  )
  driverCache.set(connection.id, driver)
  return driver
}

function elapsed(startMs: number): string {
  const s = Math.round((Date.now() - startMs) / 1000)
  const m = Math.floor(s / 60)
  return m > 0 ? `${m}m ${s % 60}s` : `${s}s`
}

/** Backtick-quote a Cypher identifier (label / relationship type), escaping backticks. */
function quoteIdentifier(ident: string): string {
  return `\`${ident.replace(/`/g, '``')}\``
}

/** Coerce a Neo4j Integer / number value to a JS number (undefined-safe). */
function intToNumber(value: unknown): number | undefined {
  if (value == null) return undefined
  if (neo4j.isInt(value)) {
    const int = value as Integer
    return neo4j.integer.inSafeRange(int) ? int.toNumber() : Number(int.toString())
  }
  return typeof value === 'number' ? value : Number(value)
}

// ── Public adapter API ───────────────────────────────────────────────────────────

export async function testConnection(
  connection: Neo4jConnection,
): Promise<{ ok: boolean; error?: string }> {
  try {
    const driver = getDriver(connection)
    await driver.verifyConnectivity({ database: databaseName(connection) })
    return { ok: true }
  } catch (err) {
    invalidateClient(connection.id)
    return { ok: false, error: (err as Error).message }
  }
}

/**
 * Destroy the cached driver for the given connection ID.
 * Called when the user updates or deletes a connection (and on test failure).
 */
export function invalidateClient(connectionId: string): void {
  const driver = driverCache.get(connectionId)
  if (!driver) return
  driverCache.delete(connectionId)
  driver.close().catch(() => { /* ignore — driver may already be gone */ })
}

// The methods below are implemented in subsequent tasks (5–11) — stubs throw
// so any premature wiring fails loudly rather than silently returning empty.

/**
 * Each Neo4j database becomes one "dataset" in the existing catalog tree shape.
 * Runs `SHOW DATABASES` against the system database. In a cluster the same
 * database name appears once per server, so results are de-duped by name and
 * the internal `system` database is hidden.
 */
export async function listDatasets(connection: Neo4jConnection): Promise<Dataset[]> {
  const driver = getDriver(connection)
  const session = driver.session({ database: 'system' })
  try {
    const result = await session.run('SHOW DATABASES')
    const seen = new Set<string>()
    const datasets: Dataset[] = []
    for (const record of result.records) {
      const name = record.get('name') as string
      if (name === 'system' || seen.has(name)) continue
      seen.add(name)
      datasets.push({ id: name, projectId: connection.uri, name })
    }
    return datasets
  } catch {
    // Older Neo4j (no multi-db) or insufficient privileges — fall back to the configured DB
    const fallback = databaseName(connection)
    return [{ id: fallback, projectId: connection.uri, name: fallback }]
  } finally {
    await session.close().catch(() => {})
  }
}

export async function listTables(_connection: Neo4jConnection, _datasetId: string): Promise<Table[]> {
  throw new Error('Not implemented (Task 6)')
}

export async function getTableSchema(
  _connection: Neo4jConnection,
  _datasetId: string,
  _tableId: string,
): Promise<TableField[]> {
  throw new Error('Not implemented (Task 7)')
}

export async function searchTables(
  _connection: Neo4jConnection,
  _query: string,
  _limit: number,
): Promise<TableSearchHit[]> {
  throw new Error('Not implemented (Task 8)')
}

export async function runQuery(
  _connection: Neo4jConnection,
  _cypher: string,
  _tabId: string,
  _webContents: WebContents,
): Promise<QueryResult> {
  throw new Error('Not implemented (Task 9)')
}

export async function getQueryPage(_tabId: string, _pageToken: string): Promise<QueryResult> {
  throw new Error('Not implemented (Task 10)')
}

export async function cancelRunningQuery(_tabId: string): Promise<void> {
  throw new Error('Not implemented (Task 10)')
}

export async function dryRunQuery(
  _connection: Neo4jConnection,
  _cypher: string,
): Promise<{ bytesProcessed: number; plan?: string; planFormat?: 'text' | 'json' }> {
  throw new Error('Not implemented (Task 11)')
}

// Re-export internals so subsequent tasks can extend the file in-place.
// These are deliberately not in the public adapter contract.
export const _internal = {
  driverCache,
  getDriver,
  databaseName,
  elapsed,
  quoteIdentifier,
  intToNumber,
  QUERY_TIMEOUT_MS,
  HEARTBEAT_INTERVAL_MS,
  DEFAULT_PAGE_SIZE,
  SCHEMA_SAMPLE_SIZE,
}

// Reference the unused (yet) value-class types so TS doesn't complain about
// the imports; they'll be used by the serialization helpers in Task 9.
export type _Neo4jTypes = {
  Node: Node
  Relationship: Relationship
  Path: Path
  Neo4jNode: Neo4jNode
  Neo4jRelationship: Neo4jRelationship
  Neo4jPath: Neo4jPath
  Session: Session
  CHANNELS: typeof CHANNELS
}
