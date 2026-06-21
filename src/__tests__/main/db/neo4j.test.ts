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
  getDatasetColumns,
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

describe('neo4j adapter — listTables', () => {
  it('returns labels and relationship types tagged with kind + counts', async () => {
    mockSession.run
      .mockResolvedValueOnce(makeResult(['label'], [{ label: 'Person' }]))                 // db.labels()
      .mockResolvedValueOnce(makeResult(['relationshipType'], [{ relationshipType: 'KNOWS' }])) // db.relationshipTypes()
      .mockResolvedValueOnce(makeResult(['count'], [{ count: new FakeInteger(5) }]))        // count Person nodes
      .mockResolvedValueOnce(makeResult(['count'], [{ count: new FakeInteger(3) }]))        // count KNOWS rels

    const tables = await listTables(conn, 'neo4j')

    const person = tables.find((t) => t.name === 'Person')
    const knows = tables.find((t) => t.name === 'KNOWS')
    expect(person).toMatchObject({ type: 'LABEL', rowCount: 5, datasetId: 'neo4j' })
    expect(knows).toMatchObject({ type: 'RELATIONSHIP_TYPE', rowCount: 3, datasetId: 'neo4j' })
    expect(mockDriver.session).toHaveBeenCalledWith({ database: 'neo4j' })
  })

  it('serializes session calls — labels resolves before relationship types is requested', async () => {
    // Regression for the parallel-on-shared-session bug that caused relationship
    // types to silently drop. A Session is not concurrency-safe, so the second
    // .run() must NOT be issued before the first resolves.
    let labelsResolve!: (v: unknown) => void
    let relRequestedBeforeLabelsResolved = false

    mockSession.run.mockImplementationOnce(() => new Promise((res) => { labelsResolve = res }))
    mockSession.run.mockImplementationOnce(() => {
      // If labels promise is still pending and we're already being asked for
      // relationship types, the call ordering violates the contract.
      if (!labelsResolved) relRequestedBeforeLabelsResolved = true
      return Promise.resolve(makeResult(['relationshipType'], []))
    })

    let labelsResolved = false
    const p = listTables(conn, 'neo4j')

    // Give the microtask queue a chance to run — if labels and rel-types were
    // dispatched in parallel, rel-types' run() would already have been called.
    await Promise.resolve()
    await Promise.resolve()

    labelsResolve(makeResult(['label'], []))
    labelsResolved = true
    await p

    expect(relRequestedBeforeLabelsResolved).toBe(false)
  })
})

describe('neo4j adapter — getTableSchema', () => {
  it('infers node property keys + types from a sample (first-observed-type-wins)', async () => {
    mockSession.run
      .mockResolvedValueOnce(makeResult(['relationshipType'], [{ relationshipType: 'KNOWS' }])) // not a rel type
      .mockResolvedValueOnce(
        makeResult(['sample'], [
          { sample: new FakeNode('1', ['Person'], { name: 'Alice', age: new FakeInteger(30) }) },
        ]),
      )
    const fields = await getTableSchema(conn, 'neo4j', 'Person')
    expect(fields).toEqual([
      { name: 'name', type: 'STRING', mode: 'NULLABLE' },
      { name: 'age', type: 'INTEGER', mode: 'NULLABLE' },
    ])
  })

  it('samples relationships when the id is a relationship type', async () => {
    mockSession.run
      .mockResolvedValueOnce(makeResult(['relationshipType'], [{ relationshipType: 'KNOWS' }]))
      .mockResolvedValueOnce(
        makeResult(['sample'], [
          { sample: new FakeRelationship('r1', 's', 'e', 'KNOWS', { since: new FakeInteger(2020) }) },
        ]),
      )
    const fields = await getTableSchema(conn, 'neo4j', 'KNOWS')
    expect(fields).toEqual([{ name: 'since', type: 'INTEGER', mode: 'NULLABLE' }])
  })
})

describe('neo4j adapter — searchTables', () => {
  it('matches labels and relationship types by substring across databases', async () => {
    mockSession.run
      .mockResolvedValueOnce(makeResult(['name'], [{ name: 'neo4j' }]))                       // SHOW DATABASES
      .mockResolvedValueOnce(makeResult(['label'], [{ label: 'Person' }, { label: 'Company' }])) // db.labels()
      .mockResolvedValueOnce(makeResult(['relationshipType'], [{ relationshipType: 'WORKS_AT' }])) // db.relationshipTypes()

    const hits = await searchTables(conn, 'per', 10)
    expect(hits).toEqual([
      { datasetId: 'neo4j', tableId: 'Person', name: 'Person', type: 'LABEL' },
    ])
  })
})

describe('neo4j adapter — runQuery', () => {
  it('serializes scalar + Node values and returns the first page', async () => {
    const node = new FakeNode('n-1', ['Person'], { name: 'Alice', age: new FakeInteger(30) })
    mockSession.run.mockResolvedValueOnce(makeResult(['n', 'score'], [{ n: node, score: new FakeInteger(7) }]))

    const result = await runQuery(conn, 'MATCH (n) RETURN n, 7 AS score', 'tab-run', mockWC as never)

    expect(result.columns).toEqual(['n', 'score'])
    expect(result.rows[0].score).toBe(7)
    expect(result.rows[0].n).toEqual({
      __neo4jType: 'Node',
      identity: 'n-1',
      labels: ['Person'],
      properties: { name: 'Alice', age: 30 },
    })
    expect(mockWC.send).toHaveBeenCalledWith(CHANNELS.QUERY_LOG, expect.objectContaining({ tabId: 'tab-run' }))
  })

  it('returns columns + empty rows for a zero-record result', async () => {
    mockSession.run.mockResolvedValueOnce(makeResult(['n'], []))
    const result = await runQuery(conn, 'MATCH (n) RETURN n', 'tab-empty', mockWC as never)
    expect(result).toMatchObject({ columns: ['n'], rows: [], rowCount: 0, totalRows: 0, hasMore: false })
  })

  it('rejects and closes the session on query error', async () => {
    mockSession.run.mockRejectedValueOnce(new Error('SyntaxError: bad cypher'))
    await expect(runQuery(conn, 'BAD', 'tab-err', mockWC as never)).rejects.toThrow('bad cypher')
    expect(mockSession.close).toHaveBeenCalled()
  })
})

describe('neo4j adapter — pagination + cancel', () => {
  it('getQueryPage slices the retained result by numeric offset', async () => {
    const rows = Array.from({ length: 150 }, (_, i) => ({ n: i }))
    mockSession.run.mockResolvedValueOnce(makeResult(['n'], rows))
    await runQuery(conn, 'MATCH (n) RETURN n', 'tab-page', mockWC as never)

    const page = await getQueryPage('tab-page', '100')
    expect(page.rows).toHaveLength(50)
    expect(page.rows[0].n).toBe(100)
    expect(page.hasMore).toBe(false)
    expect(page.totalRows).toBe(150)
  })

  it('getQueryPage throws when no retained result exists', async () => {
    await expect(getQueryPage('missing-tab', '0')).rejects.toThrow()
  })

  it('cancelRunningQuery closes the active session and logs', async () => {
    let resolveRun!: (v: unknown) => void
    mockSession.run.mockReturnValueOnce(new Promise((res) => { resolveRun = res }))
    const p = runQuery(conn, 'MATCH (n) RETURN n', 'tab-cancel', mockWC as never)
    await Promise.resolve() // let runningJobs.set register

    await cancelRunningQuery('tab-cancel')
    expect(mockSession.close).toHaveBeenCalled()
    expect(mockWC.send).toHaveBeenCalledWith(CHANNELS.QUERY_LOG, { tabId: 'tab-cancel', message: 'Cancelled by user.' })

    resolveRun(makeResult(['n'], []))
    await p.catch(() => {})
  })
})

describe('neo4j adapter — dryRunQuery', () => {
  it('returns the EXPLAIN plan tree as JSON', async () => {
    mockSession.run.mockResolvedValueOnce(
      makeResult([], [], { operatorType: 'ProduceResults', identifiers: ['n'], children: [] }),
    )
    const out = await dryRunQuery(conn, 'MATCH (n) RETURN n')
    expect(out.bytesProcessed).toBe(0)
    expect(out.planFormat).toBe('json')
    expect(out.plan).toContain('ProduceResults')
    expect(mockSession.run).toHaveBeenCalledWith('EXPLAIN MATCH (n) RETURN n')
  })

  it('returns no plan when the summary has none', async () => {
    mockSession.run.mockResolvedValueOnce(makeResult([], [], false))
    const out = await dryRunQuery(conn, 'MATCH (n) RETURN n')
    expect(out).toEqual({ bytesProcessed: 0, plan: undefined, planFormat: undefined })
  })
})

describe('getDatasetColumns', () => {
  it('returns sample-inferred properties for every label and relationship type', async () => {
    // listTables sequence:
    //   1. CALL db.labels()          → [Person]
    //   2. CALL db.relationshipTypes() → [KNOWS]
    //   3. count(n:Person)            → 5
    //   4. count(r:KNOWS)             → 3
    // getTableSchema('Person') sequence:
    //   5. CALL db.relationshipTypes() → [KNOWS]  (Person is not a rel type)
    //   6. MATCH (n:Person) RETURN n AS sample LIMIT 50 → node with name + age
    // getTableSchema('KNOWS') sequence:
    //   7. CALL db.relationshipTypes() → [KNOWS]  (KNOWS is a rel type)
    //   8. MATCH ()-[r:KNOWS]->() RETURN r AS sample LIMIT 50 → rel with since
    mockSession.run
      .mockResolvedValueOnce(makeResult(['label'], [{ label: 'Person' }]))
      .mockResolvedValueOnce(makeResult(['relationshipType'], [{ relationshipType: 'KNOWS' }]))
      .mockResolvedValueOnce(makeResult(['count'], [{ count: new FakeInteger(5) }]))
      .mockResolvedValueOnce(makeResult(['count'], [{ count: new FakeInteger(3) }]))
      .mockResolvedValueOnce(makeResult(['relationshipType'], [{ relationshipType: 'KNOWS' }]))
      .mockResolvedValueOnce(
        makeResult(['sample'], [
          { sample: new FakeNode('n-1', ['Person'], { name: 'Alice', age: new FakeInteger(30) }) },
        ]),
      )
      .mockResolvedValueOnce(makeResult(['relationshipType'], [{ relationshipType: 'KNOWS' }]))
      .mockResolvedValueOnce(
        makeResult(['sample'], [
          { sample: new FakeRelationship('r-1', 's', 'e', 'KNOWS', { since: new FakeInteger(2020) }) },
        ]),
      )

    const result = await getDatasetColumns(conn, 'neo4j')

    expect(Object.keys(result).sort()).toEqual(['KNOWS', 'Person'])
    expect(result.Person).toEqual(
      expect.arrayContaining([expect.objectContaining({ name: expect.any(String) })])
    )
    expect(result.KNOWS).toEqual(
      expect.arrayContaining([expect.objectContaining({ name: 'since' })])
    )
  })
})

// Export test helpers for later tasks (re-used in the same file)
export { makeResult, conn, mockSession, mockDriver, mockWC, FakeInteger, FakeNode, FakeRelationship, FakePath }
