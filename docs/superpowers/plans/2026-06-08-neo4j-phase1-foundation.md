# Neo4j Support — Phase 1 (Foundation: "Cypher-as-SQL") Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Make Neo4j a fully usable, first-class fourth engine in Aperture — connect over Bolt, browse the graph catalog (databases → labels / relationship types), write Cypher with syntax highlighting + schema-aware autocomplete, and view tabular results where Node/Relationship/Path cells render as compact Cypher-style chips.

**Architecture:** Follow the exact `DbAdapter<TConnection>` pattern the Snowflake integration established (`src/main/db/snowflake.ts`). A new `src/main/db/neo4j.ts` implements the full adapter surface against the official `neo4j-driver` (Bolt protocol), serializing driver class instances (Node/Relationship/Path/Integer/temporal) into plain IPC-safe objects at the boundary. No new IPC channels — Neo4j reuses `CONNECTIONS_*` / `CATALOG_*` / `QUERY_*` verbatim once registered in `adapterRegistry.ts`. The renderer gains a fourth `ConnectionModal` tab, two-section catalog grouping, a CodeMirror `StreamLanguage` for Cypher, a graph-element cell chip, and a `cat-teal` per-engine accent token. Phase 2 (graph visualization) is explicitly out of scope.

**Tech Stack:** TypeScript (strict), Electron main + React renderer, `neo4j-driver` v6, CodeMirror 6 (`@codemirror/language` + `@codemirror/autocomplete`), Zustand, Tailwind, Vitest (AAA, 70% coverage gate on `src/main/db/**`).

---

## File Structure

### New files
| File | Responsibility |
|---|---|
| `src/main/db/neo4j.ts` | Full `DbAdapter<Neo4jConnection>` implementation (Bolt driver, serialization, catalog, query, pagination, cancel, dry-run) |
| `src/renderer/src/lib/buildCypherQuery.ts` | Pure `MATCH … RETURN … LIMIT 100` builders for labels / relationship types (Cypher analogue of `buildSelectQuery`) |
| `src/renderer/src/lib/cypherLanguage.ts` | CodeMirror Cypher `StreamLanguage` + autocomplete `CompletionSource` + `CypherSchema` type |
| `src/renderer/src/lib/formatGraphElement.ts` | Pure `isGraphElement()` discriminator + `formatGraphElement()` compact-chip string formatter |
| `src/renderer/src/components/results/GraphElementChip.tsx` | Renders a serialized Node/Relationship/Path as a compact Cypher-style chip |
| `src/__tests__/main/db/neo4j.test.ts` | Adapter unit tests (driver fully mocked) |
| `src/__tests__/renderer/lib/buildCypherQuery.test.ts` | Builder tests |
| `src/__tests__/renderer/lib/cypherLanguage.test.ts` | Tokenizer + completion-option tests |
| `src/__tests__/renderer/lib/formatGraphElement.test.ts` | Formatter + discriminator tests |

### Modified files
| File | Change |
|---|---|
| `package.json` | Add `neo4j-driver`, promote `@codemirror/autocomplete` + `@codemirror/language` to direct deps |
| `src/shared/types.ts` | `Neo4jConnection`, graph value types, union extensions, `LABEL`/`RELATIONSHIP_TYPE` table kinds |
| `tailwind.config.ts` + `src/renderer/src/index.css` | `cat-teal` token (`:root` + `.dark` + tailwind color) |
| `src/main/db/adapterRegistry.ts` | Import + register `neo4jAdapter` |
| `src/__tests__/main/db/adapterRegistry.test.ts` | `neo4j` mock block + dispatch tests |
| `src/renderer/src/components/connections/ConnectionModal.tsx` | Inline Neo4j engine tab + fields |
| `src/renderer/src/components/layout/TitleBar.tsx` | `cat-teal` in `connectionLabel`/`engineColor`/`engineAccent` |
| `src/renderer/src/components/catalog/CatalogTree.tsx` | Labels / Relationship Types sections + teal icons + Cypher query actions |
| `src/renderer/src/components/catalog/TableDetailPanel.tsx` | "sample-inferred" caveat banner for Neo4j schema tab |
| `src/renderer/src/components/editor/QueryEditor.tsx` | Cypher language branch + format guard |
| `src/renderer/src/pages/Editor.tsx` | `cypherSchema` memo + thread to all 3 `QueryEditor` instances |
| `src/renderer/src/components/results/ResultsTable.tsx` | Graph-element cell branch |
| `src/renderer/src/lib/detectMissingLimit.ts` | Cypher read-statement starters |
| `README.md`, `CHANGELOG.md`, `CLAUDE.md` | Docs + change-log entry |

---

## Task 1: Add dependencies

**Files:**
- Modify: `package.json:21-33` (dependencies block)

- [ ] **Step 1: Edit the `dependencies` block**

Replace the existing `dependencies` block (currently lines 21-33) with this exact block (adds three packages in alphabetical order; `@codemirror/autocomplete` and `@codemirror/language` are already present transitively at the versions below — this promotes them to direct deps):

```json
  "dependencies": {
    "@codemirror/autocomplete": "^6.20.1",
    "@codemirror/lang-sql": "^6.8.0",
    "@codemirror/language": "^6.12.2",
    "@codemirror/theme-one-dark": "^6.1.2",
    "@google-cloud/bigquery": "^7.9.0",
    "@uiw/react-codemirror": "^4.23.5",
    "js-yaml": "^4.2.0",
    "lucide-react": "^0.460.0",
    "neo4j-driver": "^6.1.0",
    "pg": "^8.20.0",
    "react": "^18.3.1",
    "react-dom": "^18.3.1",
    "snowflake-sdk": "^2.4.0",
    "sql-formatter": "^15.7.3",
    "zustand": "^5.0.1"
  },
```

- [ ] **Step 2: Install**

Run: `npm install`
Expected: completes without error; `neo4j-driver` added to `node_modules`.

- [ ] **Step 3: Verify the new dep resolves**

Run: `npm ls neo4j-driver`
Expected: prints `neo4j-driver@6.1.0` (or compatible `6.x`) with no "missing" / "invalid".

- [ ] **Step 4: Commit**

```bash
git add package.json package-lock.json
git commit -m "✨ feat(neo4j): add neo4j-driver + promote codemirror language/autocomplete deps"
```

---

## Task 2: Extend shared types

**Files:**
- Modify: `src/shared/types.ts:1` (ConnectionEngine), `:42-47` (unions), `:66-83` (table kinds), and add graph value types after `QueryResult`

- [ ] **Step 1: Add `'neo4j'` to the engine union**

Replace line 1:

```ts
export type ConnectionEngine = 'bigquery' | 'postgres' | 'snowflake'
```

with:

```ts
export type ConnectionEngine = 'bigquery' | 'postgres' | 'snowflake' | 'neo4j'
```

- [ ] **Step 2: Add the `Neo4jConnection` interface**

Insert immediately after the `SnowflakeConnection` interface closes (after line 40, before `export type Connection = …`):

```ts
export interface Neo4jConnection extends ConnectionBase {
  engine: 'neo4j'
  /** Bolt URI, e.g. "neo4j://localhost:7687" or "neo4j+s://xxxx.databases.neo4j.io" */
  uri: string
  username: string
  password: string
  /** Optional default database (Neo4j 4.0+ multi-database); defaults to "neo4j" */
  database?: string
}
```

- [ ] **Step 3: Extend the `Connection` and `ConnectionCreate` unions**

Replace lines 42-47:

```ts
export type Connection = BigQueryConnection | PostgresConnection | SnowflakeConnection

export type ConnectionCreate =
  | Omit<BigQueryConnection, 'id' | 'createdAt'>
  | Omit<PostgresConnection, 'id' | 'createdAt'>
  | Omit<SnowflakeConnection, 'id' | 'createdAt'>
```

with:

```ts
export type Connection = BigQueryConnection | PostgresConnection | SnowflakeConnection | Neo4jConnection

export type ConnectionCreate =
  | Omit<BigQueryConnection, 'id' | 'createdAt'>
  | Omit<PostgresConnection, 'id' | 'createdAt'>
  | Omit<SnowflakeConnection, 'id' | 'createdAt'>
  | Omit<Neo4jConnection, 'id' | 'createdAt'>
```

- [ ] **Step 4: Add `LABEL` / `RELATIONSHIP_TYPE` to the table-kind unions**

Replace the `TableSearchHit.type` line (currently line 70):

```ts
  type: 'TABLE' | 'VIEW'
```

with:

```ts
  type: 'TABLE' | 'VIEW' | 'LABEL' | 'RELATIONSHIP_TYPE'
```

Replace the `Table.type` line (currently line 78):

```ts
  type: 'TABLE' | 'VIEW' | 'MATERIALIZED_VIEW' | 'EXTERNAL'
```

with:

```ts
  type: 'TABLE' | 'VIEW' | 'MATERIALIZED_VIEW' | 'EXTERNAL' | 'LABEL' | 'RELATIONSHIP_TYPE'
```

- [ ] **Step 5: Add the serialized graph value types**

Insert immediately after the `QueryResult` interface closes (after line 97, before `QueryPane`):

```ts
/**
 * Neo4j graph values, serialized for IPC transport. The Bolt driver returns
 * class instances (Node/Relationship/Path) that can't cross the structured-clone
 * boundary, so the adapter converts them to these plain, `__neo4jType`-tagged
 * objects. `identity`/`start`/`end` hold Neo4j element IDs (stable strings).
 */
export interface Neo4jNode {
  __neo4jType: 'Node'
  identity: string
  labels: string[]
  properties: Record<string, unknown>
}

export interface Neo4jRelationship {
  __neo4jType: 'Relationship'
  identity: string
  start: string
  end: string
  type: string
  properties: Record<string, unknown>
}

export interface Neo4jPath {
  __neo4jType: 'Path'
  segments: { start: Neo4jNode; relationship: Neo4jRelationship; end: Neo4jNode }[]
}

export type Neo4jGraphValue = Neo4jNode | Neo4jRelationship | Neo4jPath
```

- [ ] **Step 6: Verify types compile**

Run: `npm run typecheck`
Expected: PASS (no errors). The `ConnectionEngine`-keyed maps in `QueryEditor.tsx` will error here if Task 2 is run alone — that is expected and is fixed in Task 19; if running tasks strictly in order, those maps are not yet `satisfies`-checked against the new member until their own task. If `typecheck` reports errors *only* in `QueryEditor.tsx` `FORMAT_DIALECT_MAP`/`CM_DIALECT_MAP`, proceed — they are resolved in Task 19.

- [ ] **Step 7: Commit**

```bash
git add src/shared/types.ts
git commit -m "✨ feat(neo4j): add Neo4jConnection + serialized graph value types"
```

---

## Task 3: Add `cat-teal` design token

**Files:**
- Modify: `src/renderer/src/index.css:57` (`:root`) and `:96` (`.dark`)
- Modify: `tailwind.config.ts:56`

- [ ] **Step 1: Add the `:root` (light) token**

In `src/renderer/src/index.css`, replace the `--c-cat-green: 46 139 106;` line inside `:root` (line 57) with:

```css
  --c-cat-green:         46 139 106;
  --c-cat-teal:          31 140 140;
```

- [ ] **Step 2: Add the `.dark` token**

In the same file, replace the `--c-cat-green: 91 201 138;` line inside `.dark` (line 96) with:

```css
  --c-cat-green:        91 201 138;
  --c-cat-teal:         94 211 211;
```

- [ ] **Step 3: Register the Tailwind color**

In `tailwind.config.ts`, replace the `app-cat-green` line (line 56):

```ts
        'app-cat-green':        'rgb(var(--c-cat-green)        / <alpha-value>)',
```

with:

```ts
        'app-cat-green':        'rgb(var(--c-cat-green)        / <alpha-value>)',
        'app-cat-teal':         'rgb(var(--c-cat-teal)         / <alpha-value>)',
```

- [ ] **Step 4: Verify the token is wired**

Run: `grep -n "cat-teal" tailwind.config.ts src/renderer/src/index.css`
Expected: 3 matches (one in tailwind config, one in `:root`, one in `.dark`).

- [ ] **Step 5: Commit**

```bash
git add tailwind.config.ts src/renderer/src/index.css
git commit -m "💄 feat(neo4j): add cat-teal per-engine accent token"
```

---

## Task 4: Neo4j adapter — scaffold + testConnection + invalidateClient

**Files:**
- Create: `src/main/db/neo4j.ts`
- Test: `src/__tests__/main/db/neo4j.test.ts`

- [ ] **Step 1: Write the failing test (mock infrastructure + first two methods)**

Create `src/__tests__/main/db/neo4j.test.ts`:

```ts
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

// Export test helpers for later tasks (re-used in the same file)
export { makeResult, conn, mockSession, mockDriver, mockWC, FakeInteger, FakeNode, FakeRelationship, FakePath }
```

> Note: the `export { … }` at the bottom is harmless in a Vitest file and lets later tasks reference the same fixtures without re-declaring them. Subsequent adapter tasks add `describe` blocks *above* this export line.

- [ ] **Step 2: Run the test to verify it fails**

Run: `npx vitest run src/__tests__/main/db/neo4j.test.ts`
Expected: FAIL — `Cannot find module '../../../main/db/neo4j'` (file does not exist yet).

- [ ] **Step 3: Create the adapter scaffold + the two methods**

Create `src/main/db/neo4j.ts`:

```ts
import neo4j from 'neo4j-driver'
import type { Driver, Session, Integer, Node, Relationship, Path } from 'neo4j-driver'
import type { WebContents } from 'electron'
import { CHANNELS } from '../../shared/ipc'
import type {
  Neo4jConnection,
  Neo4jNode,
  Neo4jRelationship,
  Neo4jPath,
  Dataset,
  Table,
  TableField,
  TableSearchHit,
  QueryResult,
} from '../../shared/types'

const QUERY_TIMEOUT_MS = 180_000
const HEARTBEAT_INTERVAL_MS = 10_000
const DEFAULT_PAGE_SIZE = 100
const SCHEMA_SAMPLE_SIZE = 50

// ── Driver cache ───────────────────────────────────────────────────────────────
// Persistent Driver objects reused across calls, keyed by connection.id.
const driverCache = new Map<string, Driver>()

// ── Helpers ─────────────────────────────────────────────────────────────────────

function databaseName(connection: Neo4jConnection): string {
  return connection.database?.trim() || 'neo4j'
}

function getDriver(connection: Neo4jConnection): Driver {
  const existing = driverCache.get(connection.id)
  if (existing) return existing
  const driver = neo4j.driver(
    connection.uri,
    neo4j.auth.basic(connection.username, connection.password),
  )
  driverCache.set(connection.id, driver)
  return driver
}

function elapsed(startMs: number): string {
  const s = Math.round((Date.now() - startMs) / 1000)
  const m = Math.floor(s / 60)
  return m > 0 ? `${m}m ${s % 60}s` : `${s}s`
}

/** Backtick-quote a Cypher identifier (label / relationship type), escaping backticks. */
function quoteIdentifier(ident: string): string {
  return `\`${ident.replace(/`/g, '``')}\``
}

/** Coerce a Neo4j Integer / number value to a JS number (undefined-safe). */
function intToNumber(value: unknown): number | undefined {
  if (value == null) return undefined
  if (neo4j.isInt(value)) {
    const int = value as Integer
    return neo4j.integer.inSafeRange(int) ? int.toNumber() : Number(int.toString())
  }
  return typeof value === 'number' ? value : Number(value)
}

// ── Public adapter API ───────────────────────────────────────────────────────────

export async function testConnection(
  connection: Neo4jConnection,
): Promise<{ ok: boolean; error?: string }> {
  try {
    const driver = getDriver(connection)
    await driver.verifyConnectivity({ database: databaseName(connection) })
    return { ok: true }
  } catch (err) {
    invalidateClient(connection.id)
    return { ok: false, error: (err as Error).message }
  }
}

/**
 * Destroy the cached driver for the given connection ID.
 * Called when the user updates or deletes a connection (and on test failure).
 */
export function invalidateClient(connectionId: string): void {
  const driver = driverCache.get(connectionId)
  if (!driver) return
  driverCache.delete(connectionId)
  driver.close().catch(() => { /* ignore — driver may already be gone */ })
}
```

- [ ] **Step 4: Run the test to verify it passes**

Run: `npx vitest run src/__tests__/main/db/neo4j.test.ts`
Expected: PASS (3 tests in "connection lifecycle").

- [ ] **Step 5: Commit**

```bash
git add src/main/db/neo4j.ts src/__tests__/main/db/neo4j.test.ts
git commit -m "✨ feat(neo4j): adapter scaffold + testConnection/invalidateClient"
```

---

## Task 5: Neo4j adapter — `listDatasets`

**Files:**
- Modify: `src/main/db/neo4j.ts`
- Test: `src/__tests__/main/db/neo4j.test.ts`

- [ ] **Step 1: Write the failing test**

Add this `describe` block in `neo4j.test.ts`, immediately above the `export { … }` line:

```ts
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
```

- [ ] **Step 2: Run the test to verify it fails**

Run: `npx vitest run src/__tests__/main/db/neo4j.test.ts -t listDatasets`
Expected: FAIL — `listDatasets is not a function` / undefined.

- [ ] **Step 3: Implement `listDatasets`**

Append to `src/main/db/neo4j.ts` (after `invalidateClient`):

```ts
/**
 * Each Neo4j database becomes one "dataset" in the existing catalog tree shape.
 * Runs `SHOW DATABASES` against the system database. In a cluster the same
 * database name appears once per server, so results are de-duped by name and
 * the internal `system` database is hidden.
 */
export async function listDatasets(connection: Neo4jConnection): Promise<Dataset[]> {
  const driver = getDriver(connection)
  const session = driver.session({ database: 'system' })
  try {
    const result = await session.run('SHOW DATABASES')
    const seen = new Set<string>()
    const datasets: Dataset[] = []
    for (const record of result.records) {
      const name = record.get('name') as string
      if (name === 'system' || seen.has(name)) continue
      seen.add(name)
      datasets.push({ id: name, projectId: connection.uri, name })
    }
    return datasets
  } catch {
    // Older Neo4j (no multi-db) or insufficient privileges — fall back to the configured DB
    const fallback = databaseName(connection)
    return [{ id: fallback, projectId: connection.uri, name: fallback }]
  } finally {
    await session.close().catch(() => {})
  }
}
```

- [ ] **Step 4: Run the test to verify it passes**

Run: `npx vitest run src/__tests__/main/db/neo4j.test.ts -t listDatasets`
Expected: PASS (2 tests).

- [ ] **Step 5: Commit**

```bash
git add src/main/db/neo4j.ts src/__tests__/main/db/neo4j.test.ts
git commit -m "✨ feat(neo4j): listDatasets via SHOW DATABASES"
```

---

## Task 6: Neo4j adapter — `listTables` (labels + relationship types with counts)

**Files:**
- Modify: `src/main/db/neo4j.ts`
- Test: `src/__tests__/main/db/neo4j.test.ts`

- [ ] **Step 1: Write the failing test**

Add this `describe` block above the `export { … }` line in `neo4j.test.ts`:

```ts
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
})
```

- [ ] **Step 2: Run the test to verify it fails**

Run: `npx vitest run src/__tests__/main/db/neo4j.test.ts -t listTables`
Expected: FAIL — `listTables is not a function`.

- [ ] **Step 3: Implement `listTables` + count helpers**

Append to `src/main/db/neo4j.ts`:

```ts
function countNodes(session: Session, label: string): Promise<number | undefined> {
  return session
    .run(`MATCH (n:${quoteIdentifier(label)}) RETURN count(n) AS count`)
    .then((r) => intToNumber(r.records[0]?.get('count')))
    .catch(() => undefined)
}

function countRelationships(session: Session, relType: string): Promise<number | undefined> {
  return session
    .run(`MATCH ()-[r:${quoteIdentifier(relType)}]->() RETURN count(r) AS count`)
    .then((r) => intToNumber(r.records[0]?.get('count')))
    .catch(() => undefined)
}

/**
 * "Tables" in a Neo4j database are its node labels and relationship types.
 * Each is tagged with a `type` discriminator ('LABEL' | 'RELATIONSHIP_TYPE')
 * so the catalog tree can group them under two section headers, and carries a
 * cheap count (cached upstream the same way relational table-counts are).
 */
export async function listTables(connection: Neo4jConnection, datasetId: string): Promise<Table[]> {
  const driver = getDriver(connection)
  const session = driver.session({ database: datasetId })
  try {
    const [labelResult, relResult] = await Promise.all([
      session.run('CALL db.labels()').catch(() => null),
      session.run('CALL db.relationshipTypes()').catch(() => null),
    ])
    const labels = labelResult ? labelResult.records.map((r) => r.get('label') as string) : []
    const relTypes = relResult ? relResult.records.map((r) => r.get('relationshipType') as string) : []

    const labelTables = await Promise.all(
      labels.map(async (label) => ({
        id: label,
        datasetId,
        projectId: connection.uri,
        name: label,
        type: 'LABEL' as const,
        rowCount: await countNodes(session, label),
      } satisfies Table)),
    )
    const relTables = await Promise.all(
      relTypes.map(async (relType) => ({
        id: relType,
        datasetId,
        projectId: connection.uri,
        name: relType,
        type: 'RELATIONSHIP_TYPE' as const,
        rowCount: await countRelationships(session, relType),
      } satisfies Table)),
    )
    return [...labelTables, ...relTables]
  } finally {
    await session.close().catch(() => {})
  }
}
```

- [ ] **Step 4: Run the test to verify it passes**

Run: `npx vitest run src/__tests__/main/db/neo4j.test.ts -t listTables`
Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add src/main/db/neo4j.ts src/__tests__/main/db/neo4j.test.ts
git commit -m "✨ feat(neo4j): listTables (labels + relationship types + counts)"
```

---

## Task 7: Neo4j adapter — `getTableSchema` (sample-inferred)

**Files:**
- Modify: `src/main/db/neo4j.ts`
- Test: `src/__tests__/main/db/neo4j.test.ts`

- [ ] **Step 1: Write the failing test**

Add above the `export { … }` line:

```ts
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
```

- [ ] **Step 2: Run the test to verify it fails**

Run: `npx vitest run src/__tests__/main/db/neo4j.test.ts -t getTableSchema`
Expected: FAIL — `getTableSchema is not a function`.

- [ ] **Step 3: Implement `getTableSchema` + `inferPropertyType`**

Append to `src/main/db/neo4j.ts`:

```ts
/** Map a raw Neo4j property value to a type name the schema UI already color-codes. */
function inferPropertyType(value: unknown): string {
  if (value == null) return 'STRING'
  if (neo4j.isInt(value)) return 'INTEGER'
  if (typeof value === 'number') return Number.isInteger(value) ? 'INTEGER' : 'FLOAT'
  if (typeof value === 'boolean') return 'BOOLEAN'
  if (typeof value === 'string') return 'STRING'
  if (Array.isArray(value)) return 'LIST'
  if (typeof value === 'object') {
    const ctor = (value as object).constructor?.name ?? ''
    if (ctor.includes('DateTime')) return 'TIMESTAMP'
    if (ctor.includes('Date')) return 'DATE'
    if (ctor.includes('Time')) return 'TIME'
    return 'STRING' // Duration, Point, and any other temporal/spatial type
  }
  return 'STRING'
}

/**
 * Neo4j is schema-optional, so there is no authoritative schema to read. This
 * samples up to SCHEMA_SAMPLE_SIZE nodes (or relationships) and reports the union
 * of observed property keys, with the first observed type winning per key. The
 * "Schema" tab frames this as sample-inferred (see TableDetailPanel banner).
 */
export async function getTableSchema(
  connection: Neo4jConnection,
  datasetId: string,
  tableId: string,
): Promise<TableField[]> {
  const driver = getDriver(connection)
  const session = driver.session({ database: datasetId })
  try {
    const relResult = await session.run('CALL db.relationshipTypes()').catch(() => null)
    const relTypes = relResult ? relResult.records.map((r) => r.get('relationshipType') as string) : []
    const isRel = relTypes.includes(tableId)

    const cypher = isRel
      ? `MATCH ()-[r:${quoteIdentifier(tableId)}]->() RETURN r AS sample LIMIT ${SCHEMA_SAMPLE_SIZE}`
      : `MATCH (n:${quoteIdentifier(tableId)}) RETURN n AS sample LIMIT ${SCHEMA_SAMPLE_SIZE}`

    const result = await session.run(cypher)
    const propTypes = new Map<string, string>()
    for (const record of result.records) {
      const entity = record.get('sample') as { properties?: Record<string, unknown> } | null
      const props = entity?.properties ?? {}
      for (const [key, value] of Object.entries(props)) {
        if (!propTypes.has(key)) propTypes.set(key, inferPropertyType(value))
      }
    }
    return Array.from(propTypes.entries()).map(([name, type]) => ({
      name,
      type,
      mode: 'NULLABLE' as const,
    } satisfies TableField))
  } finally {
    await session.close().catch(() => {})
  }
}
```

- [ ] **Step 4: Run the test to verify it passes**

Run: `npx vitest run src/__tests__/main/db/neo4j.test.ts -t getTableSchema`
Expected: PASS (2 tests).

- [ ] **Step 5: Commit**

```bash
git add src/main/db/neo4j.ts src/__tests__/main/db/neo4j.test.ts
git commit -m "✨ feat(neo4j): getTableSchema (sample-inferred property keys)"
```

---

## Task 8: Neo4j adapter — `searchTables`

**Files:**
- Modify: `src/main/db/neo4j.ts`
- Test: `src/__tests__/main/db/neo4j.test.ts`

- [ ] **Step 1: Write the failing test**

Add above the `export { … }` line:

```ts
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
```

- [ ] **Step 2: Run the test to verify it fails**

Run: `npx vitest run src/__tests__/main/db/neo4j.test.ts -t searchTables`
Expected: FAIL — `searchTables is not a function`.

- [ ] **Step 3: Implement `searchTables`**

Append to `src/main/db/neo4j.ts`:

```ts
/**
 * Catalog-wide substring search powering ⌘K. Walks every database's labels and
 * relationship types, matching their names case-insensitively against the query.
 */
export async function searchTables(
  connection: Neo4jConnection,
  query: string,
  limit: number,
): Promise<TableSearchHit[]> {
  const driver = getDriver(connection)
  const datasets = await listDatasets(connection)
  const lower = query.toLowerCase()
  const hits: TableSearchHit[] = []

  for (const ds of datasets) {
    if (hits.length >= limit) break
    const session = driver.session({ database: ds.id })
    try {
      const [labelResult, relResult] = await Promise.all([
        session.run('CALL db.labels()').catch(() => null),
        session.run('CALL db.relationshipTypes()').catch(() => null),
      ])
      const labels = labelResult ? labelResult.records.map((r) => r.get('label') as string) : []
      const relTypes = relResult ? relResult.records.map((r) => r.get('relationshipType') as string) : []
      for (const label of labels) {
        if (label.toLowerCase().includes(lower)) {
          hits.push({ datasetId: ds.id, tableId: label, name: label, type: 'LABEL' })
        }
      }
      for (const relType of relTypes) {
        if (relType.toLowerCase().includes(lower)) {
          hits.push({ datasetId: ds.id, tableId: relType, name: relType, type: 'RELATIONSHIP_TYPE' })
        }
      }
    } finally {
      await session.close().catch(() => {})
    }
  }
  return hits.slice(0, limit)
}
```

- [ ] **Step 4: Run the test to verify it passes**

Run: `npx vitest run src/__tests__/main/db/neo4j.test.ts -t searchTables`
Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add src/main/db/neo4j.ts src/__tests__/main/db/neo4j.test.ts
git commit -m "✨ feat(neo4j): searchTables (labels + relationship types)"
```

---

## Task 9: Neo4j adapter — `runQuery` + value serialization

**Files:**
- Modify: `src/main/db/neo4j.ts`
- Test: `src/__tests__/main/db/neo4j.test.ts`

- [ ] **Step 1: Write the failing test**

Add above the `export { … }` line:

```ts
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
```

- [ ] **Step 2: Run the test to verify it fails**

Run: `npx vitest run src/__tests__/main/db/neo4j.test.ts -t runQuery`
Expected: FAIL — `runQuery is not a function`.

- [ ] **Step 3: Implement serialization helpers + `runQuery`**

Append to `src/main/db/neo4j.ts` (the running-jobs / completed-results state lives here, where it is first used):

```ts
// ── Running / completed query state ───────────────────────────────────────────────
interface RunningJob {
  session: Session
  webContents: WebContents
}
const runningJobs = new Map<string, RunningJob>()
// Full serialized result retained after execution for in-memory pagination.
const completedResults = new Map<string, { columns: string[]; rows: Record<string, unknown>[]; totalRows: number }>()

// ── Value serialization (driver class instances → plain IPC-safe objects) ──────────

function serializeNode(node: Node): Neo4jNode {
  return {
    __neo4jType: 'Node',
    identity: node.elementId,
    labels: node.labels,
    properties: serializeProperties(node.properties),
  }
}

function serializeRelationship(rel: Relationship): Neo4jRelationship {
  return {
    __neo4jType: 'Relationship',
    identity: rel.elementId,
    start: rel.startNodeElementId,
    end: rel.endNodeElementId,
    type: rel.type,
    properties: serializeProperties(rel.properties),
  }
}

function serializePath(path: Path): Neo4jPath {
  return {
    __neo4jType: 'Path',
    segments: path.segments.map((seg) => ({
      start: serializeNode(seg.start),
      relationship: serializeRelationship(seg.relationship),
      end: serializeNode(seg.end),
    })),
  }
}

function serializeProperties(props: Record<string, unknown>): Record<string, unknown> {
  const out: Record<string, unknown> = {}
  for (const [k, v] of Object.entries(props)) out[k] = serializeValue(v)
  return out
}

/**
 * Convert any Bolt-returned value to an IPC-safe equivalent:
 *   Integer            → number (or string when out of safe range)
 *   Node/Rel/Path      → tagged plain objects
 *   array              → recursively serialized
 *   plain object       → recursively serialized
 *   temporal/spatial   → String() (any non-plain object that isn't Node/Rel/Path)
 */
function serializeValue(value: unknown): unknown {
  if (value === null || value === undefined) return null
  if (neo4j.isInt(value)) {
    const int = value as Integer
    return neo4j.integer.inSafeRange(int) ? int.toNumber() : int.toString()
  }
  if (value instanceof neo4j.types.Node) return serializeNode(value as Node)
  if (value instanceof neo4j.types.Relationship) return serializeRelationship(value as Relationship)
  if (value instanceof neo4j.types.Path) return serializePath(value as Path)
  if (Array.isArray(value)) return value.map(serializeValue)
  if (typeof value === 'object') {
    if ((value as object).constructor === Object) {
      const out: Record<string, unknown> = {}
      for (const [k, v] of Object.entries(value as Record<string, unknown>)) out[k] = serializeValue(v)
      return out
    }
    return String(value) // Date, DateTime, Duration, Point, … driver types
  }
  return value
}

function serializeRecord(record: { keys: ReadonlyArray<string>; get: (k: string) => unknown }): Record<string, unknown> {
  const out: Record<string, unknown> = {}
  for (const key of record.keys) out[key] = serializeValue(record.get(key))
  return out
}

/**
 * Execute a Cypher query. Neo4j has no native page-token cursor, so the full
 * result is collected, serialized, and retained; the first DEFAULT_PAGE_SIZE
 * rows are returned and getQueryPage() slices the rest. Mirrors the Snowflake
 * heartbeat / 180s-timeout / cancel pattern (a session's .close() aborts cleanly).
 */
export async function runQuery(
  connection: Neo4jConnection,
  cypher: string,
  tabId: string,
  webContents: WebContents,
): Promise<QueryResult> {
  const driver = getDriver(connection)
  const session = driver.session({ database: databaseName(connection) })
  const start = Date.now()

  const log = (message: string) => {
    if (!webContents.isDestroyed()) {
      webContents.send(CHANNELS.QUERY_LOG, { tabId, message })
    }
  }
  log('Submitting query to Neo4j…')

  let done = false
  let heartbeatTimer: ReturnType<typeof setInterval> | null = null
  let timeoutTimer: ReturnType<typeof setTimeout> | null = null

  const cleanup = () => {
    if (done) return
    done = true
    if (heartbeatTimer) clearInterval(heartbeatTimer)
    if (timeoutTimer) clearTimeout(timeoutTimer)
    runningJobs.delete(tabId)
  }

  heartbeatTimer = setInterval(() => log(`Still running… ${elapsed(start)} elapsed`), HEARTBEAT_INTERVAL_MS)

  // Register the session immediately so cancelRunningQuery can close it mid-flight.
  runningJobs.set(tabId, { session, webContents })

  const queryPromise = session
    .run(cypher)
    .then(async (result) => {
      const columns = result.keys as string[]
      const allRows = result.records.map(serializeRecord)
      await session.close().catch(() => {})
      cleanup()

      const totalRows = allRows.length
      const pageRows = allRows.slice(0, DEFAULT_PAGE_SIZE)
      const hasMore = totalRows > DEFAULT_PAGE_SIZE
      completedResults.set(tabId, { columns, rows: allRows, totalRows })
      log(`Fetched ${totalRows.toLocaleString()} rows · ${elapsed(start)}`)

      return {
        columns,
        rows: pageRows,
        rowCount: pageRows.length,
        executionTimeMs: Date.now() - start,
        totalRows,
        pageToken: hasMore ? String(DEFAULT_PAGE_SIZE) : null,
        hasMore,
      } satisfies QueryResult
    })
    .catch(async (err: Error) => {
      await session.close().catch(() => {})
      cleanup()
      throw err
    })

  // Prevent unhandled rejection after Promise.race settles.
  queryPromise.catch(() => {})

  const timeoutPromise = new Promise<never>((_, reject) => {
    timeoutTimer = setTimeout(async () => {
      log('Timeout reached (180s) · Cancelling…')
      const running = runningJobs.get(tabId)
      if (running) await running.session.close().catch(() => {})
      cleanup()
      reject(new Error('Query timed out after 180 seconds. The session has been closed.'))
    }, QUERY_TIMEOUT_MS)
  })

  return Promise.race([queryPromise, timeoutPromise])
}
```

- [ ] **Step 4: Run the test to verify it passes**

Run: `npx vitest run src/__tests__/main/db/neo4j.test.ts -t runQuery`
Expected: PASS (3 tests).

- [ ] **Step 5: Commit**

```bash
git add src/main/db/neo4j.ts src/__tests__/main/db/neo4j.test.ts
git commit -m "✨ feat(neo4j): runQuery + Node/Relationship/Path serialization"
```

---

## Task 10: Neo4j adapter — `getQueryPage` + `cancelRunningQuery`

**Files:**
- Modify: `src/main/db/neo4j.ts`
- Test: `src/__tests__/main/db/neo4j.test.ts`

- [ ] **Step 1: Write the failing test**

Add above the `export { … }` line:

```ts
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
```

- [ ] **Step 2: Run the test to verify it fails**

Run: `npx vitest run src/__tests__/main/db/neo4j.test.ts -t "pagination + cancel"`
Expected: FAIL — `getQueryPage is not a function`.

- [ ] **Step 3: Implement `getQueryPage` + `cancelRunningQuery`**

Append to `src/main/db/neo4j.ts`:

```ts
/**
 * Return the next page from the retained result for this tab.
 * @param pageToken numeric string offset (e.g. "100", "200")
 */
export async function getQueryPage(tabId: string, pageToken: string): Promise<QueryResult> {
  const cached = completedResults.get(tabId)
  if (!cached) throw new Error('No completed result found for this tab. Re-run the query.')

  const start = parseInt(pageToken, 10)
  const pageRows = cached.rows.slice(start, start + DEFAULT_PAGE_SIZE)
  const nextOffset = start + DEFAULT_PAGE_SIZE
  const hasMore = nextOffset < cached.totalRows

  return {
    columns: cached.columns,
    rows: pageRows,
    rowCount: pageRows.length,
    executionTimeMs: 0,
    totalRows: cached.totalRows,
    pageToken: hasMore ? String(nextOffset) : null,
    hasMore,
  }
}

/** Cancel the running query for the given tab by closing its session. No-op if none active. */
export async function cancelRunningQuery(tabId: string): Promise<void> {
  const running = runningJobs.get(tabId)
  if (!running) return
  const { session, webContents } = running
  if (!webContents.isDestroyed()) {
    webContents.send(CHANNELS.QUERY_LOG, { tabId, message: 'Cancelled by user.' })
  }
  await session.close().catch(() => {})
  runningJobs.delete(tabId)
}
```

- [ ] **Step 4: Run the test to verify it passes**

Run: `npx vitest run src/__tests__/main/db/neo4j.test.ts -t "pagination + cancel"`
Expected: PASS (3 tests).

- [ ] **Step 5: Commit**

```bash
git add src/main/db/neo4j.ts src/__tests__/main/db/neo4j.test.ts
git commit -m "✨ feat(neo4j): in-memory getQueryPage + cancelRunningQuery"
```

---

## Task 11: Neo4j adapter — `dryRunQuery` (EXPLAIN)

**Files:**
- Modify: `src/main/db/neo4j.ts`
- Test: `src/__tests__/main/db/neo4j.test.ts`

- [ ] **Step 1: Write the failing test**

Add above the `export { … }` line:

```ts
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
```

- [ ] **Step 2: Run the test to verify it fails**

Run: `npx vitest run src/__tests__/main/db/neo4j.test.ts -t dryRunQuery`
Expected: FAIL — `dryRunQuery is not a function`.

- [ ] **Step 3: Implement `dryRunQuery`**

Append to `src/main/db/neo4j.ts`:

```ts
/**
 * Validate a query without executing it via EXPLAIN. Neo4j has no byte-cost
 * dry-run, so bytesProcessed is always 0 (same convention Postgres/Snowflake use).
 * The structured plan tree is returned as pretty-printed JSON; any Integer values
 * inside it are stringified so JSON.stringify never emits {low, high} pairs.
 */
export async function dryRunQuery(
  connection: Neo4jConnection,
  cypher: string,
): Promise<{ bytesProcessed: number; plan?: string; planFormat?: 'text' | 'json' }> {
  const driver = getDriver(connection)
  const session = driver.session({ database: databaseName(connection) })
  try {
    const result = await session.run(`EXPLAIN ${cypher}`)
    const plan = result.summary.plan
    const planText = plan
      ? JSON.stringify(plan, (_k, v) => (neo4j.isInt(v) ? (v as Integer).toString() : v), 2)
      : undefined
    return { bytesProcessed: 0, plan: planText, planFormat: planText ? 'json' : undefined }
  } finally {
    await session.close().catch(() => {})
  }
}
```

- [ ] **Step 4: Run the full adapter suite to verify everything passes**

Run: `npx vitest run src/__tests__/main/db/neo4j.test.ts`
Expected: PASS (all describe blocks, ~16 tests).

- [ ] **Step 5: Commit**

```bash
git add src/main/db/neo4j.ts src/__tests__/main/db/neo4j.test.ts
git commit -m "✨ feat(neo4j): dryRunQuery via EXPLAIN plan tree"
```

---

## Task 12: Register Neo4j in the adapter registry

**Files:**
- Modify: `src/main/db/adapterRegistry.ts:1-13` (type import), `:41-52` (after snowflake import), `:102-119` (adapter + registry)
- Test: `src/__tests__/main/db/adapterRegistry.test.ts`

- [ ] **Step 1: Write the failing test additions**

In `src/__tests__/main/db/adapterRegistry.test.ts`, add a fourth mock block after the snowflake mock (after line 48, before `vi.mock('electron', …)`):

```ts
vi.mock('../../../main/db/neo4j', () => ({
  testConnection: vi.fn(),
  listDatasets: vi.fn(),
  listTables: vi.fn(),
  getTableSchema: vi.fn(),
  searchTables: vi.fn(),
  runQuery: vi.fn(),
  getQueryPage: vi.fn(),
  cancelRunningQuery: vi.fn(),
  dryRunQuery: vi.fn(),
  invalidateClient: vi.fn()
}))
```

Add the import alongside the others (after `const sf = await import('../../../main/db/snowflake')`, line 55):

```ts
const nf = await import('../../../main/db/neo4j')
```

Add an `it` inside the `getAdapterForEngine` describe (after the snowflake case, line 72):

```ts
    it('returns the Neo4j adapter for "neo4j"', () => {
      const adapter = getAdapterForEngine('neo4j')
      expect(adapter.testConnection).toBe(nf.testConnection)
    })
```

Add an `it` inside the `getAdapterForConnection` describe (after the snowflake case, line 105):

```ts
    it('dispatches to the Neo4j adapter for a neo4j connection', () => {
      const conn: Connection = {
        id: 'neo-1', name: 'Neo', engine: 'neo4j',
        uri: 'neo4j://localhost:7687', username: 'neo4j', password: 'pw',
        createdAt: '2024-01-01T00:00:00Z'
      }
      const adapter = getAdapterForConnection(conn)
      expect(adapter.testConnection).toBe(nf.testConnection)
    })
```

- [ ] **Step 2: Run the test to verify it fails**

Run: `npx vitest run src/__tests__/main/db/adapterRegistry.test.ts`
Expected: FAIL — `expected undefined to be [Function]` (registry has no `neo4j` entry yet).

- [ ] **Step 3: Implement registry wiring**

In `src/main/db/adapterRegistry.ts`, add `Neo4jConnection` to the type import block (line 3-13) — insert after `Connection,`:

```ts
  BigQueryConnection,
  Connection,
  Neo4jConnection,
  ConnectionEngine,
```

Add the neo4j function import block after the snowflake import block (after line 52):

```ts
import {
  testConnection as testNeo4j,
  listDatasets as listNeo4jDatasets,
  listTables as listNeo4jTables,
  getTableSchema as getNeo4jTableSchema,
  searchTables as searchNeo4jTables,
  runQuery as runNeo4jQuery,
  getQueryPage as getNeo4jPage,
  cancelRunningQuery as cancelNeo4j,
  dryRunQuery as dryRunNeo4j,
  invalidateClient as invalidateNeo4j
} from './neo4j'
```

Add the adapter object after `snowflakeAdapter` (after line 113):

```ts
const neo4jAdapter: DbAdapter<Neo4jConnection> = {
  testConnection: testNeo4j,
  listDatasets: listNeo4jDatasets,
  listTables: listNeo4jTables,
  getTableSchema: getNeo4jTableSchema,
  searchTables: searchNeo4jTables,
  runQuery: runNeo4jQuery,
  getQueryPage: getNeo4jPage,
  cancelRunningQuery: cancelNeo4j,
  dryRunQuery: dryRunNeo4j,
  invalidateClient: invalidateNeo4j
}
```

Replace the `registry` object (lines 115-119):

```ts
const registry: Record<ConnectionEngine, DbAdapter<Connection>> = {
  bigquery: bigQueryAdapter as DbAdapter<Connection>,
  postgres: postgresAdapter as DbAdapter<Connection>,
  snowflake: snowflakeAdapter as DbAdapter<Connection>
}
```

with:

```ts
const registry: Record<ConnectionEngine, DbAdapter<Connection>> = {
  bigquery: bigQueryAdapter as DbAdapter<Connection>,
  postgres: postgresAdapter as DbAdapter<Connection>,
  snowflake: snowflakeAdapter as DbAdapter<Connection>,
  neo4j: neo4jAdapter as DbAdapter<Connection>
}
```

- [ ] **Step 4: Run the test to verify it passes**

Run: `npx vitest run src/__tests__/main/db/adapterRegistry.test.ts`
Expected: PASS (now includes the two new neo4j cases). The IPC handlers (`catalog.ts`, `query.ts`, `connections.ts`) dispatch through `getAdapterForConnection` and need **no changes** — this test proves a neo4j connection resolves to the neo4j adapter, which is the full extent of IPC dispatch coverage Phase 1 requires.

- [ ] **Step 5: Commit**

```bash
git add src/main/db/adapterRegistry.ts src/__tests__/main/db/adapterRegistry.test.ts
git commit -m "✨ feat(neo4j): register neo4j adapter in the registry"
```

---

## Task 13: ConnectionModal — Neo4j engine tab + fields

**Files:**
- Modify: `src/renderer/src/components/connections/ConnectionModal.tsx`

- [ ] **Step 1: Add Neo4j to the engine type + import + selector list**

Replace line 12:

```ts
type Engine = 'bigquery' | 'snowflake' | 'postgres'
```

with:

```ts
type Engine = 'bigquery' | 'snowflake' | 'postgres' | 'neo4j'
```

Add `Neo4jConnection` to the type import (lines 4-10) — insert after `Connection,`:

```ts
  BigQueryConnection,
  Connection,
  ConnectionCreate,
  Neo4jConnection,
  PostgresConnection,
  SnowflakeConnection,
```

Replace the `ENGINES` array (lines 20-24):

```ts
const ENGINES: { id: Engine; label: string }[] = [
  { id: 'bigquery', label: 'BigQuery' },
  { id: 'snowflake', label: 'Snowflake' },
  { id: 'postgres', label: 'Postgres' },
]
```

with:

```ts
const ENGINES: { id: Engine; label: string }[] = [
  { id: 'bigquery', label: 'BigQuery' },
  { id: 'snowflake', label: 'Snowflake' },
  { id: 'postgres', label: 'Postgres' },
  { id: 'neo4j', label: 'Neo4j' },
]
```

- [ ] **Step 2: Add Neo4j state hooks**

Insert after the Snowflake state block (after line 60, before the `testResult` state):

```ts
  // ── Neo4j ───────────────────────────────────────────────────────────────────
  const neoInit = initEngine === 'neo4j' ? (initialConnection as Neo4jConnection) : undefined
  const [neoUri, setNeoUri] = useState(neoInit?.uri ?? '')
  const [neoUsername, setNeoUsername] = useState(neoInit?.username ?? '')
  const [neoPassword, setNeoPassword] = useState(neoInit?.password ?? '')
  const [neoDatabase, setNeoDatabase] = useState(neoInit?.database ?? '')
```

- [ ] **Step 3: Add Neo4j validation**

In the `isValid` IIFE, insert the neo4j branch immediately before the `// snowflake` comment (before line 80):

```ts
      if (engine === 'neo4j')
        return Boolean(neoUri.trim() && neoUsername.trim() && neoPassword.trim())
```

- [ ] **Step 4: Add Neo4j payload construction**

In `buildPayload`, insert the neo4j branch immediately before the final `return { engine: 'snowflake', … }` (before line 106):

```ts
    if (engine === 'neo4j') {
      return {
        engine: 'neo4j',
        name: name.trim(),
        uri: neoUri.trim(),
        username: neoUsername.trim(),
        password: neoPassword,
        database: neoDatabase.trim() || undefined,
      }
    }
```

- [ ] **Step 5: Add the Neo4j fields JSX**

Insert immediately after the Snowflake fields block closes (after line 359, before the `{testResult && (` block):

```tsx
          {/* Neo4j fields */}
          {engine === 'neo4j' && (
            <>
              <Field label="Connection URI">
                <input
                  value={neoUri}
                  onChange={(e) => setNeoUri(e.target.value)}
                  placeholder="neo4j://localhost:7687"
                  className={inputCls}
                />
              </Field>
              <div className="flex gap-4">
                <Field label="Username">
                  <input
                    value={neoUsername}
                    onChange={(e) => setNeoUsername(e.target.value)}
                    placeholder="neo4j"
                    className={inputCls}
                  />
                </Field>
                <Field label="Password">
                  <input
                    type="password"
                    value={neoPassword}
                    onChange={(e) => setNeoPassword(e.target.value)}
                    placeholder="••••••••"
                    className={inputCls}
                  />
                </Field>
              </div>
              <Field label="Database (optional)">
                <input
                  value={neoDatabase}
                  onChange={(e) => setNeoDatabase(e.target.value)}
                  placeholder="neo4j"
                  className={inputCls}
                />
              </Field>
            </>
          )}
```

- [ ] **Step 6: Verify it compiles**

Run: `npm run typecheck`
Expected: PASS (the `QueryEditor.tsx` map errors from Task 2 may still show until Task 19 — see Task 2 Step 6 note; no *new* errors should appear in `ConnectionModal.tsx`).

- [ ] **Step 7: Commit**

```bash
git add src/renderer/src/components/connections/ConnectionModal.tsx
git commit -m "✨ feat(neo4j): Neo4j tab + fields in the connection modal"
```

---

## Task 14: TitleBar — `cat-teal` per-engine accent

**Files:**
- Modify: `src/renderer/src/components/layout/TitleBar.tsx:8` (import), `:19-24` (connectionLabel), `:96-100` (engineColor), `:266-271` (engineAccent)

- [ ] **Step 1: Add `Neo4jConnection` to the type import**

Replace line 8:

```ts
import type { BigQueryConnection, Connection, PostgresConnection, SnowflakeConnection } from '@shared/types'
```

with:

```ts
import type { BigQueryConnection, Connection, Neo4jConnection, PostgresConnection, SnowflakeConnection } from '@shared/types'
```

- [ ] **Step 2: Add the neo4j branch to `connectionLabel`**

Replace the body of `connectionLabel` (lines 20-23):

```ts
  const engine = c.engine ?? 'bigquery'
  if (engine === 'bigquery') return (c as BigQueryConnection).projectId
  if (engine === 'snowflake') return (c as SnowflakeConnection).account
  return (c as PostgresConnection).database ?? (c as PostgresConnection).host
```

with:

```ts
  const engine = c.engine ?? 'bigquery'
  if (engine === 'bigquery') return (c as BigQueryConnection).projectId
  if (engine === 'snowflake') return (c as SnowflakeConnection).account
  if (engine === 'neo4j') return (c as Neo4jConnection).database || (c as Neo4jConnection).uri
  return (c as PostgresConnection).database ?? (c as PostgresConnection).host
```

- [ ] **Step 3: Add the neo4j branch to `engineColor`**

Replace the `engineColor` expression (lines 96-100):

```ts
  const engineColor =
    engineLabel === 'bigquery'  ? 'text-app-cat-blue' :
    engineLabel === 'snowflake' ? 'text-app-accent-text' :   // Snowflake stays terracotta
    engineLabel === 'postgres'  ? 'text-app-cat-purple' :
                                  'text-app-text'
```

with:

```ts
  const engineColor =
    engineLabel === 'bigquery'  ? 'text-app-cat-blue' :
    engineLabel === 'snowflake' ? 'text-app-accent-text' :   // Snowflake stays terracotta
    engineLabel === 'postgres'  ? 'text-app-cat-purple' :
    engineLabel === 'neo4j'     ? 'text-app-cat-teal' :
                                  'text-app-text'
```

- [ ] **Step 4: Add the neo4j branch to `engineAccent`**

Replace the `engineAccent` body (lines 267-270):

```ts
  if (engine === 'bigquery')  return 'text-app-cat-blue'
  if (engine === 'snowflake') return 'text-app-accent-text'
  if (engine === 'postgres')  return 'text-app-cat-purple'
  return 'text-app-text-3'
```

with:

```ts
  if (engine === 'bigquery')  return 'text-app-cat-blue'
  if (engine === 'snowflake') return 'text-app-accent-text'
  if (engine === 'postgres')  return 'text-app-cat-purple'
  if (engine === 'neo4j')     return 'text-app-cat-teal'
  return 'text-app-text-3'
```

- [ ] **Step 5: Verify it compiles**

Run: `npm run typecheck`
Expected: PASS (modulo the known pre-Task-19 `QueryEditor.tsx` map note).

- [ ] **Step 6: Commit**

```bash
git add src/renderer/src/components/layout/TitleBar.tsx
git commit -m "💄 feat(neo4j): teal engine accent in the title bar breadcrumb + dropdown"
```

---

## Task 15: `buildCypherQuery` util

**Files:**
- Create: `src/renderer/src/lib/buildCypherQuery.ts`
- Test: `src/__tests__/renderer/lib/buildCypherQuery.test.ts`

- [ ] **Step 1: Write the failing test**

Create `src/__tests__/renderer/lib/buildCypherQuery.test.ts`:

```ts
import { describe, it, expect } from 'vitest'
import { buildLabelQuery, buildRelationshipTypeQuery, quoteCypherIdent } from '../../../renderer/src/lib/buildCypherQuery'

describe('buildCypherQuery', () => {
  it('builds a node MATCH for a label', () => {
    expect(buildLabelQuery('Person')).toBe('MATCH (n:`Person`) RETURN n LIMIT 100')
  })

  it('builds a relationship MATCH for a relationship type', () => {
    expect(buildRelationshipTypeQuery('KNOWS')).toBe('MATCH ()-[r:`KNOWS`]->() RETURN r LIMIT 100')
  })

  it('escapes backticks in identifiers', () => {
    expect(quoteCypherIdent('we`ird')).toBe('`we``ird`')
  })
})
```

- [ ] **Step 2: Run the test to verify it fails**

Run: `npx vitest run src/__tests__/renderer/lib/buildCypherQuery.test.ts`
Expected: FAIL — `Cannot find module '.../buildCypherQuery'`.

- [ ] **Step 3: Implement the builder**

Create `src/renderer/src/lib/buildCypherQuery.ts`:

```ts
/**
 * Cypher analogue of buildSelectQuery — generates a "show me this label /
 * relationship type" starter query for the catalog's "Query …" actions.
 */
export function buildLabelQuery(label: string): string {
  return `MATCH (n:${quoteCypherIdent(label)}) RETURN n LIMIT 100`
}

export function buildRelationshipTypeQuery(relType: string): string {
  return `MATCH ()-[r:${quoteCypherIdent(relType)}]->() RETURN r LIMIT 100`
}

/** Backtick-quote a Cypher identifier, escaping embedded backticks. */
export function quoteCypherIdent(ident: string): string {
  return `\`${ident.replace(/`/g, '``')}\``
}
```

- [ ] **Step 4: Run the test to verify it passes**

Run: `npx vitest run src/__tests__/renderer/lib/buildCypherQuery.test.ts`
Expected: PASS (3 tests).

- [ ] **Step 5: Commit**

```bash
git add src/renderer/src/lib/buildCypherQuery.ts src/__tests__/renderer/lib/buildCypherQuery.test.ts
git commit -m "✨ feat(neo4j): buildCypherQuery label/relationship starters"
```

---

## Task 16: CatalogTree — Labels / Relationship Types sections

**Files:**
- Modify: `src/renderer/src/components/catalog/CatalogTree.tsx:2` (icons), `:7` (import), `:142-177` (dataset expansion), `:196-273` (TableRow)

- [ ] **Step 1: Add icon imports + the Cypher builders**

Replace line 2:

```ts
import { ChevronRight, ChevronDown, Table2, Layers, RefreshCw, MoreHorizontal, Copy, Check, Search, X, Play } from 'lucide-react'
```

with:

```ts
import { ChevronRight, ChevronDown, Table2, Layers, RefreshCw, MoreHorizontal, Copy, Check, Search, X, Play, Circle, ArrowLeftRight } from 'lucide-react'
```

Add the builder import after line 7 (`import { buildSelectQuery } …`):

```ts
import { buildLabelQuery, buildRelationshipTypeQuery } from '../../lib/buildCypherQuery'
```

- [ ] **Step 2: Replace the dataset-expansion render with a `renderRow` helper + section grouping**

Replace the whole expansion block (lines 142-177) — the `{isExpanded && ( … )}` JSX — with:

```tsx
            {isExpanded && (() => {
              const renderRow = (table: Table) => (
                <TableRow
                  key={table.id}
                  table={table}
                  datasetId={dataset.id}
                  connectionId={activeConnectionId}
                  isActive={
                    activeTableRef?.tableId === table.id &&
                    activeTableRef?.datasetId === dataset.id
                  }
                  onOpen={() =>
                    openTableTab(
                      activeConnectionId,
                      activeEngine,
                      projectContextId,
                      dataset.id,
                      table.id,
                      table.name,
                    )
                  }
                  onQueryTable={() => {
                    const sql =
                      activeEngine === 'neo4j'
                        ? table.type === 'RELATIONSHIP_TYPE'
                          ? buildRelationshipTypeQuery(table.id)
                          : buildLabelQuery(table.id)
                        : buildSelectQuery(activeEngine, projectContextId, dataset.id, table.id)
                    openTab({ sql, connectionId: activeConnectionId, title: table.name })
                  }}
                />
              )

              return (
                <div className="ml-3 border-l border-app-border">
                  {isTableLoading ? (
                    <div className="px-3 py-1.5 text-xs text-app-text-3 animate-pulse">Loading tables…</div>
                  ) : tables.length === 0 && allTables.length === 0 ? (
                    <div className="px-3 py-1.5 text-xs text-app-text-3">No tables.</div>
                  ) : activeEngine === 'neo4j' ? (
                    <>
                      {tables.some((t) => t.type === 'LABEL') && (
                        <div className="px-3 pt-1.5 pb-0.5"><span className="app-section-label">Labels</span></div>
                      )}
                      {tables.filter((t) => t.type === 'LABEL').map(renderRow)}
                      {tables.some((t) => t.type === 'RELATIONSHIP_TYPE') && (
                        <div className="px-3 pt-2 pb-0.5"><span className="app-section-label">Relationship Types</span></div>
                      )}
                      {tables.filter((t) => t.type === 'RELATIONSHIP_TYPE').map(renderRow)}
                    </>
                  ) : (
                    tables.map(renderRow)
                  )}
                </div>
              )
            })()}
```

- [ ] **Step 3: Update `TableRow` icons + copy reference for graph kinds**

Replace the icon-derivation lines in `TableRow` (lines 218-220):

```ts
  // View / materialized-view → cat-purple icon; tables → cat-green
  const isView = table.type === 'VIEW' || table.type === 'MATERIALIZED_VIEW'
  const iconColor = isView ? 'text-app-cat-purple' : 'text-app-cat-green'
```

with:

```ts
  // Neo4j label / relationship type → teal; views → purple; tables → green
  const isLabel = table.type === 'LABEL'
  const isRelType = table.type === 'RELATIONSHIP_TYPE'
  const isView = table.type === 'VIEW' || table.type === 'MATERIALIZED_VIEW'
  const iconColor =
    isLabel || isRelType ? 'text-app-cat-teal' : isView ? 'text-app-cat-purple' : 'text-app-cat-green'
  const Icon = isRelType ? ArrowLeftRight : isLabel ? Circle : Table2
```

Replace the `ref` declaration in `TableRow` (line 200):

```ts
  const ref = `${datasetId}.${table.id}`
```

with:

```ts
  // For graph kinds the bare label/type name is the useful reference; else dataset.table
  const ref = isLabel || isRelType ? table.id : `${datasetId}.${table.id}`
```

> Note: `isLabel` / `isRelType` are declared above this line in the previous edit, so they are in scope. If the executor applies edits out of order, ensure the icon-derivation edit lands before this one.

Replace the icon render line (line 236):

```tsx
        <Table2 size={11} className={`${iconColor} shrink-0`} />
```

with:

```tsx
        <Icon size={11} className={`${iconColor} shrink-0`} />
```

- [ ] **Step 4: Verify it compiles**

Run: `npm run typecheck`
Expected: PASS (modulo the known pre-Task-19 `QueryEditor.tsx` note).

- [ ] **Step 5: Commit**

```bash
git add src/renderer/src/components/catalog/CatalogTree.tsx
git commit -m "✨ feat(neo4j): Labels / Relationship Types catalog sections"
```

---

## Task 17: TableDetailPanel — sample-inferred schema banner

**Files:**
- Modify: `src/renderer/src/components/catalog/TableDetailPanel.tsx:4` (type import), `:126` (pass engine), `:136` (SchemaSection signature), `:155-179` (banner)

- [ ] **Step 1: Add `ConnectionEngine` to the type import**

Replace line 4:

```ts
import type { TableField, QueryResult } from '@shared/types'
```

with:

```ts
import type { TableField, QueryResult, ConnectionEngine } from '@shared/types'
```

- [ ] **Step 2: Pass `engine` into `SchemaSection`**

Replace line 126:

```tsx
          <SchemaSection schema={schema} loading={schemaLoading} error={schemaError} />
```

with:

```tsx
          <SchemaSection schema={schema} loading={schemaLoading} error={schemaError} engine={engine} />
```

- [ ] **Step 3: Update the `SchemaSection` signature**

Replace line 136:

```ts
function SchemaSection({ schema, loading, error }: { schema: TableField[] | null; loading: boolean; error: string | null }) {
```

with:

```ts
function SchemaSection({ schema, loading, error, engine }: { schema: TableField[] | null; loading: boolean; error: string | null; engine?: ConnectionEngine }) {
```

- [ ] **Step 4: Render the caveat banner**

Insert the banner immediately after the column-search bar `</div>` and before the `<table` element (after line 179, before `<table className="w-full text-xs border-collapse">`):

```tsx
      {engine === 'neo4j' && (
        <div className="px-3 py-1.5 text-[11px] text-app-text-3 bg-app-warn-subtle/30 border-b border-app-border shrink-0">
          Inferred from up to 50 sampled records — Neo4j is schema-optional, so this list may be incomplete.
        </div>
      )}
```

- [ ] **Step 5: Verify it compiles**

Run: `npm run typecheck`
Expected: PASS (modulo the known pre-Task-19 `QueryEditor.tsx` note).

- [ ] **Step 6: Commit**

```bash
git add src/renderer/src/components/catalog/TableDetailPanel.tsx
git commit -m "✨ feat(neo4j): sample-inferred caveat banner on the schema tab"
```

---

## Task 18: Cypher language (StreamLanguage tokenizer)

**Files:**
- Create: `src/renderer/src/lib/cypherLanguage.ts`
- Test: `src/__tests__/renderer/lib/cypherLanguage.test.ts`

- [ ] **Step 1: Write the failing test**

Create `src/__tests__/renderer/lib/cypherLanguage.test.ts`:

```ts
import { describe, it, expect } from 'vitest'
import { StringStream } from '@codemirror/language'
import { cypherParser, buildCypherCompletionOptions } from '../../../renderer/src/lib/cypherLanguage'

function tokenize(line: string): { text: string; tag: string | null }[] {
  const state = cypherParser.startState!(4)
  const stream = new StringStream(line, 4, 4)
  const out: { text: string; tag: string | null }[] = []
  let guard = 0
  while (!stream.eol() && guard++ < 500) {
    stream.start = stream.pos
    const tag = cypherParser.token!(stream, state)
    if (stream.pos === stream.start) { stream.next(); continue }
    out.push({ text: line.slice(stream.start, stream.pos), tag })
  }
  return out
}

describe('cypherParser', () => {
  it('tags keywords, labels, and identifiers', () => {
    const tokens = tokenize('MATCH (n:Person) RETURN n')
    expect(tokens.find((t) => t.text === 'MATCH')?.tag).toBe('keyword')
    expect(tokens.find((t) => t.text === 'RETURN')?.tag).toBe('keyword')
    expect(tokens.find((t) => t.text === ':Person')?.tag).toBe('typeName')
    expect(tokens.find((t) => t.text === 'n')?.tag).toBe('variableName')
  })

  it('tags strings, numbers, parameters, and comments', () => {
    expect(tokenize('"hi"').find((t) => t.text === '"hi"')?.tag).toBe('string')
    expect(tokenize('42').find((t) => t.text === '42')?.tag).toBe('number')
    expect(tokenize('$id').find((t) => t.text === '$id')?.tag).toBe('atom')
    expect(tokenize('// note').find((t) => t.text === '// note')?.tag).toBe('comment')
  })

  it('tags known functions distinctly from plain identifiers', () => {
    expect(tokenize('count').find((t) => t.text === 'count')?.tag).toBe('variableName.function')
  })
})

describe('buildCypherCompletionOptions', () => {
  it('includes keywords, functions, and schema-derived items', () => {
    const opts = buildCypherCompletionOptions({
      labels: ['Person'],
      relationshipTypes: ['KNOWS'],
      propertyKeys: ['name'],
    })
    const labels = opts.map((o) => o.label)
    expect(labels).toContain('MATCH')
    expect(labels).toContain('count')
    expect(labels).toContain('Person')
    expect(labels).toContain('KNOWS')
    expect(labels).toContain('name')
  })
})
```

- [ ] **Step 2: Run the test to verify it fails**

Run: `npx vitest run src/__tests__/renderer/lib/cypherLanguage.test.ts`
Expected: FAIL — `Cannot find module '.../cypherLanguage'`.

- [ ] **Step 3: Implement the Cypher language module**

Create `src/renderer/src/lib/cypherLanguage.ts`:

```ts
import { StreamLanguage, LanguageSupport, type StreamParser } from '@codemirror/language'
import { completeFromList, type CompletionSource } from '@codemirror/autocomplete'

const KEYWORDS = new Set([
  'MATCH', 'OPTIONAL', 'WHERE', 'RETURN', 'WITH', 'CREATE', 'MERGE', 'DELETE', 'DETACH',
  'REMOVE', 'SET', 'ORDER', 'BY', 'LIMIT', 'SKIP', 'UNWIND', 'CALL', 'YIELD', 'AS', 'ON',
  'AND', 'OR', 'XOR', 'NOT', 'IN', 'STARTS', 'ENDS', 'CONTAINS', 'IS', 'NULL', 'TRUE',
  'FALSE', 'DISTINCT', 'UNION', 'ALL', 'CASE', 'WHEN', 'THEN', 'ELSE', 'END', 'ASC',
  'DESC', 'FOREACH', 'USING', 'INDEX', 'CONSTRAINT', 'DROP', 'EXISTS', 'LOAD', 'CSV',
  'FROM', 'HEADERS',
])

const FUNCTIONS = new Set([
  'count', 'collect', 'sum', 'avg', 'min', 'max', 'size', 'length', 'type', 'id', 'labels',
  'keys', 'nodes', 'relationships', 'properties', 'tointeger', 'tofloat', 'tostring',
  'toboolean', 'coalesce', 'head', 'tail', 'last', 'range', 'reverse', 'substring',
  'replace', 'split', 'trim', 'tolower', 'toupper', 'abs', 'ceil', 'floor', 'round',
  'sqrt', 'rand', 'timestamp', 'date', 'datetime', 'duration', 'point',
])

// Stateless tokenizer — Cypher strings/comments here are single-line.
type CypherState = Record<string, never>

export const cypherParser: StreamParser<CypherState> = {
  startState: () => ({}),
  token(stream) {
    if (stream.eatSpace()) return null

    // Line comment
    if (stream.match('//')) {
      stream.skipToEnd()
      return 'comment'
    }
    // String literal (single- or double-quoted)
    const ch = stream.peek()
    if (ch === '"' || ch === "'") {
      stream.next()
      let escaped = false
      let c: string | void
      while ((c = stream.next()) != null) {
        if (c === ch && !escaped) break
        escaped = c === '\\' && !escaped
      }
      return 'string'
    }
    // Parameter ($name)
    if (stream.match(/^\$[A-Za-z_][A-Za-z0-9_]*/)) return 'atom'
    // Number
    if (stream.match(/^-?\d+\.?\d*/)) return 'number'
    // Label / relationship type (:Name)
    if (stream.match(/^:[A-Za-z_][A-Za-z0-9_]*/)) return 'typeName'
    // Word — keyword / function / identifier
    if (stream.match(/^[A-Za-z_][A-Za-z0-9_]*/)) {
      const word = stream.current()
      if (KEYWORDS.has(word.toUpperCase())) return 'keyword'
      if (FUNCTIONS.has(word.toLowerCase())) return 'variableName.function'
      return 'variableName'
    }
    // Brackets
    if (stream.match(/^[{}[\]()]/)) return 'bracket'
    // Operators / arrows
    if (stream.match(/^[-=<>!+*/%^.,|]+/)) return 'operator'

    stream.next()
    return null
  },
}

export interface CypherSchema {
  labels: string[]
  relationshipTypes: string[]
  propertyKeys: string[]
}

const KEYWORD_LIST = Array.from(KEYWORDS)
const FUNCTION_LIST = Array.from(FUNCTIONS)

/** Flat list of completion options — pure + unit-testable without a CompletionContext. */
export function buildCypherCompletionOptions(
  schema: CypherSchema,
): { label: string; type: string }[] {
  return [
    ...KEYWORD_LIST.map((label) => ({ label, type: 'keyword' })),
    ...FUNCTION_LIST.map((label) => ({ label, type: 'function' })),
    ...schema.labels.map((label) => ({ label, type: 'class' })),
    ...schema.relationshipTypes.map((label) => ({ label, type: 'type' })),
    ...schema.propertyKeys.map((label) => ({ label, type: 'property' })),
  ]
}

export function cypherCompletions(schema: CypherSchema): CompletionSource {
  return completeFromList(buildCypherCompletionOptions(schema))
}

/** Build the CodeMirror LanguageSupport for Cypher, with optional schema-aware autocomplete. */
export function cypher(schema?: CypherSchema): LanguageSupport {
  const language = StreamLanguage.define(cypherParser)
  const support = schema ? [language.data.of({ autocomplete: cypherCompletions(schema) })] : []
  return new LanguageSupport(language, support)
}
```

- [ ] **Step 4: Run the test to verify it passes**

Run: `npx vitest run src/__tests__/renderer/lib/cypherLanguage.test.ts`
Expected: PASS (4 tests).

- [ ] **Step 5: Commit**

```bash
git add src/renderer/src/lib/cypherLanguage.ts src/__tests__/renderer/lib/cypherLanguage.test.ts
git commit -m "✨ feat(neo4j): Cypher StreamLanguage + completion options"
```

---

## Task 19: Wire Cypher into QueryEditor + Editor

**Files:**
- Modify: `src/renderer/src/components/editor/QueryEditor.tsx:8` (import), `:11-25` (props), `:28-39` (maps), `:56-74` (memo + format), `:190` (extensions)
- Modify: `src/renderer/src/pages/Editor.tsx:61-77` (after sqlSchema memo), `:269-368` (3 QueryEditor instances)

- [ ] **Step 1: Import the Cypher language + type in QueryEditor**

Add after line 8 (`import { Bookmark … } from 'lucide-react'`):

```ts
import { cypher, type CypherSchema } from '../../lib/cypherLanguage'
```

- [ ] **Step 2: Add the `cypherSchema` prop**

In the `QueryEditorProps` interface, add after `sqlSchema?: Record<string, string[]>` (line 23):

```ts
  cypherSchema?: CypherSchema
```

Add `cypherSchema` to the destructured params (line 54) — replace:

```ts
  value, onChange, onRun, onCancel, onExplain, onSave, onSplit, isSplit, isRunning, isExplaining, savedQueryId, sqlSchema, engine,
```

with:

```ts
  value, onChange, onRun, onCancel, onExplain, onSave, onSplit, isSplit, isRunning, isExplaining, savedQueryId, sqlSchema, cypherSchema, engine,
```

- [ ] **Step 3: Add `neo4j` entries to the dialect maps**

Replace `FORMAT_DIALECT_MAP` (lines 28-32):

```ts
const FORMAT_DIALECT_MAP: Record<ConnectionEngine, string> = {
  bigquery: 'bigquery',
  postgres: 'postgresql',
  snowflake: 'snowflake',
}
```

with:

```ts
const FORMAT_DIALECT_MAP: Record<ConnectionEngine, string> = {
  bigquery: 'bigquery',
  postgres: 'postgresql',
  snowflake: 'snowflake',
  neo4j: 'sql', // unused — Cypher formatting is skipped (sql-formatter has no Cypher dialect)
}
```

Replace `CM_DIALECT_MAP` (lines 35-39):

```ts
const CM_DIALECT_MAP = {
  bigquery: StandardSQL,
  postgres: PostgreSQL,
  snowflake: StandardSQL,
} satisfies Record<ConnectionEngine, typeof StandardSQL>
```

with:

```ts
const CM_DIALECT_MAP = {
  bigquery: StandardSQL,
  postgres: PostgreSQL,
  snowflake: StandardSQL,
  neo4j: StandardSQL, // unused — Cypher uses its own StreamLanguage (see languageExtension)
} satisfies Record<ConnectionEngine, typeof StandardSQL>
```

- [ ] **Step 4: Branch the language extension + guard formatting**

Replace the `sqlExtension` memo (lines 56-63):

```ts
  const sqlExtension = useMemo(
    () => sql({
      dialect: engine ? CM_DIALECT_MAP[engine] : StandardSQL,
      schema: sqlSchema ?? {},
      upperCaseKeywords: true,
    }),
    [sqlSchema, engine]
  )
```

with:

```ts
  const languageExtension = useMemo(() => {
    if (engine === 'neo4j') return cypher(cypherSchema)
    return sql({
      dialect: engine ? CM_DIALECT_MAP[engine] : StandardSQL,
      schema: sqlSchema ?? {},
      upperCaseKeywords: true,
    })
  }, [sqlSchema, cypherSchema, engine])
```

In `handleFormat`, add a guard as the first statement (after line 65 `const handleFormat = useCallback(() => {`):

```ts
    if (engine === 'neo4j') return // Cypher has no sql-formatter dialect
```

Replace the extensions array (line 190):

```tsx
          extensions={[sqlExtension, keymapExtension, customTheme]}
```

with:

```tsx
          extensions={[languageExtension, keymapExtension, customTheme]}
```

- [ ] **Step 5: Build `cypherSchema` in Editor.tsx**

In `src/renderer/src/pages/Editor.tsx`, insert this memo immediately after the `sqlSchema` memo closes (after line 77):

```ts
  // Build Cypher autocomplete schema (labels / relationship types / property keys)
  // from the active Neo4j connection's loaded catalog data.
  const cypherSchema = useMemo(() => {
    if (!activeConnectionId || activeEngine !== 'neo4j') return undefined
    const labels: string[] = []
    const relationshipTypes: string[] = []
    const propertyKeys = new Set<string>()
    const datasets = datasetsByConnection[activeConnectionId] ?? []
    for (const ds of datasets) {
      const tables = tablesByDataset[`${activeConnectionId}:${ds.id}`] ?? []
      for (const t of tables) {
        if (t.type === 'RELATIONSHIP_TYPE') relationshipTypes.push(t.name)
        else labels.push(t.name)
        const fields = schemaCache[`${activeConnectionId}:${ds.id}:${t.id}`]
        if (fields) for (const f of fields) propertyKeys.add(f.name)
      }
    }
    return { labels, relationshipTypes, propertyKeys: Array.from(propertyKeys) }
  }, [activeConnectionId, activeEngine, datasetsByConnection, tablesByDataset, schemaCache])
```

- [ ] **Step 6: Thread `cypherSchema` to all three QueryEditor instances**

In each of the three `<QueryEditor … />` blocks, add `cypherSchema={cypherSchema}` immediately after the `sqlSchema={sqlSchema}` line:

1. Split-left (after line 281 `sqlSchema={sqlSchema}`)
2. Split-right (after line 332 `sqlSchema={sqlSchema}`)
3. Single-pane (after line 367 `sqlSchema={sqlSchema}`)

Each becomes:

```tsx
                    sqlSchema={sqlSchema}
                    cypherSchema={cypherSchema}
```

(match the surrounding indentation of each instance).

- [ ] **Step 7: Verify it compiles and the editor tests pass**

Run: `npm run typecheck && npx vitest run src/__tests__/renderer/lib/cypherLanguage.test.ts`
Expected: typecheck PASS (the Task-2 `QueryEditor.tsx` map note is now resolved); tests PASS.

- [ ] **Step 8: Commit**

```bash
git add src/renderer/src/components/editor/QueryEditor.tsx src/renderer/src/pages/Editor.tsx
git commit -m "✨ feat(neo4j): Cypher highlighting + schema-aware autocomplete in the editor"
```

---

## Task 20: Graph element formatter + discriminator

**Files:**
- Create: `src/renderer/src/lib/formatGraphElement.ts`
- Test: `src/__tests__/renderer/lib/formatGraphElement.test.ts`

- [ ] **Step 1: Write the failing test**

Create `src/__tests__/renderer/lib/formatGraphElement.test.ts`:

```ts
import { describe, it, expect } from 'vitest'
import { isGraphElement, formatGraphElement } from '../../../renderer/src/lib/formatGraphElement'
import type { Neo4jNode, Neo4jRelationship, Neo4jPath } from '../../../shared/types'

const alice: Neo4jNode = {
  __neo4jType: 'Node', identity: '1', labels: ['Person'],
  properties: { name: 'Alice', age: 30, city: 'NYC' },
}
const knows: Neo4jRelationship = {
  __neo4jType: 'Relationship', identity: 'r1', start: '1', end: '2',
  type: 'KNOWS', properties: { since: 2020 },
}

describe('isGraphElement', () => {
  it('detects tagged graph values', () => {
    expect(isGraphElement(alice)).toBe(true)
    expect(isGraphElement(knows)).toBe(true)
  })
  it('rejects scalars and plain objects', () => {
    expect(isGraphElement('hi')).toBe(false)
    expect(isGraphElement(42)).toBe(false)
    expect(isGraphElement(null)).toBe(false)
    expect(isGraphElement({ value: 'x' })).toBe(false)
  })
})

describe('formatGraphElement', () => {
  it('formats a node with labels + truncated properties', () => {
    expect(formatGraphElement(alice)).toBe('(:Person {name: "Alice", age: 30, …})')
  })
  it('formats a relationship', () => {
    expect(formatGraphElement(knows)).toBe('[:KNOWS {since: 2020}]')
  })
  it('formats a path as nodes joined by directed relationships', () => {
    const bob: Neo4jNode = { __neo4jType: 'Node', identity: '2', labels: ['Person'], properties: { name: 'Bob' } }
    const path: Neo4jPath = {
      __neo4jType: 'Path',
      segments: [{ start: alice, relationship: knows, end: bob }],
    }
    expect(formatGraphElement(path)).toBe('(:Person {name: "Alice", age: 30, …})-[:KNOWS]->(:Person {name: "Bob"})')
  })
})
```

- [ ] **Step 2: Run the test to verify it fails**

Run: `npx vitest run src/__tests__/renderer/lib/formatGraphElement.test.ts`
Expected: FAIL — `Cannot find module '.../formatGraphElement'`.

- [ ] **Step 3: Implement the formatter**

Create `src/renderer/src/lib/formatGraphElement.ts`:

```ts
import type { Neo4jGraphValue, Neo4jNode } from '@shared/types'

/** True when a cell value is a serialized Neo4j Node / Relationship / Path. */
export function isGraphElement(value: unknown): value is Neo4jGraphValue {
  return (
    typeof value === 'object' &&
    value !== null &&
    '__neo4jType' in value &&
    ['Node', 'Relationship', 'Path'].includes((value as { __neo4jType: string }).__neo4jType)
  )
}

/** Compact Cypher-style string for a graph value, e.g. `(:Person {name: "Alice", …})`. */
export function formatGraphElement(value: Neo4jGraphValue): string {
  if (value.__neo4jType === 'Node') return formatNode(value)
  if (value.__neo4jType === 'Relationship') return `[:${value.type}${formatProps(value.properties)}]`
  // Path
  if (value.segments.length === 0) return '()'
  let out = formatNode(value.segments[0].start)
  for (const seg of value.segments) {
    out += `-[:${seg.relationship.type}]->${formatNode(seg.end)}`
  }
  return out
}

function formatNode(node: Neo4jNode): string {
  const labels = node.labels.length ? ':' + node.labels.join(':') : ''
  return `(${labels}${formatProps(node.properties)})`
}

function formatProps(props: Record<string, unknown>, max = 2): string {
  const entries = Object.entries(props)
  if (entries.length === 0) return ''
  const shown = entries.slice(0, max).map(([k, v]) => `${k}: ${formatScalar(v)}`)
  const suffix = entries.length > max ? ', …' : ''
  return ` {${shown.join(', ')}${suffix}}`
}

function formatScalar(v: unknown): string {
  if (typeof v === 'string') return `"${v}"`
  return String(v)
}
```

- [ ] **Step 4: Run the test to verify it passes**

Run: `npx vitest run src/__tests__/renderer/lib/formatGraphElement.test.ts`
Expected: PASS (5 tests).

- [ ] **Step 5: Commit**

```bash
git add src/renderer/src/lib/formatGraphElement.ts src/__tests__/renderer/lib/formatGraphElement.test.ts
git commit -m "✨ feat(neo4j): graph-element formatter + isGraphElement discriminator"
```

---

## Task 21: GraphElementChip + ResultsTable cell rendering

**Files:**
- Create: `src/renderer/src/components/results/GraphElementChip.tsx`
- Modify: `src/renderer/src/components/results/ResultsTable.tsx:4` (import), `:410-419` (cell render)

- [ ] **Step 1: Create the chip component**

Create `src/renderer/src/components/results/GraphElementChip.tsx`:

```tsx
import type { Neo4jGraphValue } from '@shared/types'
import { formatGraphElement } from '../../lib/formatGraphElement'

/**
 * Renders a serialized Node / Relationship / Path as a compact Cypher-style chip.
 * Color hints by kind: nodes teal, relationships purple, paths blue.
 */
export default function GraphElementChip({ value }: { value: Neo4jGraphValue }) {
  const text = formatGraphElement(value)
  const color =
    value.__neo4jType === 'Relationship'
      ? 'text-app-cat-purple'
      : value.__neo4jType === 'Path'
      ? 'text-app-cat-blue'
      : 'text-app-cat-teal'
  return (
    <span
      className={`inline-block max-w-full truncate rounded px-1.5 py-0.5 bg-app-elevated border border-app-border font-mono text-[11px] ${color}`}
      title={text}
    >
      {text}
    </span>
  )
}
```

- [ ] **Step 2: Import the chip + discriminator in ResultsTable**

Add after line 5 (`import { filterSortRows } …`):

```ts
import type { Neo4jGraphValue } from '@shared/types'
import { isGraphElement } from '../../lib/formatGraphElement'
import GraphElementChip from './GraphElementChip'
```

- [ ] **Step 3: Branch the cell render**

Replace the `columns.map` cell block (lines 410-419):

```tsx
                {columns.map((col) => (
                  <td
                    key={col}
                    className="px-3 py-1.5 text-app-text font-mono border-b border-app-border/40 overflow-hidden"
                    style={{ width: colWidths[col] ?? DEFAULT_COL_WIDTH, maxWidth: colWidths[col] ?? DEFAULT_COL_WIDTH }}
                    title={formatCell(row[col])}
                  >
                    <span className="block truncate">{formatCell(row[col])}</span>
                  </td>
                ))}
```

with:

```tsx
                {columns.map((col) => {
                  const cell = row[col]
                  return (
                    <td
                      key={col}
                      className="px-3 py-1.5 text-app-text font-mono border-b border-app-border/40 overflow-hidden"
                      style={{ width: colWidths[col] ?? DEFAULT_COL_WIDTH, maxWidth: colWidths[col] ?? DEFAULT_COL_WIDTH }}
                      title={isGraphElement(cell) ? undefined : formatCell(cell)}
                    >
                      {isGraphElement(cell) ? (
                        <GraphElementChip value={cell as Neo4jGraphValue} />
                      ) : (
                        <span className="block truncate">{formatCell(cell)}</span>
                      )}
                    </td>
                  )
                })}
```

- [ ] **Step 4: Verify it compiles**

Run: `npm run typecheck`
Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add src/renderer/src/components/results/GraphElementChip.tsx src/renderer/src/components/results/ResultsTable.tsx
git commit -m "✨ feat(neo4j): compact graph-element chips in the results table"
```

---

## Task 22: detectMissingLimit — Cypher read-statement starters

**Files:**
- Modify: `src/renderer/src/lib/detectMissingLimit.ts:14`
- Test: `src/__tests__/renderer/lib/detectMissingLimit.test.ts` (extend)

- [ ] **Step 1: Write the failing test additions**

Append these tests inside the existing top-level `describe` in `src/__tests__/renderer/lib/detectMissingLimit.test.ts` (place them before the closing `})` of the describe block):

```ts
  it('flags a MATCH … RETURN with no LIMIT', () => {
    expect(detectMissingLimit('MATCH (n:Person) RETURN n')).toBe(true)
  })

  it('does not flag a MATCH … RETURN that has a LIMIT', () => {
    expect(detectMissingLimit('MATCH (n:Person) RETURN n LIMIT 100')).toBe(false)
  })

  it('flags an OPTIONAL MATCH read query', () => {
    expect(detectMissingLimit('OPTIONAL MATCH (n) RETURN n')).toBe(true)
  })

  it('does not flag a Cypher write statement (CREATE)', () => {
    expect(detectMissingLimit('CREATE (n:Person {name: "Alice"}) RETURN n')).toBe(false)
  })
```

> If the test file uses a top-level `import { detectMissingLimit }` and bare `it(...)` (no wrapping `describe`), append the four `it(...)` blocks at the end of the file instead.

- [ ] **Step 2: Run the test to verify it fails**

Run: `npx vitest run src/__tests__/renderer/lib/detectMissingLimit.test.ts`
Expected: FAIL — the MATCH / OPTIONAL MATCH cases return `false` (current code only recognizes SELECT/WITH).

- [ ] **Step 3: Implement the read-starter set**

In `src/renderer/src/lib/detectMissingLimit.ts`, replace line 14:

```ts
  if (!upper.startsWith('SELECT') && !upper.startsWith('WITH')) return false
```

with:

```ts
  // SQL read statements + Cypher read statements (identical LIMIT placement semantics).
  // Cypher write statements (CREATE/MERGE/DELETE/SET/REMOVE) are intentionally excluded.
  const READ_STARTERS = ['SELECT', 'WITH', 'MATCH', 'OPTIONAL MATCH', 'CALL', 'UNWIND', 'RETURN']
  if (!READ_STARTERS.some((kw) => upper.startsWith(kw))) return false
```

- [ ] **Step 4: Run the test to verify it passes**

Run: `npx vitest run src/__tests__/renderer/lib/detectMissingLimit.test.ts`
Expected: PASS (existing + 4 new tests).

- [ ] **Step 5: Commit**

```bash
git add src/renderer/src/lib/detectMissingLimit.ts src/__tests__/renderer/lib/detectMissingLimit.test.ts
git commit -m "✨ feat(neo4j): extend auto-limit guard to Cypher read statements"
```

---

## Task 23: Full suite + coverage verification

**Files:** none (verification only)

- [ ] **Step 1: Run typecheck**

Run: `npm run typecheck`
Expected: PASS (node + web), no errors.

- [ ] **Step 2: Run the full test suite with coverage**

Run: `npm run test:coverage`
Expected: ALL tests PASS; coverage gate (70% lines/functions/branches/statements over `src/main/db/**`, `src/main/ipc/**`, `src/renderer/src/store/**`) holds. `src/main/db/neo4j.ts` is the only new file in the coverage scope; its adapter tests should put it comfortably above 70%.

- [ ] **Step 3: If coverage on `neo4j.ts` is below threshold, add targeted tests**

If the report flags uncovered branches in `neo4j.ts`, add focused tests to `neo4j.test.ts` for the specific uncovered lines (e.g. the `listTables` empty-catalog path via `mockSession.run.mockResolvedValue(makeResult([], []))`, or the timeout branch using `vi.useFakeTimers()` + `vi.advanceTimersByTimeAsync(180_000)`), then re-run Step 2. Skip this step if the gate already passes.

- [ ] **Step 4: Commit (only if Step 3 added tests)**

```bash
git add src/__tests__/main/db/neo4j.test.ts
git commit -m "✅ test(neo4j): cover remaining adapter branches"
```

---

## Task 24: Documentation

**Files:**
- Modify: `README.md`, `CHANGELOG.md`, `CLAUDE.md`

- [ ] **Step 1: Update README**

Add Neo4j to the engine list in `README.md` wherever the supported engines / architecture are described (search for "Snowflake" and add a parallel "Neo4j (Cypher over Bolt)" mention). Add a short "Neo4j" subsection under the connection/auth documentation:

```markdown
### Neo4j

Connect with a Bolt URI, username, and password:

- **Connection URI** — `neo4j://localhost:7687` (or `neo4j+s://…` for encrypted Aura instances)
- **Username / Password** — basic auth
- **Database** — optional; defaults to `neo4j` (Neo4j 4.0+ multi-database)

Query with **Cypher**. The catalog browses each database's node **Labels** and
**Relationship Types**; the schema tab shows property keys **inferred from a
sample** (Neo4j is schema-optional, so it is not authoritative). Node /
Relationship / Path values render as compact Cypher-style chips in the results table.
```

- [ ] **Step 2: Update CHANGELOG**

Add an entry under the `Unreleased` section of `CHANGELOG.md` (create the section if absent, following the existing Keep a Changelog format):

```markdown
### Added
- **Neo4j support (Phase 1 — Foundation)**: Neo4j is now a first-class fourth engine. Connect over Bolt, browse databases → Labels / Relationship Types, write Cypher with syntax highlighting + schema-aware autocomplete, and view results with compact Cypher-style chips for Node/Relationship/Path values. Reuses the existing auto-limit guard, explain-plan viewer, export, history, ⌘K, split panes, and pagination/cancel infrastructure. New `cat-teal` per-engine accent.
```

- [ ] **Step 3: Add the CLAUDE.md change-log entry**

Add a dated entry at the top of the "Change Log & Error Report" entries in `CLAUDE.md`, following the established format:

```markdown
### [2026-06-08] Feature: Neo4j support — Phase 1 (Foundation: "Cypher-as-SQL")

**Type:** Change
**Context:** The app supported BigQuery, Postgres, and Snowflake — all SQL/relational. A user requested Neo4j (graph database, Cypher query language). Phase 1 of the approved two-phase design spec (`docs/superpowers/specs/2026-06-07-neo4j-support-design.md`) makes Neo4j a fully usable fourth engine; Phase 2 (graph visualization canvas) is deferred to its own plan.
**Problem / Change:** No `Neo4jConnection` type, no Bolt adapter, no Cypher editor support, no graph-native catalog shape, and no way to render Node/Relationship/Path result values.
**Solution / Outcome:**
- **`src/main/db/neo4j.ts`** (new): full `DbAdapter<Neo4jConnection>` over `neo4j-driver` (Bolt). `testConnection` (`verifyConnectivity`), `listDatasets` (`SHOW DATABASES`, de-duped, system hidden, fallback for single-db servers), `listTables` (`CALL db.labels()` + `db.relationshipTypes()` tagged `LABEL`/`RELATIONSHIP_TYPE` with per-item counts), `getTableSchema` (sample-inferred, first-observed-type-wins), `searchTables`, `runQuery` (Snowflake-style heartbeat/180s-timeout/cancel; full result retained for in-memory pagination since Cypher has no page-token), `getQueryPage` (offset slice), `cancelRunningQuery` (`session.close()`), `dryRunQuery` (`EXPLAIN` plan tree → JSON), `invalidateClient` (`driver.close()`). Driver class instances (Node/Relationship/Path/Integer/temporal) are serialized to plain `__neo4jType`-tagged objects at the IPC boundary via a `value.constructor !== Object` duck-typed catch-all.
- **No new IPC channels** — Neo4j reuses `CONNECTIONS_*`/`CATALOG_*`/`QUERY_*` once registered in `adapterRegistry.ts`.
- **Shared types**: `Neo4jConnection`, `Neo4jNode`/`Neo4jRelationship`/`Neo4jPath`/`Neo4jGraphValue`, `'neo4j'` engine, `LABEL`/`RELATIONSHIP_TYPE` table kinds.
- **Renderer**: fourth `ConnectionModal` tab (inline fields, not a separate component); `cat-teal` token + `TitleBar` accents; `CatalogTree` two-section grouping (Labels / Relationship Types) with `Circle`/`ArrowLeftRight` teal icons and Cypher "Query …" actions (`buildCypherQuery.ts`); `TableDetailPanel` sample-inferred caveat banner; Cypher CodeMirror `StreamLanguage` + schema-aware autocomplete (`cypherLanguage.ts`) wired into `QueryEditor`/`Editor`; compact graph-element chips (`formatGraphElement.ts` + `GraphElementChip.tsx`) in `ResultsTable`; `detectMissingLimit` extended with Cypher read-statement starters.
- **Tests**: `neo4j.test.ts` (adapter, driver fully mocked), `buildCypherQuery.test.ts`, `cypherLanguage.test.ts`, `formatGraphElement.test.ts`, extended `adapterRegistry.test.ts` + `detectMissingLimit.test.ts`. Coverage gate held.

**Files affected:**
- `package.json` — `neo4j-driver` + direct `@codemirror/autocomplete`/`@codemirror/language`
- `src/shared/types.ts` — Neo4j types + union/table-kind extensions
- `src/main/db/neo4j.ts` — created
- `src/main/db/adapterRegistry.ts` — register neo4j adapter
- `tailwind.config.ts`, `src/renderer/src/index.css` — `cat-teal`
- `src/renderer/src/components/connections/ConnectionModal.tsx` — Neo4j tab + fields
- `src/renderer/src/components/layout/TitleBar.tsx` — teal accent
- `src/renderer/src/components/catalog/CatalogTree.tsx` — Labels/Relationship Types sections
- `src/renderer/src/components/catalog/TableDetailPanel.tsx` — sample-inferred banner
- `src/renderer/src/lib/buildCypherQuery.ts`, `cypherLanguage.ts`, `formatGraphElement.ts` — created
- `src/renderer/src/components/editor/QueryEditor.tsx`, `src/renderer/src/pages/Editor.tsx` — Cypher language + autocomplete
- `src/renderer/src/components/results/GraphElementChip.tsx` — created
- `src/renderer/src/components/results/ResultsTable.tsx` — graph-element cell branch
- `src/renderer/src/lib/detectMissingLimit.ts` — Cypher read starters
- `src/__tests__/...` — neo4j/buildCypherQuery/cypherLanguage/formatGraphElement + extended adapterRegistry/detectMissingLimit
- `README.md`, `CHANGELOG.md` — docs
```

- [ ] **Step 2 check: Verify the build still compiles after docs (no code touched)**

Run: `npm run typecheck`
Expected: PASS.

- [ ] **Step 3: Commit**

```bash
git add README.md CHANGELOG.md CLAUDE.md
git commit -m "📝 docs(neo4j): document Phase 1 Neo4j support"
```

---

## Self-Review

**1. Spec coverage** (every Phase 1 item from the spec → task):
- `Neo4jConnection` type + unions → Task 2 ✓
- Adapter (`src/main/db/neo4j.ts`), all 10 methods → Tasks 4–11 ✓
- `neo4j-driver` dependency → Task 1 ✓
- Registry registration → Task 12 ✓
- ConnectionModal Neo4j tab/fields → Task 13 ✓
- `cat-teal` token + `TitleBar` accents → Tasks 3, 14 ✓
- Catalog: databases → Labels / Relationship Types (two sections), detail tabs, "Query …" actions, search → Tasks 5, 6, 8, 16; detail-tab caveat → Task 17 ✓
- Cypher syntax highlighting + schema-aware autocomplete → Tasks 18, 19 ✓
- Tabular results + compact-chip cell rendering for Node/Relationship/Path → Tasks 20, 21 ✓
- Auto-limit guard Cypher-awareness → Task 22 ✓
- Explain plan viewer → reuses unchanged `ExplainPanel`; adapter `dryRunQuery` returns the `{bytesProcessed, plan, planFormat}` contract (Task 11) ✓
- Export / history / saved queries / ⌘K / split panes → engine-agnostic, work once adapter is registered (Task 12); no code changes required, noted in Task 12 Step 4 ✓
- Tests per the spec's testing strategy → Tasks 4–12, 15, 18, 20, 22; `buildGraphFromRecords` / `GraphView` / graph-shaped detection are **Phase 2**, correctly excluded ✓
- Docs → Task 24 ✓

**2. Placeholder scan:** No "TBD"/"implement later"/"similar to Task N"/"add error handling" — every code step contains complete, paste-ready code and exact commands.

**3. Type consistency:** `Neo4jConnection` fields (`uri`/`username`/`password`/`database?`) are identical across types.ts (Task 2), the adapter (Tasks 4–11), ConnectionModal (Task 13), TitleBar (Task 14), and the registry test fixture (Task 12). `Neo4jNode`/`Neo4jRelationship`/`Neo4jPath` field names match between types.ts (Task 2), the adapter serializers (Task 9), and `formatGraphElement` (Task 20). `CypherSchema` shape (`labels`/`relationshipTypes`/`propertyKeys`) is identical between `cypherLanguage.ts` (Task 18), the `Editor.tsx` memo (Task 19), and the tests. Table kinds `'LABEL'`/`'RELATIONSHIP_TYPE'` are consistent across types.ts, the adapter, CatalogTree, and the `Editor.tsx` cypherSchema split. `buildLabelQuery`/`buildRelationshipTypeQuery`/`quoteCypherIdent` names match between definition (Task 15) and call sites (Task 16). `isGraphElement`/`formatGraphElement` names match between definition (Task 20) and use (Task 21).

---

## Execution Handoff

Plan complete and saved to `docs/superpowers/plans/2026-06-08-neo4j-phase1-foundation.md`. Two execution options:

**1. Subagent-Driven (recommended)** — I dispatch a fresh subagent per task, review between tasks, fast iteration.

**2. Inline Execution** — Execute tasks in this session using executing-plans, batch execution with checkpoints.

Which approach?
