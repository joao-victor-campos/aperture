/**
 * postgres.test.ts
 * Unit tests for the Postgres adapter (src/main/db/postgres.ts).
 * The `pg` module is fully mocked — no real database calls.
 */
import { describe, it, expect, vi, beforeEach } from 'vitest'
import { CHANNELS } from '../../../shared/ipc'
import type { PostgresConnection } from '../../../shared/types'

// ── Mock: pg ─────────────────────────────────────────────────────────────────

const mockClient = {
  query: vi.fn(),
  release: vi.fn()
}

const mockPool = {
  connect: vi.fn(async () => mockClient),
  query: vi.fn(),
  end: vi.fn(async () => {})
}

vi.mock('pg', () => ({
  Pool: vi.fn(() => mockPool),
  Client: vi.fn()
}))

vi.mock('electron', () => ({}))

// ── Helpers ──────────────────────────────────────────────────────────────────

const conn: PostgresConnection = {
  id: 'pg-conn-1',
  name: 'Postgres Test',
  engine: 'postgres',
  host: 'localhost',
  port: 5432,
  database: 'testdb',
  user: 'user',
  password: 'secret',
  createdAt: '2024-01-01T00:00:00.000Z'
}

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
  dryRunQuery,
  invalidateClient,
  getQueryPage
} = await import('../../../main/db/postgres')

describe('Postgres adapter', () => {
  beforeEach(() => {
    invalidateClient(conn.id)
    vi.clearAllMocks()
    mockPool.connect.mockResolvedValue(mockClient)
    mockClient.release.mockReturnValue(undefined)
  })

  // ── testConnection ──────────────────────────────────────────────────────
  describe('testConnection', () => {
    it('returns ok:true when pool.connect succeeds', async () => {
      const result = await testConnection(conn)
      expect(result).toEqual({ ok: true })
      expect(mockClient.release).toHaveBeenCalled()
    })

    it('returns ok:false with error when connection fails', async () => {
      mockPool.connect.mockRejectedValueOnce(new Error('ECONNREFUSED'))
      const result = await testConnection(conn)
      expect(result.ok).toBe(false)
      expect(result.error).toBe('ECONNREFUSED')
    })
  })

  // ── listDatasets ────────────────────────────────────────────────────────
  describe('listDatasets', () => {
    it('returns schemas excluding system schemas', async () => {
      mockPool.query.mockResolvedValueOnce({
        rows: [{ schema_name: 'public' }, { schema_name: 'app' }]
      })

      const result = await listDatasets(conn)

      expect(result).toHaveLength(2)
      expect(result[0]).toMatchObject({ id: 'public', name: 'public', projectId: 'testdb' })
    })
  })

  // ── listTables ──────────────────────────────────────────────────────────
  describe('listTables', () => {
    it('maps tables and views to the Table domain type', async () => {
      mockPool.query.mockResolvedValueOnce({
        rows: [
          { table_name: 'users', table_type: 'BASE TABLE' },
          { table_name: 'active_users', table_type: 'VIEW' }
        ]
      })

      const result = await listTables(conn, 'public')

      expect(result).toHaveLength(2)
      expect(result.find((t) => t.name === 'users')?.type).toBe('TABLE')
      expect(result.find((t) => t.name === 'active_users')?.type).toBe('VIEW')
    })
  })

  // ── getTableSchema ──────────────────────────────────────────────────────
  describe('getTableSchema', () => {
    it('maps column rows to TableField objects', async () => {
      mockPool.query.mockResolvedValueOnce({
        rows: [
          { column_name: 'id', data_type: 'integer', is_nullable: 'NO' },
          { column_name: 'email', data_type: 'text', is_nullable: 'YES' }
        ]
      })

      const result = await getTableSchema(conn, 'public', 'users')

      expect(result).toHaveLength(2)
      expect(result[0]).toMatchObject({ name: 'id', type: 'integer', mode: 'REQUIRED' })
      expect(result[1]).toMatchObject({ name: 'email', type: 'text', mode: 'NULLABLE' })
    })
  })

  // ── runQuery ────────────────────────────────────────────────────────────
  describe('runQuery', () => {
    it('returns a QueryResult with first page of rows', async () => {
      mockClient.query
        .mockResolvedValueOnce({ rows: [{ pg_backend_pid: 42 }] }) // pg_backend_pid
        .mockResolvedValueOnce(undefined) // SET statement_timeout
        .mockResolvedValueOnce({ rows: [{ id: 1, name: 'Alice' }, { id: 2, name: 'Bob' }] }) // actual query

      const result = await runQuery(conn, 'SELECT * FROM users', 'tab-1', mockWC as never)

      expect(result.columns).toEqual(['id', 'name'])
      expect(result.rows).toHaveLength(2)
      expect(result.executionTimeMs).toBeGreaterThanOrEqual(0)
    })

    it('sends log messages to webContents during execution', async () => {
      mockClient.query
        .mockResolvedValueOnce({ rows: [{ pg_backend_pid: 99 }] })
        .mockResolvedValueOnce(undefined)
        .mockResolvedValueOnce({ rows: [] })

      await runQuery(conn, 'SELECT 1', 'tab-log', mockWC as never)

      expect(mockWC.send).toHaveBeenCalledWith(
        CHANNELS.QUERY_LOG,
        expect.objectContaining({ tabId: 'tab-log' })
      )
    })

    it('throws and logs on query error', async () => {
      mockClient.query
        .mockResolvedValueOnce({ rows: [{ pg_backend_pid: 1 }] })
        .mockResolvedValueOnce(undefined)
        .mockRejectedValueOnce(new Error('relation "missing_table" does not exist'))

      await expect(
        runQuery(conn, 'SELECT * FROM missing_table', 'tab-err', mockWC as never)
      ).rejects.toThrow('relation "missing_table" does not exist')
    })

    it('sets hasMore:true when rows exceed page size', async () => {
      const manyRows = Array.from({ length: 150 }, (_, i) => ({ id: i }))
      mockClient.query
        .mockResolvedValueOnce({ rows: [{ pg_backend_pid: 1 }] })
        .mockResolvedValueOnce(undefined)
        .mockResolvedValueOnce({ rows: manyRows })

      const result = await runQuery(conn, 'SELECT id FROM big', 'tab-pages', mockWC as never)

      expect(result.hasMore).toBe(true)
      expect(result.rows).toHaveLength(100) // first page only
      expect(result.rowCount).toBe(150)
    })
  })

  // ── getQueryPage ────────────────────────────────────────────────────────
  describe('getQueryPage', () => {
    it('throws when no cached results exist for the tab', async () => {
      await expect(getQueryPage('no-such-tab', '1')).rejects.toThrow('No cached results')
    })

    it('returns the correct page slice after runQuery', async () => {
      const manyRows = Array.from({ length: 150 }, (_, i) => ({ id: i }))
      mockClient.query
        .mockResolvedValueOnce({ rows: [{ pg_backend_pid: 1 }] })
        .mockResolvedValueOnce(undefined)
        .mockResolvedValueOnce({ rows: manyRows })

      await runQuery(conn, 'SELECT id FROM big', 'tab-paged', mockWC as never)

      const page2 = await getQueryPage('tab-paged', '1')

      expect(page2.rows).toHaveLength(50) // rows 100-149
      expect(page2.hasMore).toBe(false)
    })
  })

  // ── dryRunQuery ─────────────────────────────────────────────────────────
  describe('dryRunQuery', () => {
    it('runs EXPLAIN and returns bytesProcessed: 0', async () => {
      mockPool.query.mockResolvedValueOnce({ rows: [] })
      const result = await dryRunQuery(conn, 'SELECT 1')
      expect(result).toEqual({ bytesProcessed: 0 })
    })

    it('throws when EXPLAIN fails', async () => {
      mockPool.query.mockRejectedValueOnce(new Error('syntax error'))
      await expect(dryRunQuery(conn, 'GARBAGE')).rejects.toThrow('syntax error')
    })
  })

  // ── invalidateClient ────────────────────────────────────────────────────
  describe('invalidateClient', () => {
    it('calls pool.end() and removes the pool from cache', async () => {
      // Warm up the pool by running a query
      mockPool.query.mockResolvedValueOnce({ rows: [] })
      await listDatasets(conn)

      invalidateClient(conn.id)

      expect(mockPool.end).toHaveBeenCalled()
    })

    it('is a no-op when no pool is cached', () => {
      expect(() => invalidateClient('unknown-id')).not.toThrow()
    })
  })
})
