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

// ── Mock: store ──────────────────────────────────────────────────────────────
const conn: Connection = {
  id: 'conn-1', name: 'Test', projectId: 'proj',
  credentialType: 'adc', createdAt: '2024-01-01T00:00:00Z'
}

vi.mock('../../../main/db/store', () => ({
  store: {
    get: vi.fn((_key: string) => [conn])
  }
}))

// ── Mock: bigquery catalog functions ─────────────────────────────────────────
vi.mock('../../../main/db/bigquery', () => ({
  listDatasets: vi.fn(),
  listTables: vi.fn(),
  getTableSchema: vi.fn()
}))

describe('Catalog IPC handlers', () => {
  beforeEach(async () => {
    handlers.clear()
    vi.clearAllMocks()

    const { registerCatalogHandlers } = await import('../../../main/ipc/catalog')
    registerCatalogHandlers()
  })

  describe(CHANNELS.CATALOG_DATASETS, () => {
    it('returns datasets for a known connection', async () => {
      // Arrange
      const { listDatasets } = await import('../../../main/db/bigquery')
      const mockDs = [{ id: 'ds1', projectId: 'proj', name: 'ds1' }]
      ;(listDatasets as ReturnType<typeof vi.fn>).mockResolvedValueOnce(mockDs)
      const handler = handlers.get(CHANNELS.CATALOG_DATASETS)!

      // Act
      const result = await handler({}, 'conn-1')

      // Assert
      expect(result).toEqual(mockDs)
      expect(listDatasets).toHaveBeenCalledWith(conn)
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
      const { listTables } = await import('../../../main/db/bigquery')
      const mockTables = [{ id: 'tbl1', datasetId: 'ds1', projectId: 'proj', name: 'tbl1', type: 'TABLE' as const }]
      ;(listTables as ReturnType<typeof vi.fn>).mockResolvedValueOnce(mockTables)
      const handler = handlers.get(CHANNELS.CATALOG_TABLES)!

      // Act
      const result = await handler({}, { connectionId: 'conn-1', datasetId: 'ds1' })

      // Assert
      expect(result).toEqual(mockTables)
      expect(listTables).toHaveBeenCalledWith(conn, 'ds1')
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
      const { getTableSchema } = await import('../../../main/db/bigquery')
      const mockFields = [{ name: 'id', type: 'INTEGER', mode: 'REQUIRED' as const }]
      ;(getTableSchema as ReturnType<typeof vi.fn>).mockResolvedValueOnce(mockFields)
      const handler = handlers.get(CHANNELS.CATALOG_TABLE_SCHEMA)!

      // Act
      const result = await handler({}, { connectionId: 'conn-1', projectId: 'proj', datasetId: 'ds1', tableId: 'tbl1' })

      // Assert
      expect(result).toEqual(mockFields)
      expect(getTableSchema).toHaveBeenCalledWith(conn, 'ds1', 'tbl1')
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
