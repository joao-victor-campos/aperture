/**
 * query.test.ts
 * Tests the IPC query handlers (src/main/ipc/query.ts).
 */
import { describe, it, expect, vi, beforeEach } from 'vitest'
import { CHANNELS } from '../../../shared/ipc'
import type { Connection, QueryResult } from '../../../shared/types'

// ── Capture ipcMain.handle registrations ────────────────────────────────────
type Handler = (event: unknown, req?: unknown) => unknown
const handlers = new Map<string, Handler>()

vi.mock('electron', () => ({
  ipcMain: {
    handle: (channel: string, fn: Handler) => handlers.set(channel, fn)
  }
}))

// ── Mock: store ──────────────────────────────────────────────────────────────
const conn: Connection = {
  id: 'conn-1', name: 'Test', projectId: 'proj',
  credentialType: 'adc', createdAt: '2024-01-01T00:00:00Z'
}

vi.mock('../../../main/db/store', () => ({
  store: { get: vi.fn(() => [conn]) }
}))

// ── Mock: bigquery query functions ───────────────────────────────────────────
vi.mock('../../../main/db/bigquery', () => ({
  runQuery: vi.fn(),
  cancelRunningQuery: vi.fn(),
  dryRunQuery: vi.fn()
}))

// ── Mock event with sender (webContents) ─────────────────────────────────────
const mockEvent = { sender: { send: vi.fn(), isDestroyed: vi.fn(() => false) } }

describe('Query IPC handlers', () => {
  beforeEach(async () => {
    handlers.clear()
    vi.clearAllMocks()

    const { registerQueryHandlers } = await import('../../../main/ipc/query')
    registerQueryHandlers()
  })

  describe(CHANNELS.QUERY_EXECUTE, () => {
    it('calls runQuery and returns the result', async () => {
      // Arrange
      const mockResult: QueryResult = { columns: ['a'], rows: [{ a: 1 }], rowCount: 1, executionTimeMs: 50 }
      const { runQuery } = await import('../../../main/db/bigquery')
      ;(runQuery as ReturnType<typeof vi.fn>).mockResolvedValueOnce(mockResult)
      const handler = handlers.get(CHANNELS.QUERY_EXECUTE)!

      // Act
      const result = await handler(mockEvent, { connectionId: 'conn-1', sql: 'SELECT 1', tabId: 'tab-1' })

      // Assert
      expect(result).toEqual(mockResult)
      expect(runQuery).toHaveBeenCalledWith(conn, 'SELECT 1', 'tab-1', mockEvent.sender)
    })

    it('throws when the connection id is unknown', async () => {
      // Arrange
      const handler = handlers.get(CHANNELS.QUERY_EXECUTE)!

      // Act / Assert
      await expect(
        handler(mockEvent, { connectionId: 'bad-id', sql: 'SELECT 1', tabId: 'tab-1' })
      ).rejects.toThrow('Connection not found')
    })
  })

  describe(CHANNELS.QUERY_CANCEL, () => {
    it('delegates to cancelRunningQuery with the tabId', async () => {
      // Arrange
      const { cancelRunningQuery } = await import('../../../main/db/bigquery')
      const handler = handlers.get(CHANNELS.QUERY_CANCEL)!

      // Act
      await handler({}, 'tab-to-cancel')

      // Assert
      expect(cancelRunningQuery).toHaveBeenCalledWith('tab-to-cancel')
    })
  })

  describe(CHANNELS.QUERY_DRY_RUN, () => {
    it('calls dryRunQuery and returns the estimate', async () => {
      // Arrange
      const { dryRunQuery } = await import('../../../main/db/bigquery')
      ;(dryRunQuery as ReturnType<typeof vi.fn>).mockResolvedValueOnce({ bytesProcessed: 2048 })
      const handler = handlers.get(CHANNELS.QUERY_DRY_RUN)!

      // Act
      const result = await handler({}, { connectionId: 'conn-1', sql: 'SELECT *' })

      // Assert
      expect(result).toEqual({ bytesProcessed: 2048 })
      expect(dryRunQuery).toHaveBeenCalledWith(conn, 'SELECT *')
    })

    it('throws when the connection id is unknown', async () => {
      // Arrange
      const handler = handlers.get(CHANNELS.QUERY_DRY_RUN)!

      // Act / Assert
      await expect(
        handler({}, { connectionId: 'bad-id', sql: 'SELECT *' })
      ).rejects.toThrow('Connection not found')
    })
  })
})
