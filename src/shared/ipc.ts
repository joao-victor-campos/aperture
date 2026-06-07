import type { Connection, ConnectionCreate, Dataset, Table, TableField, TableSearchHit, QueryResult, SavedQuery, Folder, HistoryEntry, Theme, ThemeImportPayload } from './types'

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
  CATALOG_SEARCH_TABLES: 'catalog:search-tables',
  // Query
  QUERY_EXECUTE: 'query:execute',
  QUERY_GET_PAGE: 'query:get-page',
  QUERY_CANCEL: 'query:cancel',
  QUERY_DRY_RUN: 'query:dry-run',
  // Push event: main → renderer (not request/response — use window.api.on to listen)
  QUERY_LOG: 'query:log',
  // Saved queries
  SAVED_QUERY_LIST: 'saved-query:list',
  SAVED_QUERY_SAVE: 'saved-query:save',
  SAVED_QUERY_UPDATE: 'saved-query:update',
  SAVED_QUERY_DELETE: 'saved-query:delete',
  // Folders
  FOLDER_LIST: 'folder:list',
  FOLDER_CREATE: 'folder:create',
  FOLDER_UPDATE: 'folder:update',
  FOLDER_DELETE: 'folder:delete',
  // History
  HISTORY_LIST: 'history:list',
  HISTORY_CLEAR: 'history:clear',
  // Export
  EXPORT_RESULTS: 'export:results',
  // Themes
  THEMES_LIST: 'themes:list',
  THEMES_OPEN_FILE_DIALOG: 'themes:open-file-dialog',
  THEMES_ADD: 'themes:add',
  THEMES_REMOVE: 'themes:remove',
  THEMES_SET_ACTIVE: 'themes:set-active',
} as const

export type Channel = (typeof CHANNELS)[keyof typeof CHANNELS]

export interface IpcMap {
  [CHANNELS.CONNECTIONS_LIST]: { req: undefined; res: Connection[] }
  [CHANNELS.CONNECTIONS_ADD]: { req: ConnectionCreate; res: Connection }
  [CHANNELS.CONNECTIONS_UPDATE]: { req: Connection; res: Connection }
  [CHANNELS.CONNECTIONS_DELETE]: { req: string; res: void }
  [CHANNELS.CONNECTIONS_TEST]: { req: string; res: { ok: boolean; error?: string } }
  [CHANNELS.CATALOG_DATASETS]: { req: string; res: Dataset[] }
  [CHANNELS.CATALOG_TABLES]: { req: { connectionId: string; datasetId: string }; res: Table[] }
  [CHANNELS.CATALOG_TABLE_SCHEMA]: {
    req: { connectionId: string; projectId: string; datasetId: string; tableId: string }
    res: TableField[]
  }
  [CHANNELS.CATALOG_SEARCH_TABLES]: {
    req: { connectionId: string; query: string; limit?: number }
    res: TableSearchHit[]
  }
  [CHANNELS.QUERY_EXECUTE]: {
    req: { connectionId: string; sql: string; tabId: string }
    res: QueryResult
  }
  [CHANNELS.QUERY_GET_PAGE]: {
    req: { tabId: string; pageToken: string }
    res: QueryResult
  }
  [CHANNELS.QUERY_CANCEL]: { req: string; res: void }
  [CHANNELS.QUERY_DRY_RUN]: {
    req: { connectionId: string; sql: string }
    res: { bytesProcessed: number; plan?: string; planFormat?: 'text' | 'json' }
  }
  [CHANNELS.SAVED_QUERY_LIST]: { req: undefined; res: SavedQuery[] }
  [CHANNELS.SAVED_QUERY_SAVE]: {
    req: Omit<SavedQuery, 'id' | 'createdAt' | 'updatedAt'>
    res: SavedQuery
  }
  [CHANNELS.SAVED_QUERY_UPDATE]: { req: SavedQuery; res: SavedQuery }
  [CHANNELS.SAVED_QUERY_DELETE]: { req: string; res: void }
  [CHANNELS.FOLDER_LIST]: { req: undefined; res: Folder[] }
  [CHANNELS.FOLDER_CREATE]: { req: Omit<Folder, 'id' | 'createdAt'>; res: Folder }
  [CHANNELS.FOLDER_UPDATE]: { req: Folder; res: Folder }
  [CHANNELS.FOLDER_DELETE]: { req: string; res: void }
  [CHANNELS.HISTORY_LIST]: { req: undefined; res: HistoryEntry[] }
  [CHANNELS.HISTORY_CLEAR]: { req: undefined; res: void }
  [CHANNELS.EXPORT_RESULTS]: {
    req: { rows: Record<string, unknown>[]; columns: string[]; format: 'csv' | 'json' | 'tsv' }
    res: { path: string | null }
  }
  [CHANNELS.THEMES_LIST]: {
    req: undefined
    res: { themes: Theme[]; activeThemeId: string | null }
  }
  [CHANNELS.THEMES_OPEN_FILE_DIALOG]: {
    req: undefined
    res: ThemeImportPayload | { error: string } | null
  }
  [CHANNELS.THEMES_ADD]: { req: ThemeImportPayload; res: Theme }
  [CHANNELS.THEMES_REMOVE]: { req: string; res: void }
  [CHANNELS.THEMES_SET_ACTIVE]: { req: string | null; res: void }
}

// Channel is a superset of IpcMap keys (QUERY_LOG is push-only, not request/response).
// Constrain to keyof IpcMap so the index is always valid.
export type IpcRequest<C extends keyof IpcMap> = IpcMap[C]['req']
export type IpcResponse<C extends keyof IpcMap> = IpcMap[C]['res']
