import { create } from 'zustand'
import { CHANNELS } from '@shared/ipc'
import type { ConnectionEngine, QueryTab, QueryResult, ChartConfig, QueryParam } from '@shared/types'
import { extractParams } from '../lib/extractParams'

export type GroupId = 'left' | 'right'

interface QueryState {
  tabs: QueryTab[]
  /** Mirror of activeByGroup[focusedGroup] — the globally "active" tab. */
  activeTabId: string | null
  focusedGroup: GroupId
  activeByGroup: Record<GroupId, string | null>

  openTab: (partial?: Partial<Omit<QueryTab, 'id' | 'isRunning' | 'logs'>>) => string
  openResultTab: (sourceTabId: string) => void
  openTableTab: (
    connectionId: string,
    engine: ConnectionEngine,
    projectId: string,
    datasetId: string,
    tableId: string,
    tableName: string
  ) => void
  closeTab: (id: string) => void
  setActiveTab: (id: string) => void
  updateTabSql: (id: string, sql: string) => void
  setTabParams: (id: string, params: QueryParam[]) => void
  syncTabParams: (id: string) => void
  runQuery: (id: string) => Promise<void>
  cancelQuery: (id: string) => Promise<void>
  explainQuery: (id: string) => Promise<void>
  clearExplain: (id: string) => void
  fetchPage: (id: string) => Promise<void>
  toggleGraphView: (id: string) => void
  setResultView: (id: string, view: 'table' | 'chart') => void
  setChartConfig: (id: string, config: ChartConfig) => void
  // Editor groups
  focusGroup: (group: GroupId) => void
  moveTabToGroup: (tabId: string, target: GroupId, beforeId?: string) => void
  splitGroup: () => void
  setTabConnection: (tabId: string, connectionId: string) => void
}

/**
 * Recompute group invariants after any mutation to `tabs`:
 * - If the left group is empty but the right has tabs, promote right → left
 *   (a single group is always 'left').
 * - Each group's active tab must still exist in that group, else fall back to
 *   the last tab in the group (or null).
 * - The focused group must be non-empty, else fall back to 'left'.
 * - activeTabId mirrors activeByGroup[focusedGroup].
 */
function normalizeGroups(
  tabs: QueryTab[],
  focusedGroup: GroupId,
  activeByGroup: Record<GroupId, string | null>,
): Pick<QueryState, 'tabs' | 'focusedGroup' | 'activeByGroup' | 'activeTabId'> {
  let t = tabs
  let fg = focusedGroup
  let abg = activeByGroup

  const hasLeft = t.some((x) => x.groupId === 'left')
  const hasRight = t.some((x) => x.groupId === 'right')
  if (!hasLeft && hasRight) {
    t = t.map((x) => ({ ...x, groupId: 'left' as GroupId }))
    abg = { left: activeByGroup.right, right: null }
    fg = 'left'
  }

  const lastOf = (g: GroupId): string | null => {
    for (let i = t.length - 1; i >= 0; i--) if (t[i].groupId === g) return t[i].id
    return null
  }
  const validFor = (g: GroupId, id: string | null) => !!id && t.some((x) => x.id === id && x.groupId === g)

  const left = validFor('left', abg.left) ? abg.left : lastOf('left')
  const right = validFor('right', abg.right) ? abg.right : lastOf('right')
  const nextAbg: Record<GroupId, string | null> = { left, right }

  if (!t.some((x) => x.groupId === fg)) fg = 'left'

  return { tabs: t, focusedGroup: fg, activeByGroup: nextAbg, activeTabId: nextAbg[fg] }
}

/** Recompute a tab's params from its SQL, preserving existing {type,value} by name. */
function reconcileParams(sql: string, existing: QueryParam[] | undefined): QueryParam[] {
  const prev = new Map((existing ?? []).map((p) => [p.name, p]))
  return extractParams(sql).map((name) => prev.get(name) ?? { name, type: 'text', value: '' })
}

export const useQueryStore = create<QueryState>((set, get) => ({
  tabs: [],
  activeTabId: null,
  focusedGroup: 'left',
  activeByGroup: { left: null, right: null },

  openTab: (partial = {}) => {
    const id = crypto.randomUUID()
    const s = get()
    const fg = s.focusedGroup
    const inheritConn = s.tabs.find((t) => t.id === s.activeByGroup[fg])?.connectionId
    const tab: QueryTab = {
      id, title: 'Untitled', sql: '', isRunning: false, logs: [],
      groupId: fg, connectionId: inheritConn, ...partial,
    }
    set((st) => ({
      tabs: [...st.tabs, tab],
      activeByGroup: { ...st.activeByGroup, [fg]: id },
      activeTabId: id,
    }))
    return id
  },

  openResultTab: (sourceTabId) => {
    const source = get().tabs.find((t) => t.id === sourceTabId)
    if (!source?.result) return
    const id = crypto.randomUUID()
    const preview = source.sql.replace(/\s+/g, ' ').trim().slice(0, 28)
    const title = `📌 ${preview}${source.sql.trim().length > 28 ? '…' : ''}`
    const fg = get().focusedGroup
    const tab: QueryTab = {
      id, type: 'result', title, sql: source.sql, connectionId: source.connectionId,
      result: source.result, isRunning: false, logs: [], groupId: fg,
    }
    set((s) => ({
      tabs: [...s.tabs, tab],
      activeByGroup: { ...s.activeByGroup, [fg]: id },
      activeTabId: id,
    }))
  },

  openTableTab: (connectionId, engine, projectId, datasetId, tableId, tableName) => {
    const { tabs } = get()
    const existing = tabs.find(
      (t) =>
        t.type === 'table' &&
        t.connectionId === connectionId &&
        t.tableRef?.engine === engine &&
        t.tableRef?.tableId === tableId &&
        t.tableRef?.datasetId === datasetId
    )
    if (existing) {
      get().setActiveTab(existing.id)
      return
    }
    const id = crypto.randomUUID()
    const fg = get().focusedGroup
    const tab: QueryTab = {
      id, type: 'table', title: tableName, sql: '', connectionId,
      tableRef: { engine, projectId, datasetId, tableId },
      isRunning: false, logs: [], groupId: fg,
    }
    set((s) => ({
      tabs: [...s.tabs, tab],
      activeByGroup: { ...s.activeByGroup, [fg]: id },
      activeTabId: id,
    }))
  },

  closeTab: (id) => {
    set((s) => normalizeGroups(s.tabs.filter((t) => t.id !== id), s.focusedGroup, s.activeByGroup))
  },

  setActiveTab: (id) => {
    set((s) => {
      const tab = s.tabs.find((t) => t.id === id)
      if (!tab) return s
      const fg = (tab.groupId ?? 'left') as GroupId
      return { focusedGroup: fg, activeByGroup: { ...s.activeByGroup, [fg]: id }, activeTabId: id }
    })
  },

  focusGroup: (group) => {
    set((s) => {
      // Never focus an empty group — that would leave activeTabId null with a
      // non-empty layout. (Not reachable through the current UI, but keeps the
      // "focused group is non-empty" invariant robust against future callers.)
      if (!s.tabs.some((t) => (t.groupId ?? 'left') === group)) return s
      return { focusedGroup: group, activeTabId: s.activeByGroup[group] }
    })
  },

  moveTabToGroup: (tabId, target, beforeId) => {
    set((s) => {
      const moving = s.tabs.find((t) => t.id === tabId)
      if (!moving) return s
      let rest = s.tabs.filter((t) => t.id !== tabId)
      const moved: QueryTab = { ...moving, groupId: target }
      if (beforeId) {
        const idx = rest.findIndex((t) => t.id === beforeId)
        rest = idx === -1 ? [...rest, moved] : [...rest.slice(0, idx), moved, ...rest.slice(idx)]
      } else {
        rest = [...rest, moved]
      }
      return normalizeGroups(rest, target, { ...s.activeByGroup, [target]: tabId })
    })
  },

  splitGroup: () => {
    set((s) => {
      const id = crypto.randomUUID()
      const inheritConn = s.tabs.find((t) => t.id === s.activeByGroup[s.focusedGroup])?.connectionId
      const tab: QueryTab = {
        id, title: 'Untitled', sql: '', isRunning: false, logs: [],
        groupId: 'right', connectionId: inheritConn,
      }
      return normalizeGroups([...s.tabs, tab], 'right', { ...s.activeByGroup, right: id })
    })
  },

  setTabConnection: (tabId, connectionId) => {
    set((s) => ({ tabs: s.tabs.map((t) => (t.id === tabId ? { ...t, connectionId } : t)) }))
  },

  updateTabSql: (id, sql) => {
    set((s) => ({
      tabs: s.tabs.map((t) =>
        t.id === id ? { ...t, sql, params: reconcileParams(sql, t.params) } : t,
      ),
    }))
  },

  setTabParams: (id, params) => {
    set((s) => ({ tabs: s.tabs.map((t) => (t.id === id ? { ...t, params } : t)) }))
  },

  syncTabParams: (id) => {
    set((s) => ({
      tabs: s.tabs.map((t) =>
        t.id === id ? { ...t, params: reconcileParams(t.sql, t.params) } : t,
      ),
    }))
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
        connectionId: tab.connectionId, sql: tab.sql, tabId: id,
      })
      set((s) => ({ tabs: s.tabs.map((t) => (t.id === id ? { ...t, isRunning: false, result } : t)) }))
    } catch (err) {
      set((s) => {
        const currentTab = s.tabs.find((t) => t.id === id)
        return {
          tabs: s.tabs.map((t) =>
            t.id === id
              ? { ...t, isRunning: false, error: currentTab?.cancelled ? undefined : (err as Error).message }
              : t
          )
        }
      })
    }
  },

  cancelQuery: async (id) => {
    set((s) => ({ tabs: s.tabs.map((t) => (t.id === id ? { ...t, cancelled: true } : t)) }))
    await window.api.invoke(CHANNELS.QUERY_CANCEL, id)
  },

  explainQuery: async (id) => {
    const tab = get().tabs.find((t) => t.id === id)
    if (!tab || !tab.connectionId || !tab.sql.trim()) return

    set((s) => ({
      tabs: s.tabs.map((t) => (t.id === id ? { ...t, isExplaining: true, explainResult: undefined } : t))
    }))

    try {
      const result = await window.api.invoke(CHANNELS.QUERY_DRY_RUN, {
        connectionId: tab.connectionId, sql: tab.sql,
      })
      set((s) => ({
        tabs: s.tabs.map((t) => (t.id === id ? { ...t, isExplaining: false, explainResult: result } : t))
      }))
    } catch (err) {
      set((s) => ({
        tabs: s.tabs.map((t) => (t.id === id ? { ...t, isExplaining: false, error: (err as Error).message } : t))
      }))
    }
  },

  clearExplain: (id) => {
    set((s) => ({ tabs: s.tabs.map((t) => (t.id === id ? { ...t, explainResult: undefined } : t)) }))
  },

  toggleGraphView: (id) => {
    set((s) => ({ tabs: s.tabs.map((t) => (t.id === id ? { ...t, viewAsGraph: !t.viewAsGraph } : t)) }))
  },

  setResultView: (id, view) => {
    set((s) => ({ tabs: s.tabs.map((t) => (t.id === id ? { ...t, resultView: view } : t)) }))
  },

  setChartConfig: (id, config) => {
    set((s) => ({ tabs: s.tabs.map((t) => (t.id === id ? { ...t, chartConfig: config } : t)) }))
  },

  fetchPage: async (id) => {
    const tab = get().tabs.find((t) => t.id === id)
    if (!tab?.result?.pageToken) return

    try {
      const page: QueryResult = await window.api.invoke(CHANNELS.QUERY_GET_PAGE, {
        tabId: id, pageToken: tab.result.pageToken,
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
              totalRows: page.totalRows ?? t.result.totalRows,
            }
          }
        })
      }))
    } catch (err) {
      console.error('Failed to fetch page:', err)
    }
  }
}))

// ── Global QUERY_LOG push listener ──────────────────────────────────────────
// Main process sends { tabId, message }; append a timestamped line to the tab.
window.api.on(CHANNELS.QUERY_LOG, (data: unknown) => {
  const { tabId, message } = data as { tabId: string; message: string }
  const now = new Date()
  const ts = `${String(now.getHours()).padStart(2, '0')}:${String(now.getMinutes()).padStart(2, '0')}:${String(now.getSeconds()).padStart(2, '0')}`
  useQueryStore.setState((s) => ({
    tabs: s.tabs.map((t) => (t.id === tabId ? { ...t, logs: [...t.logs, `${ts}  ${message}`] } : t))
  }))
})
