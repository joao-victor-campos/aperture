/**
 * neo4j.test.ts
 * Unit tests for the Neo4j adapter (src/main/db/neo4j.ts).
 * neo4j-driver is fully mocked — no real Bolt connections.
 */
import { describe, it, expect, vi, beforeEach } from 'vitest'
import { CHANNELS } from '../../../shared/ipc'
import type { Neo4jConnection } from '../../../shared/types'

// ── Fake driver value classes (instanceof-compatible with mocked neo4j.types.*)
class FakeInteger {
  constructor(public value: number) {}
  toNumber() { return this.value }
  toString() { return String(this.value) }
}
class FakeNode {
  identity = new FakeInteger(0)
  constructor(
    public elementId: string,
    public labels: string[],
    public properties: Record<string, unknown>,
  ) {}
}
class FakeRelationship {
  constructor(
    public elementId: string,
    public startNodeElementId: string,
    public endNodeElementId: string,
    public type: string,
    public properties: Record<string, unknown>,
  ) {}
}
class FakePath {
  constructor(public segments: { start: FakeNode; relationship: FakeRelationship; end: FakeNode }[]) {}
}

// ── Mock: neo4j-driver ────────────────────────────────────────────────────────
const mockSession = {
  run: vi.fn(),
  close: vi.fn(() => Promise.resolve()),
}
const mockDriver = {
  session: vi.fn(() => mockSession),
  verifyConnectivity: vi.fn(() => Promise.resolve()),
  close: vi.fn(() => Promise.resolve()),
}
const mockNeo4j = {
  driver: vi.fn(() => mockDriver),
  auth: { basic: vi.fn((u: string, p: string) => ({ scheme: 'basic', principal: u, credentials: p })) },
  isInt: (v: unknown) => v instanceof FakeInteger,
  integer: { inSafeRange: () => true },
  types: { Node: FakeNode, Relationship: FakeRelationship, Path: FakePath },
}
vi.mock('neo4j-driver', () => ({ default: mockNeo4j }))
vi.mock('electron', () => ({}))

// ── Helpers ───────────────────────────────────────────────────────────────────
/** Build a fake neo4j Result with the given column keys + row objects. */
function makeResult(keys: string[], rows: Record<string, unknown>[], plan: unknown = false) {
  return {
    keys,
    records: rows.map((row) => ({
      keys,
      get: (k: string) => row[k],
      toObject: () => row,
    })),
    summary: { plan, query: { text: '' } },
  }
}

const conn: Neo4jConnection = {
  id: 'neo-1',
  name: 'Neo Test',
  engine: 'neo4j',
  uri: 'neo4j://localhost:7687',
  username: 'neo4j',
  password: 'password',
  createdAt: '2024-01-01T00:00:00.000Z',
}

const mockWC = { send: vi.fn(), isDestroyed: vi.fn(() => false) }

// ── Module import (after mocks registered) ─────────────────────────────────────
const {
  testConnection, listDatasets, listTables, getTableSchema, searchTables,
  runQuery, getQueryPage, cancelRunningQuery, dryRunQuery, invalidateClient,
} = await import('../../../main/db/neo4j')

beforeEach(() => {
  mockSession.run.mockReset()
  mockSession.close.mockReset().mockResolvedValue(undefined)
  mockDriver.session.mockClear().mockReturnValue(mockSession)
  mockDriver.verifyConnectivity.mockReset().mockResolvedValue(undefined)
  mockDriver.close.mockReset().mockResolvedValue(undefined)
  mockWC.send.mockClear()
})

describe('neo4j adapter — connection lifecycle', () => {
  it('testConnection returns ok on successful verifyConnectivity', async () => {
    const result = await testConnection(conn)
    expect(result).toEqual({ ok: true })
    expect(mockDriver.verifyConnectivity).toHaveBeenCalled()
  })

  it('testConnection returns the error and invalidates the driver on failure', async () => {
    mockDriver.verifyConnectivity.mockRejectedValueOnce(new Error('Auth failed'))
    const result = await testConnection(conn)
    expect(result).toEqual({ ok: false, error: 'Auth failed' })
    expect(mockDriver.close).toHaveBeenCalled()
  })

  it('invalidateClient closes the cached driver', async () => {
    await testConnection(conn) // populate the cache
    invalidateClient(conn.id)
    expect(mockDriver.close).toHaveBeenCalled()
  })
})

describe('neo4j adapter — listDatasets', () => {
  it('returns each database (de-duped, excluding system) as a Dataset', async () => {
    mockSession.run.mockResolvedValueOnce(
      makeResult(['name'], [{ name: 'neo4j' }, { name: 'movies' }, { name: 'neo4j' }, { name: 'system' }]),
    )
    const datasets = await listDatasets(conn)
    expect(datasets.map((d) => d.name)).toEqual(['neo4j', 'movies'])
    expect(mockDriver.session).toHaveBeenCalledWith({ database: 'system' })
  })

  it('falls back to the configured database when SHOW DATABASES is unsupported', async () => {
    mockSession.run.mockRejectedValueOnce(new Error('not supported'))
    const datasets = await listDatasets(conn)
    expect(datasets).toEqual([{ id: 'neo4j', projectId: conn.uri, name: 'neo4j' }])
  })
})

// Export test helpers for later tasks (re-used in the same file)
export { makeResult, conn, mockSession, mockDriver, mockWC, FakeInteger, FakeNode, FakeRelationship, FakePath }
