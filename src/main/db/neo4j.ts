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

function countNodes(session: Session, label: string): Promise<number | undefined> {
  return session
    .run(`MATCH (n:${quoteIdentifier(label)}) RETURN count(n) AS count`)
    .then((r) => intToNumber(r.records[0]?.get('count')))
    .catch(() => undefined)
}

function countRelationships(session: Session, relType: string): Promise<number | undefined> {
  return session
    .run(`MATCH ()-[r:${quoteIdentifier(relType)}]->() RETURN count(r) AS count`)
    .then((r) => intToNumber(r.records[0]?.get('count')))
    .catch(() => undefined)
}

/**
 * "Tables" in a Neo4j database are its node labels and relationship types.
 * Each is tagged with a `type` discriminator ('LABEL' | 'RELATIONSHIP_TYPE')
 * so the catalog tree can group them under two section headers, and carries a
 * cheap count (cached upstream the same way relational table-counts are).
 */
export async function listTables(connection: Neo4jConnection, datasetId: string): Promise<Table[]> {
  const driver = getDriver(connection)
  const session = driver.session({ database: datasetId })
  try {
    const [labelResult, relResult] = await Promise.all([
      session.run('CALL db.labels()').catch(() => null),
      session.run('CALL db.relationshipTypes()').catch(() => null),
    ])
    const labels = labelResult ? labelResult.records.map((r) => r.get('label') as string) : []
    const relTypes = relResult ? relResult.records.map((r) => r.get('relationshipType') as string) : []

    const labelTables = await Promise.all(
      labels.map(async (label) => ({
        id: label,
        datasetId,
        projectId: connection.uri,
        name: label,
        type: 'LABEL' as const,
        rowCount: await countNodes(session, label),
      } satisfies Table)),
    )
    const relTables = await Promise.all(
      relTypes.map(async (relType) => ({
        id: relType,
        datasetId,
        projectId: connection.uri,
        name: relType,
        type: 'RELATIONSHIP_TYPE' as const,
        rowCount: await countRelationships(session, relType),
      } satisfies Table)),
    )
    return [...labelTables, ...relTables]
  } finally {
    await session.close().catch(() => {})
  }
}

/** Map a raw Neo4j property value to a type name the schema UI already color-codes. */
function inferPropertyType(value: unknown): string {
  if (value == null) return 'STRING'
  if (neo4j.isInt(value)) return 'INTEGER'
  if (typeof value === 'number') return Number.isInteger(value) ? 'INTEGER' : 'FLOAT'
  if (typeof value === 'boolean') return 'BOOLEAN'
  if (typeof value === 'string') return 'STRING'
  if (Array.isArray(value)) return 'LIST'
  if (typeof value === 'object') {
    const ctor = (value as object).constructor?.name ?? ''
    if (ctor.includes('DateTime')) return 'TIMESTAMP'
    if (ctor.includes('Date')) return 'DATE'
    if (ctor.includes('Time')) return 'TIME'
    return 'STRING' // Duration, Point, and any other temporal/spatial type
  }
  return 'STRING'
}

/**
 * Neo4j is schema-optional, so there is no authoritative schema to read. This
 * samples up to SCHEMA_SAMPLE_SIZE nodes (or relationships) and reports the union
 * of observed property keys, with the first observed type winning per key. The
 * "Schema" tab frames this as sample-inferred (see TableDetailPanel banner).
 */
export async function getTableSchema(
  connection: Neo4jConnection,
  datasetId: string,
  tableId: string,
): Promise<TableField[]> {
  const driver = getDriver(connection)
  const session = driver.session({ database: datasetId })
  try {
    const relResult = await session.run('CALL db.relationshipTypes()').catch(() => null)
    const relTypes = relResult ? relResult.records.map((r) => r.get('relationshipType') as string) : []
    const isRel = relTypes.includes(tableId)

    const cypher = isRel
      ? `MATCH ()-[r:${quoteIdentifier(tableId)}]->() RETURN r AS sample LIMIT ${SCHEMA_SAMPLE_SIZE}`
      : `MATCH (n:${quoteIdentifier(tableId)}) RETURN n AS sample LIMIT ${SCHEMA_SAMPLE_SIZE}`

    const result = await session.run(cypher)
    const propTypes = new Map<string, string>()
    for (const record of result.records) {
      const entity = record.get('sample') as { properties?: Record<string, unknown> } | null
      const props = entity?.properties ?? {}
      for (const [key, value] of Object.entries(props)) {
        if (!propTypes.has(key)) propTypes.set(key, inferPropertyType(value))
      }
    }
    return Array.from(propTypes.entries()).map(([name, type]) => ({
      name,
      type,
      mode: 'NULLABLE' as const,
    } satisfies TableField))
  } finally {
    await session.close().catch(() => {})
  }
}

/**
 * Catalog-wide substring search powering ⌘K. Walks every database's labels and
 * relationship types, matching their names case-insensitively against the query.
 */
export async function searchTables(
  connection: Neo4jConnection,
  query: string,
  limit: number,
): Promise<TableSearchHit[]> {
  const driver = getDriver(connection)
  const datasets = await listDatasets(connection)
  const lower = query.toLowerCase()
  const hits: TableSearchHit[] = []

  for (const ds of datasets) {
    if (hits.length >= limit) break
    const session = driver.session({ database: ds.id })
    try {
      const [labelResult, relResult] = await Promise.all([
        session.run('CALL db.labels()').catch(() => null),
        session.run('CALL db.relationshipTypes()').catch(() => null),
      ])
      const labels = labelResult ? labelResult.records.map((r) => r.get('label') as string) : []
      const relTypes = relResult ? relResult.records.map((r) => r.get('relationshipType') as string) : []
      for (const label of labels) {
        if (label.toLowerCase().includes(lower)) {
          hits.push({ datasetId: ds.id, tableId: label, name: label, type: 'LABEL' })
        }
      }
      for (const relType of relTypes) {
        if (relType.toLowerCase().includes(lower)) {
          hits.push({ datasetId: ds.id, tableId: relType, name: relType, type: 'RELATIONSHIP_TYPE' })
        }
      }
    } finally {
      await session.close().catch(() => {})
    }
  }
  return hits.slice(0, limit)
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
