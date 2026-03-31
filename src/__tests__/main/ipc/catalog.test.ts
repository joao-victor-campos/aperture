/**
 * catalog.test.ts
 * Tests the IPC catalog handlers (src/main/ipc/catalog.ts).
 */
import { describe, it, expect, vi, beforeEach } from 'vitest'
import { CHANNELS } from '../../../shared/ipc'
import type { Connection } from '../../../shared/types'

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
  listDatasets: vi.fn(),
  listTables: vi.fn(),
  getTableSchema: vi.fn()
}

const pgAdapter = {
  listDatasets: vi.fn(),
  listTables: vi.fn(),
  getTableSchema: vi.fn()
}

vi.mock('../../../main/db/adapterRegistry', () => ({
  getAdapterForConnection: (connection: Connection) =>
    connection.engine === 'bigquery' ? bigAdapter : pgAdapter
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

describe('Catalog IPC handlers', () => {
  beforeEach(async () => {
    handlers.clear()
    vi.clearAllMocks()
    storedConnections = [bigConn]

    const { registerCatalogHandlers } = await import('../../../main/ipc/catalog')
    registerCatalogHandlers()
  })

  describe(CHANNELS.CATALOG_DATASETS, () => {
    it('returns datasets for a known connection', async () => {
      // Arrange
      const mockDs = [{ id: 'ds1', projectId: 'proj', name: 'ds1' }]
      bigAdapter.listDatasets.mockResolvedValueOnce(mockDs)
      const handler = handlers.get(CHANNELS.CATALOG_DATASETS)!

      // Act
      const result = await handler({}, 'conn-1')

      // Assert
      expect(result).toEqual(mockDs)
      expect(bigAdapter.listDatasets).toHaveBeenCalledWith(bigConn)
    })

    it('dispatches to the Postgres adapter for datasets', async () => {
      // Arrange
      storedConnections = [pgConn]
      const mockDs = [{ id: 'schema1', projectId: 'db', name: 'schema1' }]
      pgAdapter.listDatasets.mockResolvedValueOnce(mockDs)
      const handler = handlers.get(CHANNELS.CATALOG_DATASETS)!

      // Act
      const result = await handler({}, 'conn-pg-1')

      // Assert
      expect(result).toEqual(mockDs)
      expect(pgAdapter.listDatasets).toHaveBeenCalledWith(pgConn)
    })

    it('throws when the connection id is unknown', async () => {
      // Arrange
      const handler = handlers.get(CHANNELS.CATALOG_DATASETS)!

      // Act / Assert
      await expect(handler({}, 'bad-id')).rejects.toThrow('Connection not found')
    })
  })

  describe(CHANNELS.CATALOG_TABLES, () => {
    it('returns tables for a known connection and dataset', async () => {
      // Arrange
      const mockTables = [{ id: 'tbl1', datasetId: 'ds1', projectId: 'proj', name: 'tbl1', type: 'TABLE' as const }]
      bigAdapter.listTables.mockResolvedValueOnce(mockTables)
      const handler = handlers.get(CHANNELS.CATALOG_TABLES)!

      // Act
      const result = await handler({}, { connectionId: 'conn-1', datasetId: 'ds1' })

      // Assert
      expect(result).toEqual(mockTables)
      expect(bigAdapter.listTables).toHaveBeenCalledWith(bigConn, 'ds1')
    })

    it('throws when the connection id is unknown', async () => {
      // Arrange
      const handler = handlers.get(CHANNELS.CATALOG_TABLES)!

      // Act / Assert
      await expect(handler({}, { connectionId: 'bad-id', datasetId: 'ds1' })).rejects.toThrow('Connection not found')
    })
  })

  describe(CHANNELS.CATALOG_TABLE_SCHEMA, () => {
    it('returns schema fields for a known table', async () => {
      // Arrange
      const mockFields = [{ name: 'id', type: 'INTEGER', mode: 'REQUIRED' as const }]
      bigAdapter.getTableSchema.mockResolvedValueOnce(mockFields)
      const handler = handlers.get(CHANNELS.CATALOG_TABLE_SCHEMA)!

      // Act
      const result = await handler({}, { connectionId: 'conn-1', projectId: 'proj', datasetId: 'ds1', tableId: 'tbl1' })

      // Assert
      expect(result).toEqual(mockFields)
      expect(bigAdapter.getTableSchema).toHaveBeenCalledWith(bigConn, 'ds1', 'tbl1')
    })

    it('throws when the connection id is unknown', async () => {
      // Arrange
      const handler = handlers.get(CHANNELS.CATALOG_TABLE_SCHEMA)!

      // Act / Assert
      await expect(
        handler({}, { connectionId: 'bad-id', projectId: 'p', datasetId: 'ds1', tableId: 'tbl1' })
      ).rejects.toThrow('Connection not found')
    })
  })
})
