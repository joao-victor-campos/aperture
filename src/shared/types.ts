export type ConnectionEngine = 'bigquery' | 'postgres' | 'snowflake'

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

export type Connection = BigQueryConnection | PostgresConnection | SnowflakeConnection

export type ConnectionCreate =
  | Omit<BigQueryConnection, 'id' | 'createdAt'>
  | Omit<PostgresConnection, 'id' | 'createdAt'>
  | Omit<SnowflakeConnection, 'id' | 'createdAt'>

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

export interface Table {
  id: string
  datasetId: string
  projectId: string
  name: string
  type: 'TABLE' | 'VIEW' | 'MATERIALIZED_VIEW' | 'EXTERNAL'
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

export interface QueryTab {
  id: string
  /** 'query' (default) or 'table' (catalog inspection tab) */
  type?: 'query' | 'table'
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
