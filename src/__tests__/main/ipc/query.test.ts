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

// ── Mock: adapter registry (engine dispatch) ────────────────────────────────
const bigAdapter = {
  runQuery: vi.fn(),
  getQueryPage: vi.fn(),
  cancelRunningQuery: vi.fn(),
  dryRunQuery: vi.fn()
}

const pgAdapter = {
  runQuery: vi.fn(),
  getQueryPage: vi.fn(),
  cancelRunningQuery: vi.fn(),
  dryRunQuery: vi.fn()
}

vi.mock('../../../main/db/adapterRegistry', () => ({
  getAdapterForConnection: (connection: Connection) =>
    connection.engine === 'bigquery' ? bigAdapter : pgAdapter,
  getAdapterForEngine: (engine: 'bigquery' | 'postgres') =>
    engine === 'bigquery' ? bigAdapter : pgAdapter
}))

// ── Mock: store ──────────────────────────────────────────────────────────────
const bigConn: Connection = {
  id: 'conn-1',
  name: 'BigQuery Conn',
  engine: 'bigquery',
  projectId: 'proj',
  credentialType: 'adc',
  createdAt: '2024-01-01T00:00:00Z'
}

const pgConn: Connection = {
  id: 'conn-pg-1',
  name: 'Postgres Conn',
  engine: 'postgres',
  host: 'localhost',
  port: 5432,
  database: 'db',
  user: 'user',
  password: 'pw',
  createdAt: '2024-01-01T00:00:00Z'
}

let storedConnections: Connection[] = [bigConn]
vi.mock('../../../main/db/store', () => ({
  store: { get: vi.fn(() => storedConnections) }
}))

// ── Mock event with sender (webContents) ─────────────────────────────────────
const mockEvent = { sender: { send: vi.fn(), isDestroyed: vi.fn(() => false) } }

describe('Query IPC handlers', () => {
  beforeEach(async () => {
    handlers.clear()
    vi.clearAllMocks()
    storedConnections = [bigConn]

    const { registerQueryHandlers } = await import('../../../main/ipc/query')
    registerQueryHandlers()
  })

  describe(CHANNELS.QUERY_EXECUTE, () => {
    it('calls runQuery and returns the result', async () => {
      // Arrange
      const mockResult: QueryResult = { columns: ['a'], rows: [{ a: 1 }], rowCount: 1, executionTimeMs: 50 }
      bigAdapter.runQuery.mockResolvedValueOnce(mockResult)
      const handler = handlers.get(CHANNELS.QUERY_EXECUTE)!

      // Act
      const result = await handler(mockEvent, { connectionId: 'conn-1', sql: 'SELECT 1', tabId: 'tab-1' })

      // Assert
      expect(result).toEqual(mockResult)
      expect(bigAdapter.runQuery).toHaveBeenCalledWith(bigConn, 'SELECT 1', 'tab-1', mockEvent.sender)
    })

    it('dispatches to the Postgres adapter based on connection engine', async () => {
      // Arrange
      storedConnections = [pgConn]
      const mockResult: QueryResult = { columns: ['a'], rows: [{ a: 1 }], rowCount: 1, executionTimeMs: 50 }
      pgAdapter.runQuery.mockResolvedValueOnce(mockResult)
      const handler = handlers.get(CHANNELS.QUERY_EXECUTE)!

      // Act
      const result = await handler(mockEvent, { connectionId: 'conn-pg-1', sql: 'SELECT 1', tabId: 'tab-pg-1' })

      // Assert
      expect(result).toEqual(mockResult)
      expect(pgAdapter.runQuery).toHaveBeenCalledWith(pgConn, 'SELECT 1', 'tab-pg-1', mockEvent.sender)
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
      bigAdapter.cancelRunningQuery.mockResolvedValueOnce(undefined)
      const handler = handlers.get(CHANNELS.QUERY_CANCEL)!

      // Act
      await handler({}, 'tab-to-cancel')

      // Assert
      expect(bigAdapter.cancelRunningQuery).toHaveBeenCalledWith('tab-to-cancel')
    })

    it('routes QUERY_CANCEL by tabId engine mapping', async () => {
      // Arrange — execute a Postgres query first to populate tabEngines
      storedConnections = [pgConn]
      const mockResult: QueryResult = { columns: ['a'], rows: [{ a: 1 }], rowCount: 1, executionTimeMs: 50 }
      pgAdapter.runQuery.mockResolvedValueOnce(mockResult)
      const execHandler = handlers.get(CHANNELS.QUERY_EXECUTE)!
      const cancelHandler = handlers.get(CHANNELS.QUERY_CANCEL)!

      // Act
      await execHandler(mockEvent, { connectionId: 'conn-pg-1', sql: 'SELECT 1', tabId: 'tab-pg-cancel' })
      pgAdapter.cancelRunningQuery.mockResolvedValueOnce(undefined)
      await cancelHandler({}, 'tab-pg-cancel')

      // Assert
      expect(pgAdapter.cancelRunningQuery).toHaveBeenCalledWith('tab-pg-cancel')
    })
  })

  describe(CHANNELS.QUERY_DRY_RUN, () => {
    it('calls dryRunQuery and returns the estimate', async () => {
      // Arrange
      bigAdapter.dryRunQuery.mockResolvedValueOnce({ bytesProcessed: 2048 })
      const handler = handlers.get(CHANNELS.QUERY_DRY_RUN)!

      // Act
      const result = await handler({}, { connectionId: 'conn-1', sql: 'SELECT *' })

      // Assert
      expect(result).toEqual({ bytesProcessed: 2048 })
      expect(bigAdapter.dryRunQuery).toHaveBeenCalledWith(bigConn, 'SELECT *')
    })

    it('dispatches to the Postgres adapter for dry-run by connection engine', async () => {
      // Arrange
      storedConnections = [pgConn]
      pgAdapter.dryRunQuery.mockResolvedValueOnce({ bytesProcessed: 0 })
      const handler = handlers.get(CHANNELS.QUERY_DRY_RUN)!

      // Act
      const result = await handler({}, { connectionId: 'conn-pg-1', sql: 'SELECT *' })

      // Assert
      expect(result).toEqual({ bytesProcessed: 0 })
      expect(pgAdapter.dryRunQuery).toHaveBeenCalledWith(pgConn, 'SELECT *')
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
