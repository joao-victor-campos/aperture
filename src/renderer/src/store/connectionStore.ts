import { create } from 'zustand'
import { CHANNELS } from '@shared/ipc'
import type { Connection, ConnectionCreate } from '@shared/types'

export type ConnectionStatus = 'unknown' | 'ok' | 'error'

interface ConnectionState {
  connections: Connection[]
  activeConnectionId: string | null
  isLoading: boolean
  /** Health-check status per connection id. Absent = 'unknown'. */
  statuses: Record<string, ConnectionStatus>
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
  statuses: {},

  load: async () => {
    set({ isLoading: true })
    const connections = await window.api.invoke(CHANNELS.CONNECTIONS_LIST)
    set({ connections, isLoading: false })
    if (connections.length > 0 && !get().activeConnectionId) {
      set({ activeConnectionId: connections[0].id })
    }
    // Background health checks — non-blocking, results trickle in as dots.
    // Wrapped in Promise.resolve() so test stubs that return undefined don't throw.
    connections.forEach((conn) => {
      Promise.resolve(window.api.invoke(CHANNELS.CONNECTIONS_TEST, conn.id))
        .then((result: { ok: boolean; error?: string } | undefined) => {
          set((s) => ({
            statuses: { ...s.statuses, [conn.id]: result?.ok ? 'ok' : 'error' },
          }))
        })
        .catch(() => {
          set((s) => ({
            statuses: { ...s.statuses, [conn.id]: 'error' },
          }))
        })
    })
  },

  add: async (conn) => {
    const newConn = await window.api.invoke(CHANNELS.CONNECTIONS_ADD, conn)
    set((s) => ({
      connections: [...s.connections, newConn],
      activeConnectionId: s.activeConnectionId ?? newConn.id,
    }))
    return newConn
  },

  update: async (conn) => {
    const updated = await window.api.invoke(CHANNELS.CONNECTIONS_UPDATE, conn)
    set((s) => ({
      connections: s.connections.map((c) => (c.id === updated.id ? updated : c)),
      // Reset status so the badge reflects the updated credentials
      statuses: { ...s.statuses, [updated.id]: 'unknown' },
    }))
  },

  remove: async (id) => {
    await window.api.invoke(CHANNELS.CONNECTIONS_DELETE, id)
    set((s) => {
      const newStatuses = { ...s.statuses }
      delete newStatuses[id]
      return {
        connections: s.connections.filter((c) => c.id !== id),
        activeConnectionId: s.activeConnectionId === id ? null : s.activeConnectionId,
        statuses: newStatuses,
      }
    })
  },

  setActive: (id) => set({ activeConnectionId: id }),

  test: async (id) => {
    const result = await window.api.invoke(CHANNELS.CONNECTIONS_TEST, id)
    set((s) => ({
      statuses: { ...s.statuses, [id]: result.ok ? 'ok' : 'error' },
    }))
    return result
  },
}))
