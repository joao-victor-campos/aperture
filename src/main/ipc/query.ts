import { ipcMain } from 'electron'
import { CHANNELS } from '../../shared/ipc'
import { store } from '../db/store'
import type { ConnectionEngine } from '../../shared/types'
import { getAdapterForConnection, getAdapterForEngine } from '../db/adapterRegistry'

// Route tab-specific pagination/cancel to the correct engine.
const tabEngines = new Map<string, ConnectionEngine>()

export function registerQueryHandlers(): void {
  ipcMain.handle(
    CHANNELS.QUERY_EXECUTE,
    async (event, req: { connectionId: string; sql: string; tabId: string }) => {
      const conn = store.get('connections').find((c) => c.id === req.connectionId)
      if (!conn) throw new Error(`Connection not found: ${req.connectionId}`)
      tabEngines.set(req.tabId, conn.engine)
      const adapter = getAdapterForConnection(conn)
      return adapter.runQuery(conn, req.sql, req.tabId, event.sender)
    }
  )

  ipcMain.handle(
    CHANNELS.QUERY_GET_PAGE,
    async (_event, req: { tabId: string; pageToken: string }) => {
      const engine = tabEngines.get(req.tabId)
      if (engine) return getAdapterForEngine(engine).getQueryPage(req.tabId, req.pageToken)
      // Fallback: try BigQuery first (previous behavior).
      return getAdapterForEngine('bigquery').getQueryPage(req.tabId, req.pageToken)
    }
  )

  ipcMain.handle(CHANNELS.QUERY_CANCEL, async (_event, tabId: string) => {
    const engine = tabEngines.get(tabId)
      if (engine) await getAdapterForEngine(engine).cancelRunningQuery(tabId)
      else await getAdapterForEngine('bigquery').cancelRunningQuery(tabId)
  })

  ipcMain.handle(
    CHANNELS.QUERY_DRY_RUN,
    async (_event, req: { connectionId: string; sql: string }) => {
      const conn = store.get('connections').find((c) => c.id === req.connectionId)
      if (!conn) throw new Error(`Connection not found: ${req.connectionId}`)
      return getAdapterForConnection(conn).dryRunQuery(conn, req.sql)
    }
  )
}
