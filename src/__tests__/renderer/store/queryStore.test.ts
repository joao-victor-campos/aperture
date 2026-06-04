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

  describe('split pane', () => {
    describe('toggleSplit', () => {
      it('creates a rightPane with empty state when none exists', () => {
        // Arrange
        const id = useQueryStore.getState().openTab({ connectionId: 'c1', sql: 'SELECT 1' })

        // Act
        useQueryStore.getState().toggleSplit(id)

        // Assert
        const tab = useQueryStore.getState().tabs.find((t) => t.id === id)!
        expect(tab.rightPane).toBeDefined()
        expect(tab.rightPane?.sql).toBe('')
        expect(tab.rightPane?.isRunning).toBe(false)
        expect(tab.rightPane?.logs).toEqual([])
      })

      it('removes rightPane when called again (toggle off)', () => {
        // Arrange
        const id = useQueryStore.getState().openTab({ connectionId: 'c1', sql: 'SELECT 1' })
        useQueryStore.getState().toggleSplit(id)
        expect(useQueryStore.getState().tabs.find((t) => t.id === id)!.rightPane).toBeDefined()

        // Act
        useQueryStore.getState().toggleSplit(id)

        // Assert
        expect(useQueryStore.getState().tabs.find((t) => t.id === id)!.rightPane).toBeUndefined()
      })

      it('does not affect other tabs', () => {
        // Arrange
        const id1 = useQueryStore.getState().openTab({ connectionId: 'c1', sql: 'SELECT 1' })
        const id2 = useQueryStore.getState().openTab({ connectionId: 'c1', sql: 'SELECT 2' })

        // Act
        useQueryStore.getState().toggleSplit(id1)

        // Assert
        const tab2 = useQueryStore.getState().tabs.find((t) => t.id === id2)!
        expect(tab2.rightPane).toBeUndefined()
      })
    })

    describe('updateRightPaneSql', () => {
      it('updates rightPane.sql without affecting the left pane sql', () => {
        // Arrange
        const id = useQueryStore.getState().openTab({ connectionId: 'c1', sql: 'SELECT 1' })
        useQueryStore.getState().toggleSplit(id)

        // Act
        useQueryStore.getState().updateRightPaneSql(id, 'SELECT 2')

        // Assert
        const tab = useQueryStore.getState().tabs.find((t) => t.id === id)!
        expect(tab.rightPane?.sql).toBe('SELECT 2')
        expect(tab.sql).toBe('SELECT 1')
      })

      it('is a no-op when rightPane does not exist', () => {
        // Arrange
        const id = useQueryStore.getState().openTab({ connectionId: 'c1', sql: 'SELECT 1' })

        // Act (no split opened)
        useQueryStore.getState().updateRightPaneSql(id, 'SELECT 2')

        // Assert — left sql is unchanged, no rightPane created
        const tab = useQueryStore.getState().tabs.find((t) => t.id === id)!
        expect(tab.sql).toBe('SELECT 1')
        expect(tab.rightPane).toBeUndefined()
      })
    })

    describe('runRightPane', () => {
      it('invokes QUERY_EXECUTE with tabId="${id}-right" and stores result in rightPane', async () => {
        // Arrange
        const id = useQueryStore.getState().openTab({ connectionId: 'c1', sql: 'SELECT 1' })
        useQueryStore.getState().toggleSplit(id)
        useQueryStore.getState().updateRightPaneSql(id, 'SELECT 2')
        invoke().mockResolvedValueOnce(mockResult)

        // Act
        await useQueryStore.getState().runRightPane(id)

        // Assert
        const tab = useQueryStore.getState().tabs.find((t) => t.id === id)!
        expect(tab.rightPane?.result).toEqual(mockResult)
        expect(tab.rightPane?.isRunning).toBe(false)
        expect(invoke()).toHaveBeenCalledWith(CHANNELS.QUERY_EXECUTE, {
          connectionId: 'c1',
          sql: 'SELECT 2',
          tabId: `${id}-right`,
        })
      })

      it('stores error in rightPane.error on failure (when not cancelled)', async () => {
        // Arrange
        const id = useQueryStore.getState().openTab({ connectionId: 'c1', sql: 'SELECT 1' })
        useQueryStore.getState().toggleSplit(id)
        useQueryStore.getState().updateRightPaneSql(id, 'SELECT bad')
        invoke().mockRejectedValueOnce(new Error('Syntax error'))

        // Act
        await useQueryStore.getState().runRightPane(id)

        // Assert
        const tab = useQueryStore.getState().tabs.find((t) => t.id === id)!
        expect(tab.rightPane?.error).toBe('Syntax error')
        expect(tab.rightPane?.isRunning).toBe(false)
      })

      it('suppresses error when rightPane.cancelled is true', async () => {
        // Arrange
        const id = useQueryStore.getState().openTab({ connectionId: 'c1', sql: 'SELECT 1' })
        useQueryStore.getState().toggleSplit(id)
        useQueryStore.getState().updateRightPaneSql(id, 'SELECT 1')
        invoke().mockImplementationOnce(async () => {
          useQueryStore.setState((s) => ({
            tabs: s.tabs.map((t) =>
              t.id === id && t.rightPane
                ? { ...t, rightPane: { ...t.rightPane, cancelled: true } }
                : t
            )
          }))
          throw new Error('Cancelled')
        })

        // Act
        await useQueryStore.getState().runRightPane(id)

        // Assert
        const tab = useQueryStore.getState().tabs.find((t) => t.id === id)!
        expect(tab.rightPane?.error).toBeUndefined()
      })

      it('is a no-op when rightPane is absent', async () => {
        // Arrange
        const id = useQueryStore.getState().openTab({ connectionId: 'c1', sql: 'SELECT 1' })

        // Act — no toggleSplit, so no rightPane
        await useQueryStore.getState().runRightPane(id)

        // Assert
        expect(invoke()).not.toHaveBeenCalled()
      })
    })

    describe('cancelRightPane', () => {
      it('sets rightPane.cancelled to true and calls QUERY_CANCEL with the -right tabId', async () => {
        // Arrange
        const id = useQueryStore.getState().openTab({ connectionId: 'c1', sql: 'SELECT 1' })
        useQueryStore.getState().toggleSplit(id)
        invoke().mockResolvedValueOnce(undefined)

        // Act
        await useQueryStore.getState().cancelRightPane(id)

        // Assert
        const tab = useQueryStore.getState().tabs.find((t) => t.id === id)!
        expect(tab.rightPane?.cancelled).toBe(true)
        expect(invoke()).toHaveBeenCalledWith(CHANNELS.QUERY_CANCEL, `${id}-right`)
      })
    })
  })
})
