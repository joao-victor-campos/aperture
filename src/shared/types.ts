export type ConnectionEngine = 'bigquery' | 'postgres' | 'snowflake' | 'neo4j'

interface ConnectionBase {
  id: string
  name: string
  createdAt: string
  engine: ConnectionEngine
}

export interface BigQueryConnection extends ConnectionBase {
  engine: 'bigquery'
  projectId: string
  credentialType: 'adc' | 'service-account'
  serviceAccountPath?: string
}

export interface PostgresConnection extends ConnectionBase {
  engine: 'postgres'
  host: string
  port: number
  database: string
  user: string
  password: string
}

export interface SnowflakeConnection extends ConnectionBase {
  engine: 'snowflake'
  /** Account identifier, e.g. "xy12345.us-east-1" or "orgname-accountname" */
  account: string
  username: string
  password: string
  /** Warehouse to use for compute, e.g. "COMPUTE_WH" */
  warehouse: string
  /** Optional default database to scope the catalog browser */
  database?: string
  /** Optional default schema */
  schema?: string
  /** Optional role override */
  role?: string
}

export interface Neo4jConnection extends ConnectionBase {
  engine: 'neo4j'
  /** Bolt URI, e.g. "neo4j://localhost:7687" or "neo4j+s://xxxx.databases.neo4j.io" */
  uri: string
  username: string
  password: string
  /** Optional default database (Neo4j 4.0+ multi-database); defaults to "neo4j" */
  database?: string
}

export type Connection = BigQueryConnection | PostgresConnection | SnowflakeConnection | Neo4jConnection

export type ConnectionCreate =
  | Omit<BigQueryConnection, 'id' | 'createdAt'>
  | Omit<PostgresConnection, 'id' | 'createdAt'>
  | Omit<SnowflakeConnection, 'id' | 'createdAt'>
  | Omit<Neo4jConnection, 'id' | 'createdAt'>

export interface Dataset {
  id: string
  projectId: string
  name: string
  location?: string
  description?: string
}

export interface TableField {
  name: string
  type: string
  mode: 'NULLABLE' | 'REQUIRED' | 'REPEATED'
  description?: string
  fields?: TableField[]
}

/** Result row of a catalog-wide table search (no full schema metadata). */
export interface TableSearchHit {
  datasetId: string
  tableId: string
  name: string
  type: 'TABLE' | 'VIEW' | 'LABEL' | 'RELATIONSHIP_TYPE'
}

export interface Table {
  id: string
  datasetId: string
  projectId: string
  name: string
  type: 'TABLE' | 'VIEW' | 'MATERIALIZED_VIEW' | 'EXTERNAL' | 'LABEL' | 'RELATIONSHIP_TYPE'
  description?: string
  rowCount?: number
  sizeBytes?: number
  schema?: TableField[]
}

export interface QueryResult {
  columns: string[]
  rows: Record<string, unknown>[]
  rowCount: number
  executionTimeMs: number
  bytesProcessed?: number
  /** Total rows produced by the query (from BigQuery metadata) */
  totalRows?: number
  /** Opaque token for fetching the next page of results */
  pageToken?: string | null
  /** True when more pages exist */
  hasMore?: boolean
}

/**
 * Neo4j graph values, serialized for IPC transport. The Bolt driver returns
 * class instances (Node/Relationship/Path) that can't cross the structured-clone
 * boundary, so the adapter converts them to these plain, `__neo4jType`-tagged
 * objects. `identity`/`start`/`end` hold Neo4j element IDs (stable strings).
 */
export interface Neo4jNode {
  __neo4jType: 'Node'
  identity: string
  labels: string[]
  properties: Record<string, unknown>
}

export interface Neo4jRelationship {
  __neo4jType: 'Relationship'
  identity: string
  start: string
  end: string
  type: string
  properties: Record<string, unknown>
}

export interface Neo4jPath {
  __neo4jType: 'Path'
  segments: { start: Neo4jNode; relationship: Neo4jRelationship; end: Neo4jNode }[]
}

export type Neo4jGraphValue = Neo4jNode | Neo4jRelationship | Neo4jPath

/**
 * Rendering-side graph types — what react-force-graph-2d expects.
 * Distinct from the wire types (Neo4jNode/Relationship/Path) which are tagged
 * for the IPC boundary. `buildGraphFromRecords` converts wire → rendering.
 */
export interface GraphNode {
  /** Neo4j element ID — also the force-graph node id */
  id: string
  /** First label, used to seed color; '(unknown)' for orphan endpoints */
  primaryLabel: string
  /** All labels — shown in the inspector */
  labels: string[]
  properties: Record<string, unknown>
}

export interface GraphLink {
  /** Neo4j relationship element ID */
  id: string
  /** Source node id — must match a GraphNode.id */
  source: string
  /** Target node id — must match a GraphNode.id */
  target: string
  type: string
  properties: Record<string, unknown>
}

export interface GraphData {
  nodes: GraphNode[]
  links: GraphLink[]
}

/** State for one side of a split-pane view (right pane). */
export interface QueryPane {
  sql: string
  result?: QueryResult
  error?: string
  isRunning: boolean
  cancelled?: boolean
  logs: string[]
}

export interface QueryTab {
  id: string
  /** 'query' (default), 'table' (catalog inspection tab), or 'result' (pinned snapshot) */
  type?: 'query' | 'table' | 'result'
  title: string
  sql: string
  connectionId?: string
  /** Populated when type === 'table' */
  tableRef?: { engine: ConnectionEngine; projectId: string; datasetId: string; tableId: string }
  result?: QueryResult
  error?: string
  isRunning: boolean
  cancelled?: boolean
  logs: string[]
  savedQueryId?: string
  /** Present when split-pane mode is active for this tab */
  rightPane?: QueryPane
  /** Explain plan / dry-run result (shown in ExplainPanel) */
  explainResult?: { bytesProcessed: number; plan?: string; planFormat?: 'text' | 'json' }
  isExplaining?: boolean
  /** When true, the graph view replaces the results table for this tab. */
  viewAsGraph?: boolean
}

export interface SavedQuery {
  id: string
  folderId: string | null
  title: string
  sql: string
  connectionId?: string
  createdAt: string
  updatedAt: string
}

export interface Folder {
  id: string
  parentId: string | null
  name: string
  createdAt: string
}

export interface HistoryEntry {
  id: string
  sql: string
  connectionId: string
  connectionName: string
  executedAt: string
  durationMs: number
  rowCount: number
}

/**
 * An imported Base16 colour theme. Persisted via the main store.
 * `base` is a map of Base16 slot keys ("base00"–"base0F") to lowercase
 * hex strings without a leading `#`.
 */
export interface Theme {
  id: string
  name: string
  author?: string
  base: Record<string, string>
  importedAt: string
}

/** Validated Base16 payload returned from the file-dialog IPC. */
export interface ThemeImportPayload {
  scheme: string
  author?: string
  base: Record<string, string>
}
