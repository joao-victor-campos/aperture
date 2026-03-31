export type ConnectionEngine = 'bigquery' | 'postgres'

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

export type Connection = BigQueryConnection | PostgresConnection

export type ConnectionCreate =
  | Omit<BigQueryConnection, 'id' | 'createdAt'>
  | Omit<PostgresConnection, 'id' | 'createdAt'>

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
