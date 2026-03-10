export interface Connection {
  id: string
  name: string
  projectId: string
  credentialType: 'adc' | 'service-account'
  serviceAccountPath?: string
  createdAt: string
}

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
}

export interface QueryTab {
  id: string
  /** 'query' (default) or 'table' (catalog inspection tab) */
  type?: 'query' | 'table'
  title: string
  sql: string
  connectionId?: string
  /** Populated when type === 'table' */
  tableRef?: { projectId: string; datasetId: string; tableId: string }
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
