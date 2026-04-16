/**
 * snowflake.test.ts
 * Unit tests for the Snowflake adapter (src/main/db/snowflake.ts).
 * The snowflake-sdk is fully mocked — no real Snowflake calls.
 */
import { describe, it, expect, vi, beforeEach } from 'vitest'
import { EventEmitter } from 'events'
import { CHANNELS } from '../../../shared/ipc'
import type { SnowflakeConnection } from '../../../shared/types'

// ── Mock: snowflake-sdk ──────────────────────────────────────────────────────

const mockStatement = {
  getQueryId: vi.fn(() => 'sf-query-123'),
  getNumRows: vi.fn(() => 0),
  getColumns: vi.fn(() => [{ getName: () => 'id' }, { getName: () => 'name' }]),
  streamRows: vi.fn(),
  cancel: vi.fn((cb?: () => void) => cb?.())
}

const mockSfConn = {
  connect: vi.fn(),
  isUp: vi.fn(() => false), // false = always create fresh, avoids cache complications
  execute: vi.fn(),
  destroy: vi.fn((cb?: (err?: Error) => void) => cb?.())
}

vi.mock('snowflake-sdk', () => ({
  default: {
    configure: vi.fn(),
    createConnection: vi.fn(() => mockSfConn)
  }
}))

vi.mock('electron', () => ({}))

// ── Helpers ──────────────────────────────────────────────────────────────────

const conn: SnowflakeConnection = {
  id: 'sf-conn-1',
  name: 'Snowflake Test',
  engine: 'snowflake',
  account: 'MY-ACCOUNT',
  username: 'user',
  password: 'secret',
  warehouse: 'COMPUTE_WH',
  createdAt: '2024-01-01T00:00:00.000Z'
}

const mockWC = {
  send: vi.fn(),
  isDestroyed: vi.fn(() => false)
}

// Helper: mock executeAll so it resolves with the given rows
function mockExecuteAll(rows: Record<string, unknown>[]) {
  mockSfConn.execute.mockImplementationOnce(
    ({ complete }: { complete: (err: null, stmt: typeof mockStatement, rows: typeof rows) => void }) => {
      complete(null, mockStatement, rows)
      return mockStatement
    }
  )
}

// Helper: mock executeStream so it resolves with the given rows via streamRows
function mockExecuteStream(rows: Record<string, unknown>[], numRows = rows.length) {
  mockStatement.getNumRows.mockReturnValueOnce(numRows)
  mockStatement.streamRows.mockImplementationOnce(() => {
    const stream = new EventEmitter()
    process.nextTick(() => {
      rows.forEach((r) => stream.emit('data', r))
      stream.emit('end')
    })
    return stream
  })
  mockSfConn.execute.mockImplementationOnce(
    ({ complete }: { complete: (err: null, stmt: typeof mockStatement) => void }) => {
      process.nextTick(() => complete(null, mockStatement))
      return mockStatement
    }
  )
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
} = await import('../../../main/db/snowflake')

describe('Snowflake adapter', () => {
  beforeEach(() => {
    invalidateClient(conn.id)
    vi.clearAllMocks()
    // Reset to "never cached" so each test always creates a fresh connection
    mockSfConn.isUp.mockReturnValue(false)
    mockSfConn.connect.mockImplementation((cb: (err: null) => void) => cb(null))
    mockStatement.getNumRows.mockReturnValue(0)
    mockStatement.getColumns.mockReturnValue([{ getName: () => 'id' }])
    mockStatement.cancel.mockImplementation((cb?: () => void) => cb?.())
  })

  // ── testConnection ──────────────────────────────────────────────────────
  describe('testConnection', () => {
    it('returns ok:true when connection and ping succeed', async () => {
      mockExecuteAll([{ ping: 1 }])

      const result = await testConnection(conn)

      expect(result).toEqual({ ok: true })
    })

    it('returns ok:false with error when connect fails', async () => {
      mockSfConn.connect.mockImplementationOnce((cb: (err: Error) => void) =>
        cb(new Error('Invalid credentials'))
      )

      const result = await testConnection(conn)

      expect(result.ok).toBe(false)
      expect(result.error).toBe('Invalid credentials')
    })

    it('returns ok:false with error when the ping query fails', async () => {
      mockSfConn.execute.mockImplementationOnce(
        ({ complete }: { complete: (err: Error, stmt: null) => void }) => {
          complete(new Error('Auth failed'), null as never)
          return mockStatement
        }
      )

      const result = await testConnection(conn)

      expect(result.ok).toBe(false)
      expect(result.error).toBe('Auth failed')
    })
  })

  // ── listDatasets ────────────────────────────────────────────────────────
  describe('listDatasets', () => {
    it('maps SHOW SCHEMAS rows to Dataset objects', async () => {
      mockExecuteAll([
        { database_name: 'MYDB', name: 'PUBLIC', comment: '' },
        { database_name: 'MYDB', name: 'STAGING', comment: 'staging area' }
      ])

      const result = await listDatasets(conn)

      expect(result).toHaveLength(2)
      expect(result[0]).toMatchObject({ id: 'MYDB.PUBLIC', name: 'MYDB.PUBLIC', projectId: conn.account })
      expect(result[1].description).toBe('staging area')
    })

    it('filters out INFORMATION_SCHEMA', async () => {
      mockExecuteAll([
        { database_name: 'DB', name: 'PUBLIC', comment: '' },
        { database_name: 'DB', name: 'INFORMATION_SCHEMA', comment: '' }
      ])

      const result = await listDatasets(conn)

      expect(result).toHaveLength(1)
      expect(result[0].id).toBe('DB.PUBLIC')
    })
  })

  // ── listTables ──────────────────────────────────────────────────────────
  describe('listTables', () => {
    it('merges SHOW TABLES and SHOW VIEWS into a single list', async () => {
      // First executeAll: SHOW TABLES
      mockExecuteAll([{ name: 'orders', rows: '1000', bytes: '512', comment: '' }])
      // Second executeAll: SHOW VIEWS
      mockExecuteAll([{ name: 'orders_view', rows: '', bytes: '', comment: '' }])

      const result = await listTables(conn, 'MYDB.PUBLIC')

      expect(result.find((t) => t.type === 'TABLE' && t.name === 'orders')).toBeDefined()
      expect(result.find((t) => t.type === 'VIEW' && t.name === 'orders_view')).toBeDefined()
    })

    it('maps row counts and sizes when present', async () => {
      mockExecuteAll([{ name: 'big_table', rows: '5000000', bytes: '1073741824', comment: '' }])
      mockExecuteAll([])

      const result = await listTables(conn, 'MYDB.PUBLIC')

      expect(result[0].rowCount).toBe(5_000_000)
      expect(result[0].sizeBytes).toBe(1_073_741_824)
    })
  })

  // ── getTableSchema ──────────────────────────────────────────────────────
  describe('getTableSchema', () => {
    it('maps DESCRIBE TABLE rows to TableField objects', async () => {
      mockExecuteAll([
        { name: 'id', type: 'NUMBER(38,0)', 'null?': 'N', comment: '' },
        { name: 'email', type: 'VARCHAR(256)', 'null?': 'Y', comment: 'User email' }
      ])

      const result = await getTableSchema(conn, 'MYDB.PUBLIC', 'users')

      expect(result).toHaveLength(2)
      expect(result[0]).toMatchObject({ name: 'id', type: 'NUMBER(38,0)', mode: 'REQUIRED' })
      expect(result[1]).toMatchObject({ name: 'email', mode: 'NULLABLE', description: 'User email' })
    })
  })

  // ── runQuery ────────────────────────────────────────────────────────────
  describe('runQuery', () => {
    it('returns a QueryResult on success', async () => {
      mockExecuteStream([{ id: 1, val: 'a' }, { id: 2, val: 'b' }])

      const result = await runQuery(conn, 'SELECT id, val FROM t', 'tab-1', mockWC as never)

      expect(result.columns).toEqual(['id', 'val'])
      expect(result.rows).toHaveLength(2)
      expect(result.hasMore).toBe(false)
      expect(result.executionTimeMs).toBeGreaterThanOrEqual(0)
    })

    it('sends QUERY_LOG messages to webContents', async () => {
      mockExecuteStream([])

      await runQuery(conn, 'SELECT 1', 'tab-log', mockWC as never)

      expect(mockWC.send).toHaveBeenCalledWith(
        CHANNELS.QUERY_LOG,
        expect.objectContaining({ tabId: 'tab-log' })
      )
    })

    it('throws on query error', async () => {
      mockSfConn.execute.mockImplementationOnce(
        ({ complete }: { complete: (err: Error, stmt: null) => void }) => {
          process.nextTick(() => complete(new Error('Syntax error near FROM'), null as never))
          return mockStatement
        }
      )

      await expect(
        runQuery(conn, 'SELECT FROM', 'tab-err', mockWC as never)
      ).rejects.toThrow('Syntax error near FROM')
    })

    it('sets hasMore:true and pageToken when result exceeds page size', async () => {
      const rows = Array.from({ length: 100 }, (_, i) => ({ id: i }))
      // 150 total rows, first page fetches rows 0–99
      mockExecuteStream(rows, 150)

      const result = await runQuery(conn, 'SELECT id FROM t', 'tab-pages', mockWC as never)

      expect(result.hasMore).toBe(true)
      expect(result.pageToken).toBe('100')
      expect(result.totalRows).toBe(150)
    })

    it('derives columns from statement metadata when result is empty', async () => {
      mockStatement.getColumns.mockReturnValueOnce([
        { getName: () => 'col_a' },
        { getName: () => 'col_b' }
      ])
      mockExecuteStream([])

      const result = await runQuery(conn, 'SELECT col_a, col_b FROM t LIMIT 0', 'tab-empty', mockWC as never)

      expect(result.columns).toEqual(['col_a', 'col_b'])
    })
  })

  // ── cancelRunningQuery ──────────────────────────────────────────────────
  describe('cancelRunningQuery', () => {
    it('is a no-op when no query is active for the tab', async () => {
      await expect(cancelRunningQuery('unknown-tab')).resolves.toBeUndefined()
    })
  })

  // ── dryRunQuery ─────────────────────────────────────────────────────────
  describe('dryRunQuery', () => {
    it('executes EXPLAIN and returns bytesProcessed: 0', async () => {
      mockExecuteAll([{ rows: 'GlobalStats' }])

      const result = await dryRunQuery(conn, 'SELECT 1')

      expect(result).toEqual({ bytesProcessed: 0 })
    })

    it('throws when the SQL is invalid', async () => {
      mockSfConn.execute.mockImplementationOnce(
        ({ complete }: { complete: (err: Error, stmt: null) => void }) => {
          complete(new Error('Invalid SQL'), null as never)
          return mockStatement
        }
      )

      await expect(dryRunQuery(conn, 'GARBAGE')).rejects.toThrow('Invalid SQL')
    })
  })

  // ── invalidateClient ────────────────────────────────────────────────────
  describe('invalidateClient', () => {
    it('destroys the cached connection', async () => {
      // Warm up: connect by running testConnection
      mockExecuteAll([{ ping: 1 }])
      // Make isUp return true so the cached connection is reused (proves it's in cache)
      mockSfConn.isUp.mockReturnValue(true)
      await testConnection(conn)

      invalidateClient(conn.id)

      expect(mockSfConn.destroy).toHaveBeenCalled()
    })

    it('is a no-op when no connection is cached', () => {
      expect(() => invalidateClient('no-such-id')).not.toThrow()
    })
  })

  // ── account hostname normalisation ──────────────────────────────────────
  describe('account normalisation', () => {
    it('strips .snowflakecomputing.com suffix before passing to the SDK', async () => {
      const { default: snowflake } = await import('snowflake-sdk')
      const fullDomainConn: SnowflakeConnection = {
        ...conn,
        id: 'sf-full-domain',
        account: 'MY-ACCOUNT.snowflakecomputing.com'
      }
      mockExecuteAll([{ ping: 1 }])

      await testConnection(fullDomainConn)

      expect(snowflake.createConnection).toHaveBeenCalledWith(
        expect.objectContaining({ account: 'MY-ACCOUNT' })
      )
    })
  })
})
