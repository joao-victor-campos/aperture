/**
 * historyStore.test.ts
 * Tests for the historyStore Zustand store.
 */
import { describe, it, expect, beforeEach, vi } from 'vitest'
import { CHANNELS } from '../../../shared/ipc'
import type { HistoryEntry } from '../../../shared/types'

function invoke() {
  return window.api.invoke as ReturnType<typeof vi.fn>
}

function makeEntry(id = 'h1'): HistoryEntry {
  return {
    id,
    sql: 'SELECT 1',
    connectionId: 'c1',
    connectionName: 'Test',
    executedAt: '2024-01-01T00:00:00Z',
    durationMs: 42,
    rowCount: 1,
  }
}

let useHistoryStore: typeof import('../../../renderer/src/store/historyStore').useHistoryStore

beforeEach(async () => {
  vi.resetModules()
  ;({ useHistoryStore } = await import('../../../renderer/src/store/historyStore'))
})

describe('historyStore', () => {
  it('starts with empty entries and loaded:false', () => {
    const s = useHistoryStore.getState()
    expect(s.entries).toEqual([])
    expect(s.loaded).toBe(false)
  })

  describe('load', () => {
    it('calls HISTORY_LIST and sets entries + loaded:true on first call', async () => {
      const entries = [makeEntry('h1'), makeEntry('h2')]
      invoke().mockResolvedValueOnce(entries)

      await useHistoryStore.getState().load()

      const s = useHistoryStore.getState()
      expect(invoke()).toHaveBeenCalledWith(CHANNELS.HISTORY_LIST, undefined)
      expect(s.entries).toEqual(entries)
      expect(s.loaded).toBe(true)
    })

    it('is a no-op when already loaded', async () => {
      // Arrange: first load
      invoke().mockResolvedValueOnce([makeEntry('h1')])
      await useHistoryStore.getState().load()
      expect(invoke()).toHaveBeenCalledTimes(1)

      // Act: second call
      await useHistoryStore.getState().load()

      // Assert: no second IPC call
      expect(invoke()).toHaveBeenCalledTimes(1)
    })
  })

  describe('reload', () => {
    it('always fetches, even when loaded:true', async () => {
      invoke().mockResolvedValueOnce([makeEntry('h1')])
      await useHistoryStore.getState().load()

      invoke().mockResolvedValueOnce([makeEntry('h2'), makeEntry('h3')])
      await useHistoryStore.getState().reload()

      expect(invoke()).toHaveBeenCalledTimes(2)
      const s = useHistoryStore.getState()
      expect(s.entries).toHaveLength(2)
      expect(s.entries[0].id).toBe('h2')
    })
  })

  describe('clearAll', () => {
    it('calls HISTORY_CLEAR and empties entries', async () => {
      // Seed with entries
      invoke().mockResolvedValueOnce([makeEntry('h1'), makeEntry('h2')])
      await useHistoryStore.getState().load()
      expect(useHistoryStore.getState().entries).toHaveLength(2)

      // Clear
      invoke().mockResolvedValueOnce(undefined)
      await useHistoryStore.getState().clearAll()

      expect(invoke()).toHaveBeenCalledWith(CHANNELS.HISTORY_CLEAR, undefined)
      expect(useHistoryStore.getState().entries).toEqual([])
    })
  })
})
