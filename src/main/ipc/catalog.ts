import { ipcMain } from 'electron'
import { CHANNELS } from '../../shared/ipc'
import { store } from '../db/store'
import { getAdapterForConnection } from '../db/adapterRegistry'

export function registerCatalogHandlers(): void {
  ipcMain.handle(CHANNELS.CATALOG_DATASETS, async (_event, connectionId: string) => {
    const conn = store.get('connections').find((c) => c.id === connectionId)
    if (!conn) throw new Error(`Connection not found: ${connectionId}`)
    return getAdapterForConnection(conn).listDatasets(conn)
  })

  ipcMain.handle(
    CHANNELS.CATALOG_TABLES,
    async (_event, req: { connectionId: string; datasetId: string }) => {
      const conn = store.get('connections').find((c) => c.id === req.connectionId)
      if (!conn) throw new Error(`Connection not found: ${req.connectionId}`)
      return getAdapterForConnection(conn).listTables(conn, req.datasetId)
    }
  )

  ipcMain.handle(
    CHANNELS.CATALOG_TABLE_SCHEMA,
    async (
      _event,
      req: { connectionId: string; projectId: string; datasetId: string; tableId: string }
    ) => {
      const conn = store.get('connections').find((c) => c.id === req.connectionId)
      if (!conn) throw new Error(`Connection not found: ${req.connectionId}`)
      return getAdapterForConnection(conn).getTableSchema(conn, req.datasetId, req.tableId)
    }
  )
}
