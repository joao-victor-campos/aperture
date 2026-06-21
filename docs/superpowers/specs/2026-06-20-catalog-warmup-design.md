# Catalog warm-up: fix sidebar search misses + slow autocomplete

**Date:** 2026-06-20
**Status:** Approved (design)

## Problem

Two user-reported issues share one root cause.

1. **Sidebar "Search tables…" misses tables in bigger catalogs.** The search box in
   `CatalogTree` only filters datasets/tables that are *already loaded into memory*
   (`tablesByDataset`). A dataset is only loaded when the user expands it. So a table
   inside a collapsed dataset cannot match — it appears "missing." (The ⌘K command
   palette does not have this bug because it also runs a remote
   `CATALOG_SEARCH_TABLES` query.)

2. **Editor autocomplete takes too long to start working, even in small catalogs.**
   The schema-aware completion is fed from `sqlSchema`/`cypherSchema` in `Editor.tsx`,
   which derive from the same lazily-loaded caches. Table *names* only appear once their
   dataset has been expanded; *columns* only appear once a table is opened or the 250 ms
   `useSchemaPrefetch` background load round-trips. On a fresh query nothing useful is
   available until the user has browsed or waited.

**Root cause:** the catalog is loaded reactively, so both search and autocomplete only
"see" what the user has already clicked into.

## Goals

- Sidebar search finds any table in the active connection, regardless of whether its
  dataset has been expanded.
- Editor autocomplete offers **table names and their columns immediately** — before the
  user references the table in the query.
- Feasible cost: catalogs are dozens of datasets, so the catalog can be pre-warmed on
  connect without thousands of API calls.

## Non-goals

- No new behavior for hundreds-of-datasets / huge catalogs beyond what dozens-scale
  warm-up provides (no remote-search fallback in the sidebar).
- No change to the ⌘K command palette (already correct).
- No change to the full-fidelity Table Detail schema view.

## Approach

Pre-warm the active connection's catalog into the **existing** caches
(`tablesByDataset` + `schemaCache`) that the sidebar search and editor autocomplete
already read. The enabler is fetching columns cheaply: every relational engine returns
**all columns of every table in a dataset in a single `INFORMATION_SCHEMA.COLUMNS`
query**, so the whole catalog is dozens of queries, not thousands.

This was chosen over (A) pre-warming via per-table `getTableSchema` (thousands of calls,
columns load slowly) and (C) a names-eager / columns-on-demand hybrid (columns not
available before referencing a table — fails the autocomplete goal).

## Design

### 1. Data layer — bulk schema fetch

New method on the `DbAdapter` interface in `src/main/db/adapterRegistry.ts`:

```ts
getDatasetColumns(
  connection: TConnection,
  datasetId: string,
): Promise<Record<string /* tableId */, TableField[]>>
```

Returns column **names + coarse types** per table — sufficient for completion. The
existing per-table `getTableSchema` (nested RECORDs, modes, descriptions) is unchanged
and still backs the Table Detail panel.

Per-engine implementation (one query per dataset, grouped by `table_name`,
ordered by `ordinal_position`):

- **BigQuery** — `SELECT table_name, column_name, data_type
  FROM \`<project>.<dataset>.INFORMATION_SCHEMA.COLUMNS\` ORDER BY ordinal_position`.
  INFORMATION_SCHEMA metadata queries are free of charge.
- **Postgres** — `SELECT table_name, column_name, data_type FROM information_schema.columns
  WHERE table_schema = $1 ORDER BY ordinal_position` (`datasetId` = schema name).
- **Snowflake** — same shape against `<database>.INFORMATION_SCHEMA.COLUMNS
  WHERE table_schema = ?` (`datasetId` = `DATABASE.SCHEMA`). Column-name casing
  normalized via the existing `pick()` helper.
- **Neo4j** — no INFORMATION_SCHEMA; reuses the existing sample-inference path per
  label / relationship type. Graph catalogs are tiny (labels + rel types), so iterating
  them is acceptable.

Errors for a single dataset are surfaced to the caller as a rejection; the store layer
(below) swallows them per-dataset so one inaccessible dataset never blocks the rest.

New IPC channel `CATALOG_DATASET_COLUMNS` in `src/shared/ipc.ts`:
`{ connectionId: string; datasetId: string }` → `Record<string, TableField[]>`. Handler
in `src/main/ipc/catalog.ts` looks up the connection and dispatches via
`getAdapterForConnection`.

### 2. Store — catalog warm-up

In `catalogStore` (`src/renderer/src/store/catalogStore.ts`), a new action:

```ts
warmCatalog(connectionId: string, opts?: { force?: boolean }): Promise<void>
```

Behavior:

1. Ensure datasets are loaded (`loadDatasets`).
2. For every dataset, concurrency-capped at 5, skipping datasets already cached (unless
   `force`): run the existing `loadTables` (names + TABLE/VIEW types → `tablesByDataset`)
   **and** the new `CATALOG_DATASET_COLUMNS` fetch (→ `schemaCache`, using the same keys
   autocomplete already reads: `${connectionId}:${datasetId}:${tableId}`).
3. Per-dataset errors are caught and swallowed.
4. Guarded by per-connection `warming` / `warmed` flags (new fields, e.g.
   `warmState: Record<string, 'idle' | 'warming' | 'warmed'>`) so re-activating a
   previously warmed connection is free for the rest of the session. `force: true`
   resets the flag and re-fetches.

**Perf — batch store commits.** Warm-up writes the cache dozens of times. Each write to
`tablesByDataset`/`schemaCache` currently rebuilds `sqlSchema` and reconfigures
CodeMirror (the editor memoizes its extensions on `sqlSchema` identity). To avoid editor
churn while indexing, warm-up commits per dataset (one merged `set` per dataset covering
both its tables and its columns) rather than once per table. (A single terminal commit
is an alternative, but per-dataset commits give incremental autocomplete availability as
indexing progresses.)

### 3. Trigger + sidebar UX

- `warmCatalog(activeConnectionId)` fires when a connection becomes active — added to
  the existing effect in `CatalogTree` that already calls `loadDatasets`.
- The catalog **refresh button (🔄)** calls `warmCatalog(activeConnectionId, { force: true })`
  so a manual refresh re-fetches table lists *and* columns (today it only reloads
  datasets).
- The sidebar "Search tables…" filter needs **no logic change** — once the cache is warm
  its existing local filter finds tables in every dataset.
- While warm-up is in flight, show a subtle **"Indexing catalog…"** hint beneath the
  search box (driven by the connection's `warmState === 'warming'`) so a briefly-missing
  table is explained.

### 4. Autocomplete wiring

- `sqlSchema` / `cypherSchema` in `Editor.tsx` already derive from `tablesByDataset` +
  `schemaCache`; warm-up populates both, so table names appear on `FROM`/`JOIN` and their
  columns appear immediately — no referencing required.
- `useSchemaPrefetch` stays as the fallback for anything not yet warmed (e.g. mid-warm-up,
  or a dataset whose column fetch failed).

## Testing

- **Adapters** (coverage-gated): per-engine `getDatasetColumns` unit tests — multi-table
  grouping, type/casing mapping, ordering, and the empty/error cases. Covers
  `bigquery`, `postgres`, `snowflake`, `neo4j`.
- **IPC**: `CATALOG_DATASET_COLUMNS` handler — happy path + missing-connection error.
- **Store**: `catalogStore.warmCatalog` — populates both caches, respects concurrency,
  skips already-cached datasets, swallows per-dataset errors, `warmState` idempotence,
  and `force` re-fetch.
- Update `adapterRegistry.test.ts` mocks to include `getDatasetColumns`.
- `just ci` green, coverage ≥ 70%.

## Files affected (anticipated)

- `src/shared/ipc.ts` — `CATALOG_DATASET_COLUMNS` channel + IpcMap entry
- `src/main/db/adapterRegistry.ts` — `getDatasetColumns` on `DbAdapter`
- `src/main/db/{bigquery,postgres,snowflake,neo4j}.ts` — implement `getDatasetColumns`
- `src/main/ipc/catalog.ts` — `CATALOG_DATASET_COLUMNS` handler
- `src/renderer/src/store/catalogStore.ts` — `warmCatalog` + `warmState`
- `src/renderer/src/components/catalog/CatalogTree.tsx` — trigger warm-up, refresh →
  force, "Indexing catalog…" hint
- `src/__tests__/main/db/{bigquery,postgres,snowflake,neo4j}.test.ts` — `getDatasetColumns`
- `src/__tests__/main/ipc/catalog.test.ts` — `CATALOG_DATASET_COLUMNS`
- `src/__tests__/main/db/adapterRegistry.test.ts` — mock the new method
- `src/__tests__/renderer/store/catalogStore.test.ts` — `warmCatalog`
- `README.md`, `CHANGELOG.md`, `CLAUDE.md` — docs + change-log entry
