import type { Connection, Dataset, Table, TableField, QueryResult } from './types'

export const CHANNELS = {
  // Connections
  CONNECTIONS_LIST: 'connections:list',
  CONNECTIONS_ADD: 'connections:add',
  CONNECTIONS_UPDATE: 'connections:update',
  CONNECTIONS_DELETE: 'connections:delete',
  CONNECTIONS_TEST: 'connections:test',
  // Catalog
  CATALOG_DATASETS: 'catalog:datasets',
  CATALOG_TABLES: 'catalog:tables',
  CATALOG_TABLE_SCHEMA: 'catalog:table-schema',
  // Query
  QUERY_EXECUTE: 'query:execute',
  QUERY_CANCEL: 'query:cancel',
  QUERY_DRY_RUN: 'query:dry-run',
  // Push event: main → renderer (not request/response — use window.api.on to listen)
  QUERY_LOG: 'query:log'
} as const

export type Channel = (typeof CHANNELS)[keyof typeof CHANNELS]

export interface IpcMap {
  [CHANNELS.CONNECTIONS_LIST]: { req: undefined; res: Connection[] }
  [CHANNELS.CONNECTIONS_ADD]: { req: Omit<Connection, 'id' | 'createdAt'>; res: Connection }
  [CHANNELS.CONNECTIONS_UPDATE]: { req: Connection; res: Connection }
  [CHANNELS.CONNECTIONS_DELETE]: { req: string; res: void }
  [CHANNELS.CONNECTIONS_TEST]: { req: string; res: { ok: boolean; error?: string } }
  [CHANNELS.CATALOG_DATASETS]: { req: string; res: Dataset[] }
  [CHANNELS.CATALOG_TABLES]: { req: { connectionId: string; datasetId: string }; res: Table[] }
  [CHANNELS.CATALOG_TABLE_SCHEMA]: {
    req: { connectionId: string; projectId: string; datasetId: string; tableId: string }
    res: TableField[]
  }
  [CHANNELS.QUERY_EXECUTE]: {
    req: { connectionId: string; sql: string; tabId: string }
    res: QueryResult
  }
  [CHANNELS.QUERY_CANCEL]: { req: string; res: void }
  [CHANNELS.QUERY_DRY_RUN]: {
    req: { connectionId: string; sql: string }
    res: { bytesProcessed: number }
  }
}

// Channel is a superset of IpcMap keys (QUERY_LOG is push-only, not request/response).
// Constrain to keyof IpcMap so the index is always valid.
export type IpcRequest<C extends keyof IpcMap> = IpcMap[C]['req']
export type IpcResponse<C extends keyof IpcMap> = IpcMap[C]['res']
