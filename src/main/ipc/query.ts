import { ipcMain } from 'electron'
import { CHANNELS } from '../../shared/ipc'
import { store } from '../db/store'
import { runQuery, getQueryPage, cancelRunningQuery, dryRunQuery } from '../db/bigquery'

export function registerQueryHandlers(): void {
  ipcMain.handle(
    CHANNELS.QUERY_EXECUTE,
    async (event, req: { connectionId: string; sql: string; tabId: string }) => {
      const conn = store.get('connections').find((c) => c.id === req.connectionId)
      if (!conn) throw new Error(`Connection not found: ${req.connectionId}`)
      return runQuery(conn, req.sql, req.tabId, event.sender)
    }
  )

  ipcMain.handle(
    CHANNELS.QUERY_GET_PAGE,
    async (_event, req: { tabId: string; pageToken: string }) => {
      return getQueryPage(req.tabId, req.pageToken)
    }
  )

  ipcMain.handle(CHANNELS.QUERY_CANCEL, async (_event, tabId: string) => {
    await cancelRunningQuery(tabId)
  })

  ipcMain.handle(
    CHANNELS.QUERY_DRY_RUN,
    async (_event, req: { connectionId: string; sql: string }) => {
      const conn = store.get('connections').find((c) => c.id === req.connectionId)
      if (!conn) throw new Error(`Connection not found: ${req.connectionId}`)
      return dryRunQuery(conn, req.sql)
    }
  )
}
