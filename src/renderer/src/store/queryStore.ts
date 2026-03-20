import { create } from 'zustand'
import { CHANNELS } from '@shared/ipc'
import type { QueryTab, QueryResult } from '@shared/types'

interface QueryState {
  tabs: QueryTab[]
  activeTabId: string | null
  openTab: (partial?: Partial<Omit<QueryTab, 'id' | 'isRunning' | 'logs'>>) => string
  openTableTab: (
    connectionId: string,
    projectId: string,
    datasetId: string,
    tableId: string,
    tableName: string
  ) => void
  closeTab: (id: string) => void
  setActiveTab: (id: string) => void
  updateTabSql: (id: string, sql: string) => void
  runQuery: (id: string) => Promise<void>
  cancelQuery: (id: string) => Promise<void>
  fetchPage: (id: string) => Promise<void>
  reorderTabs: (fromId: string, toId: string) => void
}

export const useQueryStore = create<QueryState>((set, get) => ({
  tabs: [],
  activeTabId: null,

  openTab: (partial = {}) => {
    const id = crypto.randomUUID()
    const tab: QueryTab = { id, title: 'Untitled', sql: '', isRunning: false, logs: [], ...partial }
    set((s) => ({ tabs: [...s.tabs, tab], activeTabId: id }))
    return id
  },

  openTableTab: (connectionId, projectId, datasetId, tableId, tableName) => {
    const { tabs } = get()
    // If a table tab for this exact table already exists, just focus it
    const existing = tabs.find(
      (t) => t.type === 'table' && t.tableRef?.tableId === tableId && t.tableRef?.datasetId === datasetId
    )
    if (existing) {
      set({ activeTabId: existing.id })
      return
    }
    const id = crypto.randomUUID()
    const tab: QueryTab = {
      id,
      type: 'table',
      title: tableName,
      sql: '',
      connectionId,
      tableRef: { projectId, datasetId, tableId },
      isRunning: false,
      logs: []
    }
    set((s) => ({ tabs: [...s.tabs, tab], activeTabId: id }))
  },

  closeTab: (id) => {
    set((s) => {
      const tabs = s.tabs.filter((t) => t.id !== id)
      const activeTabId =
        s.activeTabId === id ? (tabs[tabs.length - 1]?.id ?? null) : s.activeTabId
      return { tabs, activeTabId }
    })
  },

  setActiveTab: (id) => set({ activeTabId: id }),

  updateTabSql: (id, sql) => {
    set((s) => ({ tabs: s.tabs.map((t) => (t.id === id ? { ...t, sql } : t)) }))
  },

  runQuery: async (id) => {
    const tab = get().tabs.find((t) => t.id === id)
    if (!tab || !tab.connectionId || !tab.sql.trim()) return

    set((s) => ({
      tabs: s.tabs.map((t) =>
        t.id === id
          ? { ...t, isRunning: true, cancelled: false, error: undefined, result: undefined, logs: [] }
          : t
      )
    }))

    try {
      const result: QueryResult = await window.api.invoke(CHANNELS.QUERY_EXECUTE, {
        connectionId: tab.connectionId,
        sql: tab.sql,
        tabId: id
      })
      set((s) => ({
        tabs: s.tabs.map((t) => (t.id === id ? { ...t, isRunning: false, result } : t))
      }))
    } catch (err) {
      set((s) => {
        const currentTab = s.tabs.find((t) => t.id === id)
        return {
          tabs: s.tabs.map((t) =>
            t.id === id
              ? {
                  ...t,
                  isRunning: false,
                  // Don't show error text if the user explicitly cancelled
                  error: currentTab?.cancelled ? undefined : (err as Error).message
                }
              : t
          )
        }
      })
    }
  },

  cancelQuery: async (id) => {
    // Mark as cancelled first so the error handler knows to suppress the error message
    set((s) => ({
      tabs: s.tabs.map((t) => (t.id === id ? { ...t, cancelled: true } : t))
    }))
    await window.api.invoke(CHANNELS.QUERY_CANCEL, id)
  },

  reorderTabs: (fromId, toId) => {
    if (fromId === toId) return
    set((s) => {
      const tabs = [...s.tabs]
      const fromIdx = tabs.findIndex((t) => t.id === fromId)
      const toIdx = tabs.findIndex((t) => t.id === toId)
      if (fromIdx === -1 || toIdx === -1) return s
      const [moved] = tabs.splice(fromIdx, 1)
      tabs.splice(toIdx, 0, moved)
      return { tabs }
    })
  },

  fetchPage: async (id) => {
    const tab = get().tabs.find((t) => t.id === id)
    if (!tab?.result?.pageToken) return

    try {
      const page: QueryResult = await window.api.invoke(CHANNELS.QUERY_GET_PAGE, {
        tabId: id,
        pageToken: tab.result.pageToken
      })
      set((s) => ({
        tabs: s.tabs.map((t) => {
          if (t.id !== id || !t.result) return t
          return {
            ...t,
            result: {
              ...t.result,
              rows: [...t.result.rows, ...page.rows],
              rowCount: t.result.rows.length + page.rows.length,
              pageToken: page.pageToken,
              hasMore: page.hasMore,
              totalRows: page.totalRows ?? t.result.totalRows
            }
          }
        })
      }))
    } catch (err) {
      // Silently ignore page fetch errors — user can retry
      console.error('Failed to fetch page:', err)
    }
  }
}))

// ── Global QUERY_LOG push listener ──────────────────────────────────────────
// Main process sends { tabId, message } whenever query state changes.
// We append a timestamped line to the matching tab's logs.
window.api.on(CHANNELS.QUERY_LOG, (data: unknown) => {
  const { tabId, message } = data as { tabId: string; message: string }
  const now = new Date()
  const ts = `${String(now.getHours()).padStart(2, '0')}:${String(now.getMinutes()).padStart(2, '0')}:${String(now.getSeconds()).padStart(2, '0')}`
  useQueryStore.setState((s) => ({
    tabs: s.tabs.map((t) =>
      t.id === tabId ? { ...t, logs: [...t.logs, `${ts}  ${message}`] } : t
    )
  }))
})
