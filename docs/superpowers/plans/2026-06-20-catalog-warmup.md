# Catalog Warm-up Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Pre-warm the active connection's catalog (table names + columns) into the existing renderer caches so the sidebar "Search tables…" finds tables in unexpanded datasets and the editor autocomplete offers tables and columns immediately.

**Architecture:** Add a bulk `getDatasetColumns` adapter method that fetches every column of every table in a dataset in a single `INFORMATION_SCHEMA.COLUMNS` query (Neo4j falls back to sample inference). A new `CATALOG_DATASET_COLUMNS` IPC channel exposes it. A new `warmCatalog` action in `catalogStore` walks all datasets on connect (concurrency-capped, cached per connection), populating the same `tablesByDataset` + `schemaCache` that search and autocomplete already read. `CatalogTree` triggers warm-up on connect, re-warms on refresh, and shows an "Indexing catalog…" hint while in flight.

**Tech Stack:** TypeScript (Electron main + React renderer), Zustand, Vitest. Engines: `@google-cloud/bigquery`, `pg`, `snowflake-sdk`, `neo4j-driver`.

## Global Constraints

- All DB work happens in the main process via typed IPC (`src/shared/ipc.ts`); the renderer never calls adapters directly.
- Every adapter implements `DbAdapter<TConnection>` and dispatch goes through `getAdapterForConnection(conn)`.
- TypeScript strict mode; prefer explicit types over `any`.
- All IPC/adapter/store logic must have unit tests before merging; `just ci` must pass with coverage ≥ 70% (lines/functions/branches/statements).
- Tailwind utility classes only; design tokens from `tailwind.config.ts` (`app-*` token classes); no hardcoded palette colors.
- Work on the current feature branch — never commit to `master`.
- Keep `README.md`, `CHANGELOG.md`, and the `CLAUDE.md` change log in sync.
- Commit messages end with: `Co-Authored-By: Claude Opus 4.8 <noreply@anthropic.com>`

---

### Task 1: BigQuery `getDatasetColumns`

**Files:**
- Modify: `src/main/db/bigquery.ts` (add exported function after `searchTables`, ~line 140)
- Test: `src/__tests__/main/db/bigquery.test.ts` (add to import list + new describe block)

**Interfaces:**
- Consumes: existing `getClient(connection)` and `mockClient.query` test mock.
- Produces: `getDatasetColumns(connection: BigQueryConnection, datasetId: string): Promise<Record<string, TableField[]>>` — keys are table ids, values are columns in ordinal order.

- [ ] **Step 1: Write the failing test**

Add `getDatasetColumns` to the destructured import from `'../../../main/db/bigquery'` at the bottom of the existing import block, then add this describe block:

```ts
describe('getDatasetColumns', () => {
  it('groups columns by table in ordinal order', async () => {
    mockClient.query.mockResolvedValueOnce([
      [
        { table_name: 'users', column_name: 'id', data_type: 'INT64' },
        { table_name: 'users', column_name: 'email', data_type: 'STRING' },
        { table_name: 'orders', column_name: 'id', data_type: 'INT64' },
      ],
    ])

    const result = await getDatasetColumns(conn as never, 'analytics')

    expect(result).toEqual({
      users: [
        { name: 'id', type: 'INT64', mode: 'NULLABLE' },
        { name: 'email', type: 'STRING', mode: 'NULLABLE' },
      ],
      orders: [{ name: 'id', type: 'INT64', mode: 'NULLABLE' }],
    })
    const sqlArg = (mockClient.query.mock.calls[0][0] as { query: string }).query
    expect(sqlArg).toContain('INFORMATION_SCHEMA.COLUMNS')
    expect(sqlArg).toContain('my-project.analytics')
  })

  it('returns an empty object when there are no columns', async () => {
    mockClient.query.mockResolvedValueOnce([[]])
    const result = await getDatasetColumns(conn as never, 'empty_ds')
    expect(result).toEqual({})
  })
})
```

- [ ] **Step 2: Run test to verify it fails**

Run: `npx vitest run src/__tests__/main/db/bigquery.test.ts -t getDatasetColumns`
Expected: FAIL — `getDatasetColumns is not a function` (import is `undefined`).

- [ ] **Step 3: Write minimal implementation**

In `src/main/db/bigquery.ts`, add after the `searchTables` function (before `getTableSchema`):

```ts
/**
 * Bulk column fetch for an entire dataset in a single INFORMATION_SCHEMA.COLUMNS
 * query. Returns coarse column name + type per table (enough for autocomplete);
 * the full-fidelity nested schema still comes from getTableSchema.
 */
export async function getDatasetColumns(
  connection: BigQueryConnection,
  datasetId: string
): Promise<Record<string, TableField[]>> {
  const client = getClient(connection)
  const query = `
    SELECT table_name, column_name, data_type
      FROM \`${connection.projectId}.${datasetId}.INFORMATION_SCHEMA.COLUMNS\`
     ORDER BY table_name, ordinal_position
  `
  const [rows] = await client.query({ query })
  const out: Record<string, TableField[]> = {}
  for (const r of rows as Record<string, unknown>[]) {
    const tableId = r.table_name as string
    ;(out[tableId] ??= []).push({
      name: r.column_name as string,
      type: r.data_type as string,
      mode: 'NULLABLE'
    })
  }
  return out
}
```

- [ ] **Step 4: Run test to verify it passes**

Run: `npx vitest run src/__tests__/main/db/bigquery.test.ts -t getDatasetColumns`
Expected: PASS (2 tests).

- [ ] **Step 5: Commit**

```bash
git add src/main/db/bigquery.ts src/__tests__/main/db/bigquery.test.ts
git commit -m "feat(catalog): bigquery getDatasetColumns bulk fetch

Co-Authored-By: Claude Opus 4.8 <noreply@anthropic.com>"
```

---

### Task 2: Postgres `getDatasetColumns`

**Files:**
- Modify: `src/main/db/postgres.ts` (add after `getTableSchema`, ~line 125)
- Test: `src/__tests__/main/db/postgres.test.ts`

**Interfaces:**
- Consumes: existing `getPool(connection)` and `mockPool.query` test mock.
- Produces: `getDatasetColumns(connection: PostgresConnection, datasetId: string): Promise<Record<string, TableField[]>>`.

- [ ] **Step 1: Write the failing test**

Add `getDatasetColumns` to the destructured import from `'../../../main/db/postgres'`, then:

```ts
describe('getDatasetColumns', () => {
  it('groups columns by table with nullability mapped to mode', async () => {
    mockPool.query.mockResolvedValueOnce({
      rows: [
        { table_name: 'users', column_name: 'id', data_type: 'integer', is_nullable: 'NO' },
        { table_name: 'users', column_name: 'email', data_type: 'text', is_nullable: 'YES' },
        { table_name: 'orders', column_name: 'total', data_type: 'numeric', is_nullable: 'YES' },
      ],
    })

    const result = await getDatasetColumns(conn, 'public')

    expect(result).toEqual({
      users: [
        { name: 'id', type: 'integer', mode: 'REQUIRED' },
        { name: 'email', type: 'text', mode: 'NULLABLE' },
      ],
      orders: [{ name: 'total', type: 'numeric', mode: 'NULLABLE' }],
    })
    expect(mockPool.query).toHaveBeenCalledWith(expect.stringContaining('information_schema.columns'), ['public'])
  })

  it('returns an empty object for a schema with no columns', async () => {
    mockPool.query.mockResolvedValueOnce({ rows: [] })
    expect(await getDatasetColumns(conn, 'empty')).toEqual({})
  })
})
```

- [ ] **Step 2: Run test to verify it fails**

Run: `npx vitest run src/__tests__/main/db/postgres.test.ts -t getDatasetColumns`
Expected: FAIL — `getDatasetColumns is not a function`.

- [ ] **Step 3: Write minimal implementation**

In `src/main/db/postgres.ts`, add after `getTableSchema`:

```ts
/**
 * Bulk column fetch for an entire schema in one information_schema.columns query.
 * Returns coarse column name + type per table for autocomplete.
 */
export async function getDatasetColumns(
  connection: PostgresConnection,
  datasetId: string
): Promise<Record<string, TableField[]>> {
  const pool = getPool(connection)
  const res = await pool.query(
    `SELECT table_name, column_name, data_type, is_nullable
       FROM information_schema.columns
      WHERE table_schema = $1
      ORDER BY table_name, ordinal_position`,
    [datasetId]
  )
  const out: Record<string, TableField[]> = {}
  for (const c of res.rows) {
    ;(out[c.table_name] ??= []).push({
      name: c.column_name,
      type: c.data_type,
      mode: c.is_nullable === 'YES' ? 'NULLABLE' : 'REQUIRED'
    })
  }
  return out
}
```

- [ ] **Step 4: Run test to verify it passes**

Run: `npx vitest run src/__tests__/main/db/postgres.test.ts -t getDatasetColumns`
Expected: PASS (2 tests).

- [ ] **Step 5: Commit**

```bash
git add src/main/db/postgres.ts src/__tests__/main/db/postgres.test.ts
git commit -m "feat(catalog): postgres getDatasetColumns bulk fetch

Co-Authored-By: Claude Opus 4.8 <noreply@anthropic.com>"
```

---

### Task 3: Snowflake `getDatasetColumns`

**Files:**
- Modify: `src/main/db/snowflake.ts` (add after `getTableSchema`, ~line 277)
- Test: `src/__tests__/main/db/snowflake.test.ts`

**Interfaces:**
- Consumes: existing module-local `getConnection`, `executeAll`, `str` helpers and the `mockExecuteAll(rows)` test helper.
- Produces: `getDatasetColumns(connection: SnowflakeConnection, datasetId: string): Promise<Record<string, TableField[]>>` where `datasetId` is `"DATABASE.SCHEMA"`.

- [ ] **Step 1: Write the failing test**

Add `getDatasetColumns` to the destructured import from `'../../../main/db/snowflake'`, then:

```ts
describe('getDatasetColumns', () => {
  it('groups columns by table, scoping the query to the database + schema', async () => {
    mockExecuteAll([
      { TABLE_NAME: 'USERS', COLUMN_NAME: 'ID', DATA_TYPE: 'NUMBER', IS_NULLABLE: 'NO' },
      { TABLE_NAME: 'USERS', COLUMN_NAME: 'EMAIL', DATA_TYPE: 'TEXT', IS_NULLABLE: 'YES' },
      { TABLE_NAME: 'ORDERS', COLUMN_NAME: 'TOTAL', DATA_TYPE: 'NUMBER', IS_NULLABLE: 'YES' },
    ])

    const result = await getDatasetColumns(conn, 'MYDB.PUBLIC')

    expect(result).toEqual({
      USERS: [
        { name: 'ID', type: 'NUMBER', mode: 'REQUIRED' },
        { name: 'EMAIL', type: 'TEXT', mode: 'NULLABLE' },
      ],
      ORDERS: [{ name: 'TOTAL', type: 'NUMBER', mode: 'NULLABLE' }],
    })
    const sql = mockSfConn.execute.mock.calls[0][0].sqlText as string
    expect(sql).toContain('MYDB.INFORMATION_SCHEMA.COLUMNS')
    expect(sql).toContain("TABLE_SCHEMA = 'PUBLIC'")
  })

  it('returns an empty object when there are no columns', async () => {
    mockExecuteAll([])
    expect(await getDatasetColumns(conn, 'MYDB.EMPTY')).toEqual({})
  })
})
```

Note: the existing `executeAll` passes its SQL as `{ sqlText }` to `mockSfConn.execute`. If the existing tests assert on a different property name, match that name instead.

- [ ] **Step 2: Run test to verify it fails**

Run: `npx vitest run src/__tests__/main/db/snowflake.test.ts -t getDatasetColumns`
Expected: FAIL — `getDatasetColumns is not a function`.

- [ ] **Step 3: Write minimal implementation**

In `src/main/db/snowflake.ts`, add after `getTableSchema`:

```ts
/**
 * Bulk column fetch for a whole schema via INFORMATION_SCHEMA.COLUMNS in one query.
 * @param datasetId — "DATABASE.SCHEMA"
 */
export async function getDatasetColumns(
  connection: SnowflakeConnection,
  datasetId: string
): Promise<Record<string, TableField[]>> {
  const sfConn = await getConnection(connection)
  const [dbName, schemaName] = datasetId.split('.')
  const sql = `SELECT TABLE_NAME, COLUMN_NAME, DATA_TYPE, IS_NULLABLE
                 FROM ${dbName}.INFORMATION_SCHEMA.COLUMNS
                WHERE TABLE_SCHEMA = '${schemaName.replace(/'/g, "''")}'
                ORDER BY TABLE_NAME, ORDINAL_POSITION`
  const rows = await executeAll(sfConn, sql)
  const out: Record<string, TableField[]> = {}
  for (const r of rows) {
    const tableName = str(r, 'TABLE_NAME')
    ;(out[tableName] ??= []).push({
      name: str(r, 'COLUMN_NAME'),
      type: str(r, 'DATA_TYPE'),
      mode: str(r, 'IS_NULLABLE').toUpperCase() === 'YES' ? 'NULLABLE' : 'REQUIRED'
    })
  }
  return out
}
```

- [ ] **Step 4: Run test to verify it passes**

Run: `npx vitest run src/__tests__/main/db/snowflake.test.ts -t getDatasetColumns`
Expected: PASS (2 tests).

- [ ] **Step 5: Commit**

```bash
git add src/main/db/snowflake.ts src/__tests__/main/db/snowflake.test.ts
git commit -m "feat(catalog): snowflake getDatasetColumns bulk fetch

Co-Authored-By: Claude Opus 4.8 <noreply@anthropic.com>"
```

---

### Task 4: Neo4j `getDatasetColumns`

**Files:**
- Modify: `src/main/db/neo4j.ts` (add after `getTableSchema`, ~line 248)
- Test: `src/__tests__/main/db/neo4j.test.ts`

**Interfaces:**
- Consumes: existing exported `listTables` and `getTableSchema` from the same module.
- Produces: `getDatasetColumns(connection: Neo4jConnection, datasetId: string): Promise<Record<string, TableField[]>>` — one entry per label / relationship type, sample-inferred.

- [ ] **Step 1: Write the failing test**

Add `getDatasetColumns` to the destructured import from `'../../../main/db/neo4j'`. Mirror the existing neo4j test's session-run mocking. Add:

```ts
describe('getDatasetColumns', () => {
  it('returns sample-inferred properties for every label and relationship type', async () => {
    // db.labels() → [Person], db.relationshipTypes() → [KNOWS] (listTables),
    // then countNodes/countRelationships, then per-table getTableSchema sampling.
    // Use the same mockSession.run sequencing the file's other tests use; assert
    // the shape rather than exact call order.
    const result = await getDatasetColumns(conn, 'neo4j')

    expect(Object.keys(result).sort()).toEqual(['KNOWS', 'Person'])
    expect(result.Person).toEqual(
      expect.arrayContaining([expect.objectContaining({ name: expect.any(String) })])
    )
  })
})
```

Note: build the `mockSession.run` queue exactly as the existing `listTables`/`getTableSchema` neo4j tests do (label list, rel-type list, counts, then sample records). Reuse the file's existing record/session mock helpers.

- [ ] **Step 2: Run test to verify it fails**

Run: `npx vitest run src/__tests__/main/db/neo4j.test.ts -t getDatasetColumns`
Expected: FAIL — `getDatasetColumns is not a function`.

- [ ] **Step 3: Write minimal implementation**

In `src/main/db/neo4j.ts`, add after `getTableSchema`:

```ts
/**
 * Bulk schema for a Neo4j database. Graph catalogs are small (labels +
 * relationship types), so this lists them and sample-infers each one's
 * properties. Per-table failures yield an empty column list rather than aborting.
 */
export async function getDatasetColumns(
  connection: Neo4jConnection,
  datasetId: string
): Promise<Record<string, TableField[]>> {
  const tables = await listTables(connection, datasetId)
  const out: Record<string, TableField[]> = {}
  for (const t of tables) {
    out[t.id] = await getTableSchema(connection, datasetId, t.id).catch(() => [])
  }
  return out
}
```

- [ ] **Step 4: Run test to verify it passes**

Run: `npx vitest run src/__tests__/main/db/neo4j.test.ts -t getDatasetColumns`
Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add src/main/db/neo4j.ts src/__tests__/main/db/neo4j.test.ts
git commit -m "feat(catalog): neo4j getDatasetColumns via sample inference

Co-Authored-By: Claude Opus 4.8 <noreply@anthropic.com>"
```

---

### Task 5: Wire interface, registry, and IPC channel

**Files:**
- Modify: `src/main/db/adapterRegistry.ts` (interface + 4 imports + 4 adapter objects)
- Modify: `src/shared/ipc.ts` (CHANNELS entry + IpcMap entry)
- Modify: `src/main/ipc/catalog.ts` (new handler)
- Test: `src/__tests__/main/ipc/catalog.test.ts` (handler tests)
- Test: `src/__tests__/main/db/adapterRegistry.test.ts` (mock the new method)

**Interfaces:**
- Consumes: `getDatasetColumns` exported from all four adapters (Tasks 1–4).
- Produces:
  - `DbAdapter.getDatasetColumns(connection, datasetId): Promise<Record<string, TableField[]>>`
  - `CHANNELS.CATALOG_DATASET_COLUMNS = 'catalog:dataset-columns'`
  - IpcMap: `{ req: { connectionId: string; datasetId: string }; res: Record<string, TableField[]> }`

- [ ] **Step 1: Write the failing handler test**

In `src/__tests__/main/ipc/catalog.test.ts`, add (matching the file's existing handler-test pattern, where `ipcMain.handle` is captured and `store.get('connections')` is stubbed):

```ts
describe('CATALOG_DATASET_COLUMNS', () => {
  it('dispatches to the adapter and returns the column map', async () => {
    const cols = { users: [{ name: 'id', type: 'INT64', mode: 'NULLABLE' }] }
    mockAdapter.getDatasetColumns.mockResolvedValueOnce(cols)

    const handler = getHandler(CHANNELS.CATALOG_DATASET_COLUMNS)
    const result = await handler({}, { connectionId: 'conn-1', datasetId: 'ds1' })

    expect(result).toEqual(cols)
    expect(mockAdapter.getDatasetColumns).toHaveBeenCalledWith(expect.anything(), 'ds1')
  })

  it('throws when the connection is missing', async () => {
    const handler = getHandler(CHANNELS.CATALOG_DATASET_COLUMNS)
    await expect(handler({}, { connectionId: 'nope', datasetId: 'ds1' })).rejects.toThrow(
      /Connection not found/
    )
  })
})
```

Add `getDatasetColumns: vi.fn()` to the `mockAdapter` object defined at the top of this test file. Use the file's existing `getHandler` helper (or the local equivalent that reads from the captured `ipcMain.handle` calls).

- [ ] **Step 2: Run test to verify it fails**

Run: `npx vitest run src/__tests__/main/ipc/catalog.test.ts -t CATALOG_DATASET_COLUMNS`
Expected: FAIL — channel/handler undefined.

- [ ] **Step 3: Implement the wiring**

In `src/shared/ipc.ts`, under the `// Catalog` group in `CHANNELS`:

```ts
  CATALOG_DATASET_COLUMNS: 'catalog:dataset-columns',
```

In the `IpcMap` interface, after the `CATALOG_SEARCH_TABLES` entry:

```ts
  [CHANNELS.CATALOG_DATASET_COLUMNS]: {
    req: { connectionId: string; datasetId: string }
    res: Record<string, TableField[]>
  }
```

In `src/main/db/adapterRegistry.ts`:
- Add `getDatasetColumns` to each adapter's import block, e.g. for BigQuery `getDatasetColumns as getBigQueryDatasetColumns,` (and the analogous `getPostgresDatasetColumns`, `getSnowflakeDatasetColumns`, `getNeo4jDatasetColumns`).
- Add to the `DbAdapter` interface after `getTableSchema`:

```ts
  /** Bulk column fetch for a whole dataset — powers catalog warm-up. */
  getDatasetColumns(connection: TConnection, datasetId: string): Promise<Record<string, TableField[]>>
```

- Add `getDatasetColumns: getBigQueryDatasetColumns,` (etc.) to each of the four adapter object literals.

In `src/main/ipc/catalog.ts`, add a handler mirroring `CATALOG_TABLES`:

```ts
  ipcMain.handle(
    CHANNELS.CATALOG_DATASET_COLUMNS,
    async (_event, req: { connectionId: string; datasetId: string }) => {
      const conn = store.get('connections').find((c) => c.id === req.connectionId)
      if (!conn) throw new Error(`Connection not found: ${req.connectionId}`)
      return getAdapterForConnection(conn).getDatasetColumns(conn, req.datasetId)
    }
  )
```

- [ ] **Step 4: Update the adapterRegistry test mock**

In `src/__tests__/main/db/adapterRegistry.test.ts`, add `getDatasetColumns: vi.fn(),` to each mocked adapter shape so the registry's structural typing/tests stay green.

- [ ] **Step 5: Run tests + typecheck**

Run: `npx vitest run src/__tests__/main/ipc/catalog.test.ts src/__tests__/main/db/adapterRegistry.test.ts && npm run typecheck`
Expected: PASS, and typecheck clean (every adapter object satisfies the extended interface).

- [ ] **Step 6: Commit**

```bash
git add src/shared/ipc.ts src/main/db/adapterRegistry.ts src/main/ipc/catalog.ts src/__tests__/main/ipc/catalog.test.ts src/__tests__/main/db/adapterRegistry.test.ts
git commit -m "feat(catalog): CATALOG_DATASET_COLUMNS channel + adapter method

Co-Authored-By: Claude Opus 4.8 <noreply@anthropic.com>"
```

---

### Task 6: `warmCatalog` store action

**Files:**
- Modify: `src/renderer/src/store/catalogStore.ts`
- Test: `src/__tests__/renderer/store/catalogStore.test.ts`

**Interfaces:**
- Consumes: `CHANNELS.CATALOG_DATASETS`, `CHANNELS.CATALOG_TABLES`, `CHANNELS.CATALOG_DATASET_COLUMNS` via `window.api.invoke` (stubbed in tests as `window.api.invoke`).
- Produces:
  - State: `warmState: Record<string, 'idle' | 'warming' | 'warmed'>`
  - Action: `warmCatalog(connectionId: string, opts?: { force?: boolean }): Promise<void>`
  - Populates `tablesByDataset[`${connectionId}:${datasetId}`]` and `schemaCache[`${connectionId}:${datasetId}:${tableId}`]`.

- [ ] **Step 1: Write the failing tests**

In `src/__tests__/renderer/store/catalogStore.test.ts` add:

```ts
describe('warmCatalog', () => {
  const ds1: Dataset = { id: 'ds1', projectId: 'proj', name: 'ds1' }
  const ds2: Dataset = { id: 'ds2', projectId: 'proj', name: 'ds2' }
  const t1: Table = { id: 't1', datasetId: 'ds1', projectId: 'proj', name: 't1', type: 'TABLE' }
  const cols1: Record<string, TableField[]> = { t1: [{ name: 'id', type: 'INT64', mode: 'NULLABLE' }] }

  // Route invoke by channel so concurrency/order doesn't matter
  function routeInvoke(map: {
    datasets: Dataset[]
    tables: Record<string, Table[]>
    columns: Record<string, Record<string, TableField[]>>
  }) {
    invoke().mockImplementation((channel: string, arg: unknown) => {
      if (channel === CHANNELS.CATALOG_DATASETS) return Promise.resolve(map.datasets)
      if (channel === CHANNELS.CATALOG_TABLES) {
        const { datasetId } = arg as { datasetId: string }
        return Promise.resolve(map.tables[datasetId] ?? [])
      }
      if (channel === CHANNELS.CATALOG_DATASET_COLUMNS) {
        const { datasetId } = arg as { datasetId: string }
        return Promise.resolve(map.columns[datasetId] ?? {})
      }
      return Promise.resolve(undefined)
    })
  }

  it('populates tablesByDataset and schemaCache for every dataset', async () => {
    routeInvoke({ datasets: [ds1], tables: { ds1: [t1] }, columns: { ds1: cols1 } })

    await useCatalogStore.getState().warmCatalog('conn-1')

    const s = useCatalogStore.getState()
    expect(s.tablesByDataset['conn-1:ds1']).toEqual([t1])
    expect(s.schemaCache['conn-1:ds1:t1']).toEqual(cols1.t1)
    expect(s.warmState['conn-1']).toBe('warmed')
  })

  it('skips re-warming an already-warmed connection unless forced', async () => {
    routeInvoke({ datasets: [ds1], tables: { ds1: [t1] }, columns: { ds1: cols1 } })
    await useCatalogStore.getState().warmCatalog('conn-1')
    invoke().mockClear()

    await useCatalogStore.getState().warmCatalog('conn-1')
    expect(invoke()).not.toHaveBeenCalled()

    await useCatalogStore.getState().warmCatalog('conn-1', { force: true })
    expect(invoke()).toHaveBeenCalledWith(CHANNELS.CATALOG_DATASETS, 'conn-1')
  })

  it('swallows per-dataset errors and still warms the rest', async () => {
    invoke().mockImplementation((channel: string, arg: unknown) => {
      if (channel === CHANNELS.CATALOG_DATASETS) return Promise.resolve([ds1, ds2])
      if (channel === CHANNELS.CATALOG_TABLES) {
        const { datasetId } = arg as { datasetId: string }
        if (datasetId === 'ds1') return Promise.reject(new Error('permission denied'))
        return Promise.resolve([{ ...t1, datasetId: 'ds2', id: 't2', name: 't2' }])
      }
      if (channel === CHANNELS.CATALOG_DATASET_COLUMNS) return Promise.resolve({})
      return Promise.resolve(undefined)
    })

    await expect(useCatalogStore.getState().warmCatalog('conn-1')).resolves.toBeUndefined()
    expect(useCatalogStore.getState().tablesByDataset['conn-1:ds2']).toBeDefined()
    expect(useCatalogStore.getState().warmState['conn-1']).toBe('warmed')
  })
})
```

- [ ] **Step 2: Run tests to verify they fail**

Run: `npx vitest run src/__tests__/renderer/store/catalogStore.test.ts -t warmCatalog`
Expected: FAIL — `warmCatalog is not a function`.

- [ ] **Step 3: Implement `warmCatalog`**

In `src/renderer/src/store/catalogStore.ts`:

Add to `CatalogState`:

```ts
  warmState: Record<string, 'idle' | 'warming' | 'warmed'>
  warmCatalog: (connectionId: string, opts?: { force?: boolean }) => Promise<void>
```

Add `warmState: {},` to the initial state (next to `isLoading: {}`).

Add a module-level concurrency helper above the `create(...)` call:

```ts
const WARM_CONCURRENCY = 5

async function runCapped<T>(items: T[], limit: number, fn: (item: T) => Promise<void>): Promise<void> {
  const queue = [...items]
  const workers = Array.from({ length: Math.min(limit, queue.length) }, async () => {
    while (queue.length) await fn(queue.shift()!)
  })
  await Promise.all(workers)
}
```

Add the action inside the store object:

```ts
  warmCatalog: async (connectionId, opts) => {
    const state = get()
    if (!opts?.force && state.warmState[connectionId] === 'warmed') return
    if (state.warmState[connectionId] === 'warming') return
    set((s) => ({ warmState: { ...s.warmState, [connectionId]: 'warming' } }))

    try {
      const datasets = await window.api.invoke(CHANNELS.CATALOG_DATASETS, connectionId)
      set((s) => ({ datasetsByConnection: { ...s.datasetsByConnection, [connectionId]: datasets } }))

      await runCapped(datasets, WARM_CONCURRENCY, async (ds) => {
        try {
          const [tables, columns] = await Promise.all([
            window.api.invoke(CHANNELS.CATALOG_TABLES, { connectionId, datasetId: ds.id }),
            window.api.invoke(CHANNELS.CATALOG_DATASET_COLUMNS, { connectionId, datasetId: ds.id })
          ])
          // One merged commit per dataset to limit editor reconfigure churn.
          set((s) => {
            const schemaPatch: Record<string, TableField[]> = {}
            for (const [tableId, fields] of Object.entries(columns)) {
              schemaPatch[`${connectionId}:${ds.id}:${tableId}`] = fields
            }
            return {
              tablesByDataset: { ...s.tablesByDataset, [`${connectionId}:${ds.id}`]: tables },
              schemaCache: { ...s.schemaCache, ...schemaPatch }
            }
          })
        } catch {
          // Skip datasets we can't read (permission/regional errors)
        }
      })
    } finally {
      set((s) => ({ warmState: { ...s.warmState, [connectionId]: 'warmed' } }))
    }
  },
```

- [ ] **Step 4: Run tests to verify they pass**

Run: `npx vitest run src/__tests__/renderer/store/catalogStore.test.ts -t warmCatalog`
Expected: PASS (3 tests).

- [ ] **Step 5: Commit**

```bash
git add src/renderer/src/store/catalogStore.ts src/__tests__/renderer/store/catalogStore.test.ts
git commit -m "feat(catalog): warmCatalog store action with per-connection caching

Co-Authored-By: Claude Opus 4.8 <noreply@anthropic.com>"
```

---

### Task 7: Trigger warm-up + "Indexing catalog…" hint in CatalogTree

**Files:**
- Modify: `src/renderer/src/components/catalog/CatalogTree.tsx`

**Interfaces:**
- Consumes: `warmCatalog`, `warmState` from `useCatalogStore` (Task 6).
- Produces: no new exports — UI behavior only. (This component is outside the coverage include set; verified via typecheck + manual run, consistent with other `components/**` changes.)

- [ ] **Step 1: Pull `warmCatalog` + `warmState` from the store**

In the `useCatalogStore(...)` destructure at the top of `CatalogTree`, add `warmCatalog` and `warmState`:

```ts
  const {
    datasetsByConnection,
    tablesByDataset,
    expandedDatasets,
    isLoading,
    loadDatasets,
    loadTables,
    toggleDataset,
    warmCatalog,
    warmState,
  } = useCatalogStore()
```

- [ ] **Step 2: Warm on connect (replace the existing load effect)**

Replace the existing effect:

```ts
  useEffect(() => {
    if (activeConnectionId) loadDatasets(activeConnectionId)
  }, [activeConnectionId, loadDatasets])
```

with:

```ts
  useEffect(() => {
    if (activeConnectionId) void warmCatalog(activeConnectionId)
  }, [activeConnectionId, warmCatalog])
```

(`warmCatalog` calls `loadDatasets` internally, so the tree still populates.)

- [ ] **Step 3: Make the refresh button force a re-warm**

Change the header refresh button's `onClick` from `() => loadDatasets(activeConnectionId)` to:

```tsx
            onClick={() => warmCatalog(activeConnectionId, { force: true })}
```

Keep `disabled={isLoadingDatasets}` as-is, and keep the existing spin animation binding.

- [ ] **Step 4: Add the "Indexing catalog…" hint under the search bar**

Directly below the search-bar `</div>` block (the wrapper that contains the search `<input>`), add:

```tsx
      {warmState[activeConnectionId] === 'warming' && (
        <div className="px-3 pb-1 text-[10px] text-app-text-3 animate-pulse">Indexing catalog…</div>
      )}
```

- [ ] **Step 5: Verify typecheck + build**

Run: `npm run typecheck`
Expected: clean.

- [ ] **Step 6: Manual smoke (if a connection is available)**

Run: `just dev`, switch to a connection with several datasets. Expected: "Indexing catalog…" appears briefly; then typing a table name from an *unexpanded* dataset in "Search tables…" surfaces it; typing `SELECT  FROM ` in the editor offers table names and, after a table, its columns immediately.

- [ ] **Step 7: Commit**

```bash
git add src/renderer/src/components/catalog/CatalogTree.tsx
git commit -m "feat(catalog): warm catalog on connect + indexing hint + force refresh

Co-Authored-By: Claude Opus 4.8 <noreply@anthropic.com>"
```

---

### Task 8: Full CI + docs

**Files:**
- Modify: `README.md`, `CHANGELOG.md`, `CLAUDE.md`

- [ ] **Step 1: Run the full suite**

Run: `just ci`
Expected: typecheck clean, all tests pass, coverage ≥ 70%. Fix any coverage gaps in `getDatasetColumns`/`warmCatalog` if flagged.

- [ ] **Step 2: Update README**

In the catalog/features section of `README.md`, note that the catalog is pre-indexed on connect so sidebar search spans all datasets and the editor autocomplete has tables + columns immediately (re-index via the catalog refresh button).

- [ ] **Step 3: Update CHANGELOG**

Add an `Unreleased` entry under the appropriate heading describing the catalog warm-up (sidebar search now finds tables in unexpanded datasets; autocomplete has tables + columns immediately; new `getDatasetColumns` bulk fetch + `CATALOG_DATASET_COLUMNS` channel).

- [ ] **Step 4: Append the CLAUDE.md change-log entry**

Add a `### [2026-06-20] Feature: Catalog warm-up` entry following the existing format (Type/Context/Problem/Solution/Files affected), referencing this plan and the spec at `docs/superpowers/specs/2026-06-20-catalog-warmup-design.md`.

- [ ] **Step 5: Commit**

```bash
git add README.md CHANGELOG.md CLAUDE.md
git commit -m "docs(catalog): document catalog warm-up

Co-Authored-By: Claude Opus 4.8 <noreply@anthropic.com>"
```

---

## Self-Review Notes

- **Spec coverage:** §1 data layer → Tasks 1–5; §2 store warm-up → Task 6; §3 trigger + sidebar hint → Task 7; §4 autocomplete wiring → no code change needed (existing `sqlSchema`/`cypherSchema` read the warmed caches; the perf "batch per dataset" requirement is satisfied by the single merged `set` per dataset in Task 6 Step 3); §5 testing → tests embedded per task + Task 8 CI.
- **Type consistency:** `getDatasetColumns(connection, datasetId) → Record<string, TableField[]>` is identical across the interface (Task 5), all four adapters (Tasks 1–4), the IPC map (Task 5), and the store consumer (Task 6). `warmCatalog(connectionId, opts?)` and `warmState` names match between Task 6 and Task 7.
- **No placeholders:** every code/test step contains concrete code; the only adapt-to-existing notes are the Neo4j session mock sequencing (Task 4 Step 1) and the Snowflake `execute` SQL property name (Task 3 Step 1), both of which point at the exact existing test helpers to copy.
