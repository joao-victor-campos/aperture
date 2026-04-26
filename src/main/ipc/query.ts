import { ipcMain } from 'electron'
import { randomUUID } from 'node:crypto'
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
      const result = await adapter.runQuery(conn, req.sql, req.tabId, event.sender)

      // Append to query history (newest first, capped at 500)
      const history = store.get('historyEntries')
      store.set('historyEntries', [
        {
          id: randomUUID(),
          sql: req.sql,
          connectionId: req.connectionId,
          connectionName: conn.name,
          executedAt: new Date().toISOString(),
          durationMs: result.executionTimeMs,
          rowCount: result.rowCount,
        },
        ...history,
      ].slice(0, 500))

      return result
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
