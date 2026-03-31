/**
 * bigquery.test.ts
 * Unit tests for the BigQuery bridge (src/main/db/bigquery.ts).
 * The @google-cloud/bigquery client is fully mocked — no real GCP calls.
 */
import { describe, it, expect, vi, beforeEach } from 'vitest'
import { CHANNELS } from '../../../shared/ipc'
import type { Connection } from '../../../shared/types'

// ── Mock: @google-cloud/bigquery ────────────────────────────────────────────
const mockJob = {
  id: 'job-abc-123',
  metadata: {} as Record<string, unknown>,
  getQueryResults: vi.fn(),
  cancel: vi.fn()
}

const mockTable = {
  getMetadata: vi.fn()
}

const mockDataset = {
  getTables: vi.fn(),
  table: vi.fn(() => mockTable)
}

const mockClient = {
  getDatasets: vi.fn(),
  dataset: vi.fn(() => mockDataset),
  createQueryJob: vi.fn(),
  query: vi.fn()
}

vi.mock('@google-cloud/bigquery', () => ({
  BigQuery: vi.fn(() => mockClient)
}))

// ── Mock: electron (WebContents type is runtime-imported in the module) ─────
// bigquery.ts only uses `import type { WebContents }`, so electron itself
// doesn't need a full mock — but we mock it for safety.
vi.mock('electron', () => ({}))

// ── Helpers ──────────────────────────────────────────────────────────────────
const conn: Connection = {
  id: 'conn-1',
  name: 'Test',
  engine: 'bigquery',
  projectId: 'my-project',
  credentialType: 'adc',
  createdAt: '2024-01-01T00:00:00.000Z'
}

// Minimal WebContents stub
const mockWC = {
  send: vi.fn(),
  isDestroyed: vi.fn(() => false)
}

// ── Module import (after mocks are registered) ───────────────────────────────
const {
  testConnection,
  listDatasets,
  listTables,
  getTableSchema,
  runQuery,
  cancelRunningQuery,
  dryRunQuery,
  invalidateClient
} = await import('../../../main/db/bigquery')

describe('BigQuery bridge', () => {
  beforeEach(() => {
    // Clear the BigQuery client cache so each test starts from scratch
    invalidateClient(conn.id)
    // Reset mutable job metadata so tests don't bleed state into each other
    mockJob.metadata = {}
  })

  // ── testConnection ──────────────────────────────────────────────────────
  describe('testConnection', () => {
    it('returns ok:true when the client can reach BigQuery', async () => {
      // Arrange
      mockClient.getDatasets.mockResolvedValueOnce([[]])

      // Act
      const result = await testConnection(conn)

      // Assert
      expect(result).toEqual({ ok: true })
    })

    it('returns ok:false with the error message when the request fails', async () => {
      // Arrange
      mockClient.getDatasets.mockRejectedValueOnce(new Error('Permission denied'))

      // Act
      const result = await testConnection(conn)

      // Assert
      expect(result.ok).toBe(false)
      expect(result.error).toBe('Permission denied')
    })
  })

  // ── listDatasets ────────────────────────────────────────────────────────
  describe('listDatasets', () => {
    it('maps BigQuery dataset objects to the Dataset domain type', async () => {
      // Arrange
      mockClient.getDatasets.mockResolvedValueOnce([
        [{ id: 'ds1', metadata: { location: 'US', description: 'Main dataset' } }]
      ])

      // Act
      const result = await listDatasets(conn)

      // Assert
      expect(result).toHaveLength(1)
      expect(result[0]).toMatchObject({
        id: 'ds1',
        projectId: 'my-project',
        name: 'ds1',
        location: 'US',
        description: 'Main dataset'
      })
    })

    it('handles datasets with no metadata gracefully', async () => {
      // Arrange
      mockClient.getDatasets.mockResolvedValueOnce([[{ id: 'bare-ds', metadata: {} }]])

      // Act
      const result = await listDatasets(conn)

      // Assert
      expect(result[0].location).toBeUndefined()
      expect(result[0].description).toBeUndefined()
    })
  })

  // ── listTables ──────────────────────────────────────────────────────────
  describe('listTables', () => {
    it('maps BigQuery table objects to the Table domain type', async () => {
      // Arrange
      mockDataset.getTables.mockResolvedValueOnce([
        [{ id: 'tbl1', metadata: { type: 'TABLE', numRows: '5000', numBytes: '1048576' } }]
      ])

      // Act
      const result = await listTables(conn, 'ds1')

      // Assert
      expect(result).toHaveLength(1)
      expect(result[0]).toMatchObject({
        id: 'tbl1',
        datasetId: 'ds1',
        projectId: 'my-project',
        type: 'TABLE',
        rowCount: 5000,
        sizeBytes: 1048576
      })
    })

    it('returns VIEW type correctly', async () => {
      // Arrange
      mockDataset.getTables.mockResolvedValueOnce([
        [{ id: 'vw1', metadata: { type: 'VIEW' } }]
      ])

      // Act
      const [table] = await listTables(conn, 'ds1')

      // Assert
      expect(table.type).toBe('VIEW')
    })
  })

  // ── getTableSchema ──────────────────────────────────────────────────────
  describe('getTableSchema', () => {
    it('returns flat fields with correct names and types', async () => {
      // Arrange
      mockTable.getMetadata.mockResolvedValueOnce([{
        schema: {
          fields: [
            { name: 'id', type: 'INTEGER', mode: 'REQUIRED' },
            { name: 'email', type: 'STRING', mode: 'NULLABLE', description: 'User email' }
          ]
        }
      }])

      // Act
      const fields = await getTableSchema(conn, 'ds1', 'tbl1')

      // Assert
      expect(fields).toHaveLength(2)
      expect(fields[0]).toMatchObject({ name: 'id', type: 'INTEGER', mode: 'REQUIRED' })
      expect(fields[1]).toMatchObject({ name: 'email', type: 'STRING', description: 'User email' })
    })

    it('recursively maps nested RECORD fields', async () => {
      // Arrange
      mockTable.getMetadata.mockResolvedValueOnce([{
        schema: {
          fields: [
            {
              name: 'address', type: 'RECORD', mode: 'NULLABLE',
              fields: [{ name: 'city', type: 'STRING', mode: 'NULLABLE' }]
            }
          ]
        }
      }])

      // Act
      const fields = await getTableSchema(conn, 'ds1', 'tbl1')

      // Assert
      expect(fields[0].fields).toHaveLength(1)
      expect(fields[0].fields![0].name).toBe('city')
    })

    it('returns empty array when schema has no fields', async () => {
      // Arrange
      mockTable.getMetadata.mockResolvedValueOnce([{ schema: { fields: [] } }])

      // Act
      const fields = await getTableSchema(conn, 'ds1', 'tbl1')

      // Assert
      expect(fields).toEqual([])
    })
  })

  // ── runQuery ────────────────────────────────────────────────────────────
  describe('runQuery', () => {
    it('returns a QueryResult with rows, columns and bytesProcessed on success', async () => {
      // Arrange
      const rows = [{ name: 'Alice' }, { name: 'Bob' }]
      // Statistics are read from job.metadata after completion (not from the response payload)
      mockJob.metadata = { statistics: { query: { totalBytesProcessed: '4096' } } }
      mockJob.getQueryResults.mockResolvedValueOnce([rows])
      mockClient.createQueryJob.mockResolvedValueOnce([mockJob])

      // Act
      const result = await runQuery(conn, 'SELECT name FROM users', 'tab-1', mockWC as never)

      // Assert
      expect(result.rowCount).toBe(2)
      expect(result.columns).toEqual(['name'])
      expect(result.rows).toEqual(rows)
      expect(result.bytesProcessed).toBe(4096)
    })

    it('sends QUERY_LOG messages to the renderer during execution', async () => {
      // Arrange
      mockJob.getQueryResults.mockResolvedValueOnce([[{ x: 1 }], null, {}])
      mockClient.createQueryJob.mockResolvedValueOnce([mockJob])

      // Act
      await runQuery(conn, 'SELECT 1 AS x', 'tab-log', mockWC as never)

      // Assert — at least a "Creating" and a "Done" message were sent
      expect(mockWC.send).toHaveBeenCalledWith(
        CHANNELS.QUERY_LOG,
        expect.objectContaining({ tabId: 'tab-log' })
      )
      expect(mockWC.send.mock.calls.length).toBeGreaterThanOrEqual(2)
    })

    it('handles an empty result set (no columns)', async () => {
      // Arrange
      mockJob.getQueryResults.mockResolvedValueOnce([[], null, {}])
      mockClient.createQueryJob.mockResolvedValueOnce([mockJob])

      // Act
      const result = await runQuery(conn, 'SELECT 1 WHERE false', 'tab-empty', mockWC as never)

      // Assert
      expect(result.rowCount).toBe(0)
      expect(result.columns).toEqual([])
    })

    it('propagates errors thrown by the BigQuery job', async () => {
      // Arrange
      mockJob.getQueryResults.mockRejectedValueOnce(new Error('Syntax error in query'))
      mockClient.createQueryJob.mockResolvedValueOnce([mockJob])

      // Act / Assert
      await expect(
        runQuery(conn, 'SELECT bad sql', 'tab-err', mockWC as never)
      ).rejects.toThrow('Syntax error in query')
    })

    it('cancels the job and rejects when the 180s timeout is exceeded', async () => {
      // Arrange — query that never resolves
      vi.useFakeTimers()
      mockJob.getQueryResults.mockReturnValue(new Promise(() => {}))
      mockJob.cancel.mockResolvedValue([{}])
      mockClient.createQueryJob.mockResolvedValueOnce([mockJob])

      // Act — start query, attach handler first so the rejection is always caught,
      //       then advance past the 180s timeout threshold.
      const runPromise = runQuery(conn, 'SELECT sleep(999)', 'tab-timeout', mockWC as never)
      const expectation = expect(runPromise).rejects.toThrow('timed out')
      await vi.advanceTimersByTimeAsync(181_000)

      // Assert
      await expectation
      expect(mockJob.cancel).toHaveBeenCalled()

      vi.useRealTimers()
    })
  })

  // ── cancelRunningQuery ──────────────────────────────────────────────────
  describe('cancelRunningQuery', () => {
    it('is a no-op when no job is registered for the tabId', async () => {
      // Act / Assert — should not throw
      await expect(cancelRunningQuery('no-such-tab')).resolves.toBeUndefined()
    })

    it('cancels the running job and sends a cancellation log', async () => {
      // Arrange — start a query that hangs indefinitely
      let unblock!: (val: unknown) => void
      mockJob.getQueryResults.mockReturnValue(new Promise((r) => { unblock = r }))
      mockJob.cancel.mockResolvedValue([{}])
      mockClient.createQueryJob.mockResolvedValueOnce([mockJob])

      const tabId = 'tab-cancel-test'
      const runPromise = runQuery(conn, 'SELECT 1', tabId, mockWC as never)

      // Wait for the job to be registered (after createQueryJob resolves)
      await new Promise((r) => setImmediate(r))

      // Act — cancel
      await cancelRunningQuery(tabId)

      // Assert
      expect(mockJob.cancel).toHaveBeenCalled()
      expect(mockWC.send).toHaveBeenCalledWith(
        CHANNELS.QUERY_LOG,
        expect.objectContaining({ message: 'Cancelled by user.' })
      )

      // Clean up hanging promise
      unblock([[], null, {}])
      await runPromise.catch(() => {})
    })
  })

  // ── dryRunQuery ─────────────────────────────────────────────────────────
  describe('dryRunQuery', () => {
    it('returns the estimated bytes processed', async () => {
      // Arrange — dryRunQuery uses createQueryJob({dryRun:true}) and reads
      // bytesProcessed from the job's metadata (not from a response payload)
      const dryJob = { metadata: { statistics: { query: { totalBytesProcessed: '10240' } } } }
      mockClient.createQueryJob.mockResolvedValueOnce([dryJob])

      // Act
      const result = await dryRunQuery(conn, 'SELECT * FROM huge_table')

      // Assert
      expect(result.bytesProcessed).toBe(10240)
      expect(mockClient.createQueryJob).toHaveBeenCalledWith(
        expect.objectContaining({ dryRun: true })
      )
    })

    it('returns 0 when the statistics field is absent', async () => {
      // Arrange
      const dryJob = { metadata: {} }
      mockClient.createQueryJob.mockResolvedValueOnce([dryJob])

      // Act
      const result = await dryRunQuery(conn, 'SELECT 1')

      // Assert
      expect(result.bytesProcessed).toBe(0)
    })
  })

  // ── invalidateClient ────────────────────────────────────────────────────
  describe('invalidateClient', () => {
    it('forces a fresh client to be created on the next call', async () => {
      // Arrange — populate the cache
      mockClient.getDatasets.mockResolvedValue([[]])
      await testConnection(conn)
      const { BigQuery } = await import('@google-cloud/bigquery')
      const ctorCallsBefore = (BigQuery as ReturnType<typeof vi.fn>).mock.calls.length

      // Act
      invalidateClient(conn.id)
      await testConnection(conn) // should trigger a new BigQuery() call

      // Assert
      const ctorCallsAfter = (BigQuery as ReturnType<typeof vi.fn>).mock.calls.length
      expect(ctorCallsAfter).toBeGreaterThan(ctorCallsBefore)
    })
  })
})
