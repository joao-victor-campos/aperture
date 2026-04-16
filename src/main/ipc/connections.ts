import { ipcMain } from 'electron'
import { randomUUID } from 'crypto'
import { CHANNELS } from '../../shared/ipc'
import type { Connection, ConnectionCreate } from '../../shared/types'
import { store } from '../db/store'
import { getAdapterForConnection, getAdapterForEngine } from '../db/adapterRegistry'

export function registerConnectionHandlers(): void {
  ipcMain.handle(CHANNELS.CONNECTIONS_LIST, async () => {
    return store.get('connections')
  })

  ipcMain.handle(
    CHANNELS.CONNECTIONS_ADD,
    async (_event, req: ConnectionCreate) => {
      const connections = store.get('connections')
      const newConn: Connection = {
        ...req,
        id: randomUUID(),
        createdAt: new Date().toISOString()
      }
      store.set('connections', [...connections, newConn])
      return newConn
    }
  )

  ipcMain.handle(CHANNELS.CONNECTIONS_UPDATE, async (_event, req: Connection) => {
    const connections = store.get('connections')
    getAdapterForEngine(req.engine ?? 'bigquery').invalidateClient(req.id)
    store.set(
      'connections',
      connections.map((c) => (c.id === req.id ? req : c))
    )
    return req
  })

  ipcMain.handle(CHANNELS.CONNECTIONS_DELETE, async (_event, id: string) => {
    const connections = store.get('connections')
    const conn = connections.find((c) => c.id === id)
    if (conn) getAdapterForEngine(conn.engine ?? 'bigquery').invalidateClient(id)
    store.set(
      'connections',
      connections.filter((c) => c.id !== id)
    )
  })

  ipcMain.handle(CHANNELS.CONNECTIONS_TEST, async (_event, id: string) => {
    const conn = store.get('connections').find((c) => c.id === id)
    if (!conn) return { ok: false, error: 'Connection not found' }
    return getAdapterForConnection(conn).testConnection(conn)
  })
}
