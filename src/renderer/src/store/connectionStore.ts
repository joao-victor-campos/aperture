import { create } from 'zustand'
import { CHANNELS } from '@shared/ipc'
import type { Connection, ConnectionCreate } from '@shared/types'

interface ConnectionState {
  connections: Connection[]
  activeConnectionId: string | null
  isLoading: boolean
  load: () => Promise<void>
  add: (conn: ConnectionCreate) => Promise<Connection>
  update: (conn: Connection) => Promise<void>
  remove: (id: string) => Promise<void>
  setActive: (id: string) => void
  test: (id: string) => Promise<{ ok: boolean; error?: string }>
}

export const useConnectionStore = create<ConnectionState>((set, get) => ({
  connections: [],
  activeConnectionId: null,
  isLoading: false,

  load: async () => {
    set({ isLoading: true })
    const connections = await window.api.invoke(CHANNELS.CONNECTIONS_LIST)
    set({ connections, isLoading: false })
    if (connections.length > 0 && !get().activeConnectionId) {
      set({ activeConnectionId: connections[0].id })
    }
  },

  add: async (conn) => {
    const newConn = await window.api.invoke(CHANNELS.CONNECTIONS_ADD, conn)
    set((s) => ({
      connections: [...s.connections, newConn],
      activeConnectionId: s.activeConnectionId ?? newConn.id
    }))
    return newConn
  },

  update: async (conn) => {
    const updated = await window.api.invoke(CHANNELS.CONNECTIONS_UPDATE, conn)
    set((s) => ({
      connections: s.connections.map((c) => (c.id === updated.id ? updated : c))
    }))
  },

  remove: async (id) => {
    await window.api.invoke(CHANNELS.CONNECTIONS_DELETE, id)
    set((s) => ({
      connections: s.connections.filter((c) => c.id !== id),
      activeConnectionId: s.activeConnectionId === id ? null : s.activeConnectionId
    }))
  },

  setActive: (id) => set({ activeConnectionId: id }),

  test: (id) => window.api.invoke(CHANNELS.CONNECTIONS_TEST, id)
}))
