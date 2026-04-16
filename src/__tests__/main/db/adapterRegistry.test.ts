/**
 * adapterRegistry.test.ts
 * Tests that the registry returns the correct adapter for each engine,
 * including the backwards-compatibility fallback for legacy connections
 * that have no `engine` field.
 */
import { describe, it, expect, vi } from 'vitest'
import type { Connection } from '../../../shared/types'

// Mock all three engine modules to avoid network/native deps
vi.mock('../../../main/db/bigquery', () => ({
  testConnection: vi.fn(),
  listDatasets: vi.fn(),
  listTables: vi.fn(),
  getTableSchema: vi.fn(),
  runQuery: vi.fn(),
  getQueryPage: vi.fn(),
  cancelRunningQuery: vi.fn(),
  dryRunQuery: vi.fn(),
  invalidateClient: vi.fn()
}))

vi.mock('../../../main/db/postgres', () => ({
  testConnection: vi.fn(),
  listDatasets: vi.fn(),
  listTables: vi.fn(),
  getTableSchema: vi.fn(),
  runQuery: vi.fn(),
  getQueryPage: vi.fn(),
  cancelRunningQuery: vi.fn(),
  dryRunQuery: vi.fn(),
  invalidateClient: vi.fn()
}))

vi.mock('../../../main/db/snowflake', () => ({
  testConnection: vi.fn(),
  listDatasets: vi.fn(),
  listTables: vi.fn(),
  getTableSchema: vi.fn(),
  runQuery: vi.fn(),
  getQueryPage: vi.fn(),
  cancelRunningQuery: vi.fn(),
  dryRunQuery: vi.fn(),
  invalidateClient: vi.fn()
}))

vi.mock('electron', () => ({}))

const { getAdapterForEngine, getAdapterForConnection } = await import('../../../main/db/adapterRegistry')
const bq = await import('../../../main/db/bigquery')
const pg = await import('../../../main/db/postgres')
const sf = await import('../../../main/db/snowflake')

describe('adapterRegistry', () => {
  describe('getAdapterForEngine', () => {
    it('returns the BigQuery adapter for "bigquery"', () => {
      const adapter = getAdapterForEngine('bigquery')
      expect(adapter.testConnection).toBe(bq.testConnection)
    })

    it('returns the Postgres adapter for "postgres"', () => {
      const adapter = getAdapterForEngine('postgres')
      expect(adapter.testConnection).toBe(pg.testConnection)
    })

    it('returns the Snowflake adapter for "snowflake"', () => {
      const adapter = getAdapterForEngine('snowflake')
      expect(adapter.testConnection).toBe(sf.testConnection)
    })
  })

  describe('getAdapterForConnection', () => {
    it('dispatches to the BigQuery adapter for a bigquery connection', () => {
      const conn: Connection = {
        id: 'bq-1', name: 'BQ', engine: 'bigquery',
        projectId: 'proj', credentialType: 'adc',
        createdAt: '2024-01-01T00:00:00Z'
      }
      const adapter = getAdapterForConnection(conn)
      expect(adapter.testConnection).toBe(bq.testConnection)
    })

    it('dispatches to the Postgres adapter for a postgres connection', () => {
      const conn: Connection = {
        id: 'pg-1', name: 'PG', engine: 'postgres',
        host: 'localhost', port: 5432, database: 'db',
        user: 'u', password: 'p',
        createdAt: '2024-01-01T00:00:00Z'
      }
      const adapter = getAdapterForConnection(conn)
      expect(adapter.testConnection).toBe(pg.testConnection)
    })

    it('dispatches to the Snowflake adapter for a snowflake connection', () => {
      const conn: Connection = {
        id: 'sf-1', name: 'SF', engine: 'snowflake',
        account: 'acc', username: 'u', password: 'p', warehouse: 'wh',
        createdAt: '2024-01-01T00:00:00Z'
      }
      const adapter = getAdapterForConnection(conn)
      expect(adapter.testConnection).toBe(sf.testConnection)
    })

    it('falls back to BigQuery for legacy connections without an engine field', () => {
      // Simulate a connection saved before the engine field was introduced
      const legacyConn = {
        id: 'legacy-1', name: 'Legacy BQ',
        projectId: 'old-proj', credentialType: 'adc',
        createdAt: '2024-01-01T00:00:00Z'
      } as unknown as Connection

      const adapter = getAdapterForConnection(legacyConn)
      expect(adapter.testConnection).toBe(bq.testConnection)
    })
  })
})
