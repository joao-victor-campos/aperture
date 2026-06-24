/**
 * queryStore.test.ts
 * Tests the Zustand query store (src/renderer/src/store/queryStore.ts).
 *
 * Note: queryStore.ts registers a QUERY_LOG listener at module level via
 * window.api.on(). This is handled by the window.api stub in setup.ts.
 */
import { describe, it, expect, vi, beforeEach } from 'vitest'
import { CHANNELS } from '../../../shared/ipc'
import type { QueryResult } from '../../../shared/types'

const invoke = () => window.api.invoke as ReturnType<typeof vi.fn>

let useQueryStore: typeof import('../../../renderer/src/store/queryStore').useQueryStore

beforeEach(async () => {
  vi.resetModules()
  ;({ useQueryStore } = await import('../../../renderer/src/store/queryStore'))
})

// ── Sample data ───────────────────────────────────────────────────────────────
const mockResult: QueryResult = {
  columns: ['id', 'name'],
  rows: [{ id: 1, name: 'Alice' }],
  rowCount: 1,
  executionTimeMs: 42
}

describe('queryStore', () => {
  describe('initial state', () => {
    it('starts with no tabs and no active tab', () => {
      const { tabs, activeTabId } = useQueryStore.getState()
      expect(tabs).toEqual([])
      expect(activeTabId).toBeNull()
    })
  })

  describe('openTab', () => {
    it('creates a new tab and makes it active', () => {
      // Act
      const id = useQueryStore.getState().openTab()

      // Assert
      const { tabs, activeTabId } = useQueryStore.getState()
      expect(tabs).toHaveLength(1)
      expect(activeTabId).toBe(id)
      expect(tabs[0].title).toBe('Untitled')
      expect(tabs[0].isRunning).toBe(false)
      expect(tabs[0].logs).toEqual([])
    })

    it('accepts partial overrides for title, sql, connectionId', () => {
      // Act
      useQueryStore.getState().openTab({ title: 'My Query', sql: 'SELECT 1', connectionId: 'c1' })

      // Assert
      const tab = useQueryStore.getState().tabs[0]
      expect(tab.title).toBe('My Query')
      expect(tab.sql).toBe('SELECT 1')
      expect(tab.connectionId).toBe('c1')
    })

    it('returns the new tab id', () => {
      // Act
      const id = useQueryStore.getState().openTab()

      // Assert
      expect(typeof id).toBe('string')
      expect(id.length).toBeGreaterThan(0)
    })
  })

  describe('openTableTab', () => {
    it('creates a table-type tab with the correct tableRef', () => {
      // Act
      useQueryStore.getState().openTableTab('c1', 'bigquery', 'proj', 'ds1', 'tbl1', 'My Table')

      // Assert
      const tab = useQueryStore.getState().tabs[0]
      expect(tab.type).toBe('table')
      expect(tab.title).toBe('My Table')
      expect(tab.tableRef).toEqual({
        engine: 'bigquery',
        projectId: 'proj',
        datasetId: 'ds1',
        tableId: 'tbl1'
      })
    })

    it('focuses the existing tab instead of opening a duplicate', () => {
      // Arrange — open table tab once
      useQueryStore.getState().openTableTab('c1', 'bigquery', 'proj', 'ds1', 'tbl1', 'My Table')
      const firstId = useQueryStore.getState().activeTabId

      // Open another query tab to shift focus
      useQueryStore.getState().openTab()
      expect(useQueryStore.getState().activeTabId).not.toBe(firstId)

      // Act — open same table tab again
      useQueryStore.getState().openTableTab('c1', 'bigquery', 'proj', 'ds1', 'tbl1', 'My Table')

      // Assert — exactly one table tab, focus moved back to it
      const { tabs, activeTabId } = useQueryStore.getState()
      expect(tabs.filter((t) => t.type === 'table')).toHaveLength(1)
      expect(activeTabId).toBe(firstId)
    })
  })

  describe('closeTab', () => {
    it('removes the tab from the list', () => {
      // Arrange
      const id = useQueryStore.getState().openTab()

      // Act
      useQueryStore.getState().closeTab(id)

      // Assert
      expect(useQueryStore.getState().tabs).toHaveLength(0)
    })

    it('activates the last remaining tab when the active one is closed', () => {
      // Arrange
      const id1 = useQueryStore.getState().openTab()
      const id2 = useQueryStore.getState().openTab()
      expect(useQueryStore.getState().activeTabId).toBe(id2)

      // Act — close the active tab
      useQueryStore.getState().closeTab(id2)

      // Assert — the previous tab becomes active
      expect(useQueryStore.getState().activeTabId).toBe(id1)
    })

    it('sets activeTabId to null when the last tab is closed', () => {
      // Arrange
      const id = useQueryStore.getState().openTab()

      // Act
      useQueryStore.getState().closeTab(id)

      // Assert
      expect(useQueryStore.getState().activeTabId).toBeNull()
    })
  })

  describe('setActiveTab', () => {
    it('updates the active tab id', () => {
      // Arrange
      const id1 = useQueryStore.getState().openTab()
      useQueryStore.getState().openTab()

      // Act
      useQueryStore.getState().setActiveTab(id1)

      // Assert
      expect(useQueryStore.getState().activeTabId).toBe(id1)
    })
  })

  describe('updateTabSql', () => {
    it('updates the sql field of the matching tab', () => {
      // Arrange
      const id = useQueryStore.getState().openTab()

      // Act
      useQueryStore.getState().updateTabSql(id, 'SELECT * FROM users')

      // Assert
      expect(useQueryStore.getState().tabs[0].sql).toBe('SELECT * FROM users')
    })

    it('does not affect other tabs', () => {
      // Arrange
      const id1 = useQueryStore.getState().openTab()
      const id2 = useQueryStore.getState().openTab()

      // Act
      useQueryStore.getState().updateTabSql(id1, 'SELECT 1')

      // Assert
      const t2 = useQueryStore.getState().tabs.find((t) => t.id === id2)!
      expect(t2.sql).toBe('')
    })
  })

  describe('runQuery', () => {
    it('sets isRunning during execution and stores the result on success', async () => {
      // Arrange
      const id = useQueryStore.getState().openTab({ connectionId: 'c1', sql: 'SELECT 1' })
      invoke().mockResolvedValueOnce(mockResult)

      // Act
      await useQueryStore.getState().runQuery(id)

      // Assert
      const tab = useQueryStore.getState().tabs.find((t) => t.id === id)!
      expect(tab.isRunning).toBe(false)
      expect(tab.result).toEqual(mockResult)
      expect(tab.error).toBeUndefined()
      expect(invoke()).toHaveBeenCalledWith(CHANNELS.QUERY_EXECUTE, {
        connectionId: 'c1', sql: 'SELECT 1', tabId: id
      })
    })

    it('clears previous result/error/logs before running', async () => {
      // Arrange
      const id = useQueryStore.getState().openTab({ connectionId: 'c1', sql: 'SELECT 1' })
      useQueryStore.setState((s) => ({
        tabs: s.tabs.map((t) => t.id === id ? { ...t, error: 'old error', logs: ['old log'] } : t)
      }))
      invoke().mockResolvedValueOnce(mockResult)

      // Act
      await useQueryStore.getState().runQuery(id)

      // Assert
      const tab = useQueryStore.getState().tabs.find((t) => t.id === id)!
      expect(tab.error).toBeUndefined()
      expect(tab.logs).toEqual([])
    })

    it('stores the error message on failure (when not cancelled)', async () => {
      // Arrange
      const id = useQueryStore.getState().openTab({ connectionId: 'c1', sql: 'SELECT bad' })
      invoke().mockRejectedValueOnce(new Error('Syntax error'))

      // Act
      await useQueryStore.getState().runQuery(id)

      // Assert
      const tab = useQueryStore.getState().tabs.find((t) => t.id === id)!
      expect(tab.isRunning).toBe(false)
      expect(tab.error).toBe('Syntax error')
    })

    it('suppresses the error message when the tab was cancelled', async () => {
      // Arrange
      const id = useQueryStore.getState().openTab({ connectionId: 'c1', sql: 'SELECT 1' })
      // Set cancelled: true *inside* the mock — after runQuery clears it at start —
      // to simulate cancelQuery being called while the query is in flight.
      invoke().mockImplementationOnce(async () => {
        useQueryStore.setState((s) => ({
          tabs: s.tabs.map((t) => t.id === id ? { ...t, cancelled: true } : t)
        }))
        throw new Error('Cancelled')
      })

      // Act
      await useQueryStore.getState().runQuery(id)

      // Assert — error should be suppressed when tab is cancelled
      const tab = useQueryStore.getState().tabs.find((t) => t.id === id)!
      expect(tab.error).toBeUndefined()
    })

    it('is a no-op when the tab has no connectionId', async () => {
      // Arrange — tab with no connectionId
      const id = useQueryStore.getState().openTab({ sql: 'SELECT 1' })

      // Act
      await useQueryStore.getState().runQuery(id)

      // Assert — invoke should not have been called
      expect(invoke()).not.toHaveBeenCalled()
    })

    it('is a no-op when the tab sql is empty', async () => {
      // Arrange
      const id = useQueryStore.getState().openTab({ connectionId: 'c1', sql: '   ' })

      // Act
      await useQueryStore.getState().runQuery(id)

      // Assert
      expect(invoke()).not.toHaveBeenCalled()
    })
  })

  describe('openResultTab', () => {
    it('creates a result-type tab that snapshots the source result', () => {
      // Arrange — source tab with a result
      const id = useQueryStore.getState().openTab({ sql: 'SELECT 1', connectionId: 'c1' })
      useQueryStore.setState((s) => ({
        tabs: s.tabs.map((t) => t.id === id ? { ...t, result: mockResult } : t)
      }))

      // Act
      useQueryStore.getState().openResultTab(id)

      // Assert
      const { tabs, activeTabId } = useQueryStore.getState()
      const pinned = tabs.find((t) => t.type === 'result')!
      expect(pinned).toBeDefined()
      expect(pinned.result).toEqual(mockResult)
      expect(pinned.connectionId).toBe('c1')
      expect(pinned.isRunning).toBe(false)
      expect(activeTabId).toBe(pinned.id)
    })

    it('title includes a truncated sql preview', () => {
      // Arrange
      const id = useQueryStore.getState().openTab({ sql: 'SELECT id, name FROM users', connectionId: 'c1' })
      useQueryStore.setState((s) => ({
        tabs: s.tabs.map((t) => t.id === id ? { ...t, result: mockResult } : t)
      }))

      // Act
      useQueryStore.getState().openResultTab(id)

      // Assert
      const pinned = useQueryStore.getState().tabs.find((t) => t.type === 'result')!
      expect(pinned.title).toContain('SELECT id, name FROM users')
    })

    it('is a no-op when the source tab has no result', () => {
      // Arrange — tab with no result
      const id = useQueryStore.getState().openTab({ sql: 'SELECT 1', connectionId: 'c1' })

      // Act
      useQueryStore.getState().openResultTab(id)

      // Assert — no result tab should have been created
      const resultTabs = useQueryStore.getState().tabs.filter((t) => t.type === 'result')
      expect(resultTabs).toHaveLength(0)
    })

    it('is a no-op when the source tab id does not exist', () => {
      // Act
      useQueryStore.getState().openResultTab('non-existent-id')

      // Assert
      expect(useQueryStore.getState().tabs).toHaveLength(0)
    })
  })

  describe('cancelQuery', () => {
    it('sets cancelled:true on the tab and calls the CANCEL channel', async () => {
      // Arrange
      const id = useQueryStore.getState().openTab({ connectionId: 'c1', sql: 'SELECT 1' })
      invoke().mockResolvedValueOnce(undefined)

      // Act
      await useQueryStore.getState().cancelQuery(id)

      // Assert
      const tab = useQueryStore.getState().tabs.find((t) => t.id === id)!
      expect(tab.cancelled).toBe(true)
      expect(invoke()).toHaveBeenCalledWith(CHANNELS.QUERY_CANCEL, id)
    })
  })

  describe('editor groups', () => {
    it('new tabs land in the focused group (left by default)', () => {
      const id = useQueryStore.getState().openTab({ connectionId: 'c1' })
      const tab = useQueryStore.getState().tabs.find((t) => t.id === id)!
      expect(tab.groupId).toBe('left')
      expect(useQueryStore.getState().focusedGroup).toBe('left')
      expect(useQueryStore.getState().activeTabId).toBe(id)
    })

    it('splitGroup opens a fresh tab in the right group inheriting the focused connection', () => {
      const left = useQueryStore.getState().openTab({ connectionId: 'c1', sql: 'SELECT 1' })
      useQueryStore.getState().splitGroup()

      const s = useQueryStore.getState()
      const right = s.tabs.find((t) => t.groupId === 'right')!
      expect(right).toBeDefined()
      expect(right.connectionId).toBe('c1')
      expect(s.focusedGroup).toBe('right')
      expect(s.activeTabId).toBe(right.id)
      expect(s.tabs.find((t) => t.id === left)!.groupId).toBe('left')
    })

    it('moveTabToGroup moves a tab to the other group keeping its connection', () => {
      const a = useQueryStore.getState().openTab({ connectionId: 'c1' })
      const b = useQueryStore.getState().openTab({ connectionId: 'c2' })

      useQueryStore.getState().moveTabToGroup(b, 'right')

      const s = useQueryStore.getState()
      expect(s.tabs.find((t) => t.id === b)!.groupId).toBe('right')
      expect(s.tabs.find((t) => t.id === b)!.connectionId).toBe('c2')
      expect(s.tabs.find((t) => t.id === a)!.groupId).toBe('left')
      expect(s.focusedGroup).toBe('right')
      expect(s.activeByGroup.right).toBe(b)
    })

    it('moveTabToGroup with a beforeId reorders within the same group', () => {
      const a = useQueryStore.getState().openTab({ connectionId: 'c1' })
      const b = useQueryStore.getState().openTab({ connectionId: 'c1' })
      useQueryStore.getState().moveTabToGroup(b, 'left', a)
      const leftIds = useQueryStore.getState().tabs.filter((t) => t.groupId === 'left').map((t) => t.id)
      expect(leftIds).toEqual([b, a])
    })

    it('collapses the right group back to a single layout when its last tab leaves', () => {
      const left = useQueryStore.getState().openTab({ connectionId: 'c1' })
      useQueryStore.getState().splitGroup()
      const right = useQueryStore.getState().activeByGroup.right!

      useQueryStore.getState().closeTab(right)

      const s = useQueryStore.getState()
      expect(s.tabs.some((t) => t.groupId === 'right')).toBe(false)
      expect(s.focusedGroup).toBe('left')
      expect(s.activeTabId).toBe(left)
    })

    it('promotes the right group to left if all left tabs are moved away', () => {
      const a = useQueryStore.getState().openTab({ connectionId: 'c1' })
      useQueryStore.getState().splitGroup()
      useQueryStore.getState().moveTabToGroup(a, 'right')

      const s = useQueryStore.getState()
      expect(s.tabs.every((t) => t.groupId === 'left')).toBe(true)
      expect(s.focusedGroup).toBe('left')
    })

    it('focusGroup switches the focused group and updates activeTabId', () => {
      const left = useQueryStore.getState().openTab({ connectionId: 'c1' })
      useQueryStore.getState().splitGroup()
      const right = useQueryStore.getState().activeByGroup.right!

      useQueryStore.getState().focusGroup('left')
      expect(useQueryStore.getState().activeTabId).toBe(left)

      useQueryStore.getState().focusGroup('right')
      expect(useQueryStore.getState().activeTabId).toBe(right)
    })

    it('setTabConnection changes only the targeted tab connection', () => {
      const a = useQueryStore.getState().openTab({ connectionId: 'c1' })
      const b = useQueryStore.getState().openTab({ connectionId: 'c1' })

      useQueryStore.getState().setTabConnection(a, 'c9')

      expect(useQueryStore.getState().tabs.find((t) => t.id === a)!.connectionId).toBe('c9')
      expect(useQueryStore.getState().tabs.find((t) => t.id === b)!.connectionId).toBe('c1')
    })

    it('focusGroup is a no-op when the target group is empty', () => {
      const left = useQueryStore.getState().openTab({ connectionId: 'c1' })

      // Right group has no tabs — focusing it must not strand activeTabId at null.
      useQueryStore.getState().focusGroup('right')

      const s = useQueryStore.getState()
      expect(s.focusedGroup).toBe('left')
      expect(s.activeTabId).toBe(left)
    })
  })

  describe('explainQuery', () => {
    it('calls QUERY_DRY_RUN and stores the result on the tab', async () => {
      // Arrange
      const id = useQueryStore.getState().openTab({ connectionId: 'c1', sql: 'SELECT * FROM users' })
      const explainResult = { bytesProcessed: 5000, plan: '{"stages":[]}', planFormat: 'json' as const }
      invoke().mockResolvedValueOnce(explainResult)

      // Act
      await useQueryStore.getState().explainQuery(id)

      // Assert
      const tab = useQueryStore.getState().tabs.find((t) => t.id === id)!
      expect(tab.explainResult).toEqual(explainResult)
      expect(tab.isExplaining).toBe(false)
      expect(invoke()).toHaveBeenCalledWith(CHANNELS.QUERY_DRY_RUN, {
        connectionId: 'c1',
        sql: 'SELECT * FROM users',
      })
    })

    it('stores error and clears isExplaining on failure', async () => {
      // Arrange
      const id = useQueryStore.getState().openTab({ connectionId: 'c1', sql: 'SELECT bad' })
      invoke().mockRejectedValueOnce(new Error('Syntax error at position 7'))

      // Act
      await useQueryStore.getState().explainQuery(id)

      // Assert
      const tab = useQueryStore.getState().tabs.find((t) => t.id === id)!
      expect(tab.isExplaining).toBe(false)
      expect(tab.error).toBe('Syntax error at position 7')
      expect(tab.explainResult).toBeUndefined()
    })

    it('is a no-op when connectionId is missing', async () => {
      // Arrange — no connectionId
      const id = useQueryStore.getState().openTab({ sql: 'SELECT 1' })

      // Act
      await useQueryStore.getState().explainQuery(id)

      // Assert
      expect(invoke()).not.toHaveBeenCalled()
    })

    it('is a no-op when sql is empty', async () => {
      // Arrange
      const id = useQueryStore.getState().openTab({ connectionId: 'c1', sql: '   ' })

      // Act
      await useQueryStore.getState().explainQuery(id)

      // Assert
      expect(invoke()).not.toHaveBeenCalled()
    })
  })

  describe('clearExplain', () => {
    it('removes explainResult from the tab', async () => {
      // Arrange
      const id = useQueryStore.getState().openTab({ connectionId: 'c1', sql: 'SELECT 1' })
      const explainResult = { bytesProcessed: 100, plan: 'Seq Scan', planFormat: 'text' as const }
      invoke().mockResolvedValueOnce(explainResult)
      await useQueryStore.getState().explainQuery(id)

      // Act
      useQueryStore.getState().clearExplain(id)

      // Assert
      const tab = useQueryStore.getState().tabs.find((t) => t.id === id)!
      expect(tab.explainResult).toBeUndefined()
    })
  })

  describe('toggleGraphView', () => {
    it('flips viewAsGraph on the targeted tab only', () => {
      // Arrange
      const id = useQueryStore.getState().openTab({ sql: 'MATCH (n) RETURN n', connectionId: 'c' })
      const otherId = useQueryStore.getState().openTab({ sql: 'SELECT 1', connectionId: 'c' })

      // Act + Assert — on
      useQueryStore.getState().toggleGraphView(id)
      expect(useQueryStore.getState().tabs.find((t) => t.id === id)?.viewAsGraph).toBe(true)
      expect(useQueryStore.getState().tabs.find((t) => t.id === otherId)?.viewAsGraph).toBeUndefined()

      // Act + Assert — off
      useQueryStore.getState().toggleGraphView(id)
      expect(useQueryStore.getState().tabs.find((t) => t.id === id)?.viewAsGraph).toBe(false)
    })

    it('is a no-op for an unknown tab id', () => {
      // Arrange
      useQueryStore.getState().openTab({ sql: 'SELECT 1' })
      const before = useQueryStore.getState().tabs

      // Act
      useQueryStore.getState().toggleGraphView('does-not-exist')

      // Assert
      expect(useQueryStore.getState().tabs).toEqual(before)
    })
  })

  describe('chart view', () => {
    it('setResultView sets the view on the targeted tab only', () => {
      const id = useQueryStore.getState().openTab({ sql: 'SELECT 1', connectionId: 'c' })
      const other = useQueryStore.getState().openTab({ sql: 'SELECT 2', connectionId: 'c' })

      useQueryStore.getState().setResultView(id, 'chart')

      expect(useQueryStore.getState().tabs.find((t) => t.id === id)?.resultView).toBe('chart')
      expect(useQueryStore.getState().tabs.find((t) => t.id === other)?.resultView).toBeUndefined()
    })

    it('setChartConfig stores the config on the targeted tab', () => {
      const id = useQueryStore.getState().openTab({ sql: 'SELECT 1', connectionId: 'c' })
      const cfg = { type: 'bar' as const, xCol: 'month', yCol: 'revenue', aggregate: 'sum' as const }

      useQueryStore.getState().setChartConfig(id, cfg)

      expect(useQueryStore.getState().tabs.find((t) => t.id === id)?.chartConfig).toEqual(cfg)
    })
  })
})

describe('query params', () => {
  it('updateTabSql adds detected params with text default', () => {
    const id = useQueryStore.getState().openTab({ connectionId: 'c1' })
    useQueryStore.getState().updateTabSql(id, 'SELECT * WHERE a = {{country}}')
    const tab = useQueryStore.getState().tabs.find((t) => t.id === id)!
    expect(tab.params).toEqual([{ name: 'country', type: 'text', value: '' }])
  })

  it('updateTabSql preserves existing value/type by name and drops removed', () => {
    const id = useQueryStore.getState().openTab({ connectionId: 'c1' })
    useQueryStore.getState().updateTabSql(id, 'WHERE a = {{a}} AND b = {{b}}')
    useQueryStore.getState().setTabParams(id, [
      { name: 'a', type: 'number', value: '5' },
      { name: 'b', type: 'text', value: 'x' },
    ])
    useQueryStore.getState().updateTabSql(id, 'WHERE a = {{a}}')
    const tab = useQueryStore.getState().tabs.find((t) => t.id === id)!
    expect(tab.params).toEqual([{ name: 'a', type: 'number', value: '5' }])
  })

  it('setTabParams replaces the param array for the tab', () => {
    const id = useQueryStore.getState().openTab({ connectionId: 'c1' })
    useQueryStore.getState().updateTabSql(id, 'WHERE a = {{a}}')
    useQueryStore.getState().setTabParams(id, [{ name: 'a', type: 'boolean', value: 'true' }])
    const tab = useQueryStore.getState().tabs.find((t) => t.id === id)!
    expect(tab.params).toEqual([{ name: 'a', type: 'boolean', value: 'true' }])
  })

  it('syncTabParams reconciles params from current sql, preserving seeded values', () => {
    const id = useQueryStore.getState().openTab({
      connectionId: 'c1',
      sql: 'WHERE a = {{a}} AND b = {{b}}',
      params: [{ name: 'a', type: 'number', value: '9' }],
    })
    useQueryStore.getState().syncTabParams(id)
    const tab = useQueryStore.getState().tabs.find((t) => t.id === id)!
    expect(tab.params).toEqual([
      { name: 'a', type: 'number', value: '9' },
      { name: 'b', type: 'text', value: '' },
    ])
  })

  it('runQuery sends substituted SQL through QUERY_EXECUTE', async () => {
    const invokeMock = vi.mocked(window.api.invoke)
    invokeMock.mockResolvedValue({ columns: [], rows: [] } as never)
    const id = useQueryStore.getState().openTab({ connectionId: 'c1' })
    useQueryStore.getState().updateTabSql(id, 'SELECT * WHERE c = {{c}}')
    useQueryStore.getState().setTabParams(id, [{ name: 'c', type: 'text', value: 'US' }])
    await useQueryStore.getState().runQuery(id)
    expect(invokeMock).toHaveBeenCalledWith(
      CHANNELS.QUERY_EXECUTE,
      expect.objectContaining({ sql: "SELECT * WHERE c = 'US'", connectionId: 'c1', tabId: id }),
    )
  })

  it('runQuery blocks (sets error, no IPC) when a value is missing', async () => {
    const invokeMock = vi.mocked(window.api.invoke)
    invokeMock.mockClear()
    const id = useQueryStore.getState().openTab({ connectionId: 'c1' })
    useQueryStore.getState().updateTabSql(id, 'SELECT * WHERE c = {{c}}')
    await useQueryStore.getState().runQuery(id)
    const tab = useQueryStore.getState().tabs.find((t) => t.id === id)!
    expect(tab.error).toBe('Fill in {{c}} before running.')
    expect(invokeMock).not.toHaveBeenCalled()
  })

  it('explainQuery sends substituted SQL through QUERY_DRY_RUN', async () => {
    const invokeMock = vi.mocked(window.api.invoke)
    invokeMock.mockResolvedValue({ bytesProcessed: 0 } as never)
    const id = useQueryStore.getState().openTab({ connectionId: 'c1' })
    useQueryStore.getState().updateTabSql(id, 'SELECT {{n}}')
    useQueryStore.getState().setTabParams(id, [{ name: 'n', type: 'number', value: '7' }])
    await useQueryStore.getState().explainQuery(id)
    expect(invokeMock).toHaveBeenCalledWith(
      CHANNELS.QUERY_DRY_RUN,
      expect.objectContaining({ sql: 'SELECT 7', connectionId: 'c1' }),
    )
  })
})
