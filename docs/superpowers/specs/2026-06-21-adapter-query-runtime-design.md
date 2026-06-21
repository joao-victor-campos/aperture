# Shared Adapter Query-Runtime — Aperture

**Date:** 2026-06-21
**Type:** Refactor (de-duplication) — behavior-preserving
**Implements:** TD-1 + TD-2 from
[`2026-06-21-tech-debt-register-design.md`](./2026-06-21-tech-debt-register-design.md)
**Scope decision:** "Balanced" — shared lifecycle for BigQuery/Snowflake/Neo4j;
Postgres adopts the shared pieces but keeps its server-side `statement_timeout` model.

## Problem

The query-execution scaffolding is copy-pasted across the four DB adapters
(`src/main/db/{bigquery,snowflake,neo4j,postgres}.ts`):

- `elapsed(startMs)` is defined **identically** in three files
  (`bigquery.ts:35`, `snowflake.ts:162`, `neo4j.ts:43`).
- The `runningJobs` Map + heartbeat `setInterval` + 180s timeout + idempotent
  `cleanup()` + cancel/cleanup lifecycle is reimplemented in all four.
- Each adapter has its own `cancelRunningQuery(tabId)` doing the same three steps
  (log "Cancelled by user.", invoke the engine cancel, delete the map entry).
- BigQuery `searchTables` hand-rolls a batch-of-5 concurrency loop
  (`bigquery.ts:107`); the renderer already has a clean `runCapped`
  (`catalogStore.ts:27`) with no main-process equivalent.
- The `getDatasetColumns` row→`Record<string, TableField[]>` accumulator is
  identical across BigQuery/Postgres/Snowflake.

**Evidence of active rot:** the heartbeat log string has already drifted —
`postgres.ts:180` uses `Math.round((Date.now()-start)/1000)+"s"` while the other
three use `elapsed(start)`.

## Goals

- Single source of truth for the run/heartbeat/timeout/cancel lifecycle.
- No behavioral change visible to the renderer (same `QUERY_LOG` cadence, same
  query results, same cancel + pagination semantics), except the intentional notes
  listed below.
- `DbAdapter` interface signature unchanged; no IPC channel changes; renderer
  untouched.
- `just ci` green; coverage ≥ 70% on all gates.

## Non-goals

- Neo4j catalog methods (no INFORMATION_SCHEMA — sample-inference stays as is).
- Pagination / result-retention internals (`completedJobs`, `completedStatements`,
  `completedResults`, postgres `cachedResults`) — engine-specific, stay local.
- Converting Postgres off `SET statement_timeout` (that was the rejected "Maximal"
  option).
- The dialect-specific SQL in `searchTables` / `getDatasetColumns` — it is genuinely
  per-engine and stays in each adapter.

## Design

### New module: `src/main/db/queryRuntime.ts`

```ts
// Single source of truth for the "mm ss" elapsed label.
function elapsed(startMs: number): string

// The isDestroyed()-guarded QUERY_LOG sender every adapter hand-rolls.
function makeLogger(webContents: WebContents, tabId: string): (msg: string) => void

// setInterval logging `Still running… ${elapsed(start)} elapsed` every 10s.
// Returns a stop() that clears the interval. Used by runWithLifecycle AND by
// postgres (which keeps its own execution model but shares the heartbeat).
function startHeartbeat(log: (m: string) => void, start: number): () => void

// Shared registry of in-flight queries, keyed by tabId. Replaces the four
// per-adapter maps. The stored cancel is an opaque thunk so the registry is
// engine-agnostic (job.cancel / stmt.cancel / session.close / pg_cancel_backend).
interface RunningEntry { cancel: () => Promise<void>; webContents: WebContents }
const runningJobs: Map<string, RunningEntry>

// ONE implementation of the cancel path. Each adapter re-exports this so the
// DbAdapter interface is unchanged and the IPC dispatch keeps working.
async function cancelRunningQuery(tabId: string): Promise<void>
//   - if no entry: no-op
//   - else: send "Cancelled by user." log, await entry.cancel(), delete entry

// The full lifecycle wrapper for BigQuery / Snowflake / Neo4j.
async function runWithLifecycle(opts: {
  tabId: string
  webContents: WebContents
  timeoutMessage: string                // engine-specific timeout error text
  execute: (ctx: {
    log: (m: string) => void
    registerCancel: (thunk: () => Promise<void>) => void
  }) => Promise<QueryResult>
}): Promise<QueryResult>
//   - start = Date.now(); log = makeLogger(...)
//   - heartbeat = startHeartbeat(log, start)
//   - idempotent cleanup(): stop heartbeat, clear timeout, delete registry entry
//   - registerCancel(thunk): records {cancel: thunk, webContents} in runningJobs
//       so BOTH the timeout path and external cancelRunningQuery can reach it.
//   - runs execute({log, registerCancel}); on resolve/reject → cleanup()
//   - races against a 180s timeout that: logs timeout, invokes the registered
//     cancel (if any), cleanup(), rejects new Error(timeoutMessage)
//   - guards the work promise with `.catch(()=>{})` so the losing race branch
//     never surfaces an unhandled rejection (preserves current behavior)

// Main-process twin of the renderer concurrency cap.
async function runCapped<T>(items: T[], limit: number,
                            fn: (item: T) => Promise<void>): Promise<void>

// The identical getDatasetColumns accumulator. `accessor` maps a raw row to a
// {tableId, field} pair (dialect-specific reading stays in the caller).
function groupColumnsByTable(
  rows: Record<string, unknown>[],
  accessor: (row: Record<string, unknown>) => { tableId: string; field: TableField },
): Record<string, TableField[]>
```

Module-level constants `QUERY_TIMEOUT_MS = 180_000` and
`HEARTBEAT_INTERVAL_MS = 10_000` move here (they are currently duplicated in every
adapter).

### Per-adapter changes

**BigQuery / Snowflake / Neo4j** (`runWithLifecycle` adopters):

- `runQuery` body becomes `return runWithLifecycle({ tabId, webContents,
  timeoutMessage, execute })`, where `execute` performs the engine work
  (create job / execute statement / run session), calls `registerCancel(...)` the
  moment it has the handle, and returns the `QueryResult`.
- Delete the local `elapsed`, the local `runningJobs` map + `RunningJob` interface,
  and the local heartbeat/timeout/cleanup scaffolding.
- `cancelRunningQuery` becomes a re-export of the shared one
  (`export { cancelRunningQuery } from './queryRuntime'`).
- Cancel thunks: BigQuery `() => job.cancel().then(()=>{})`; Snowflake
  `() => new Promise(res => stmt.cancel(() => res()))`; Neo4j
  `() => session.close().catch(()=>{})`.
- Engine-specific pagination/retention maps stay local and unchanged.
- Timeout messages stay engine-specific, passed as `timeoutMessage`:
  BigQuery "…The job has been cancelled.", Snowflake "…The statement has been
  cancelled.", Neo4j "…The session has been closed."

**Postgres** (shared pieces, own execution model):

- Keeps `SET statement_timeout` + its own `await client.query(sql)` flow (no
  `runWithLifecycle`, no JS Promise.race).
- Uses shared `elapsed` + `makeLogger` + `startHeartbeat` — this fixes the drifted
  heartbeat string to match the other engines.
- Registers its cancel thunk into the shared registry:
  `() => pool.query('SELECT pg_cancel_backend($1)', [pid])`, and re-exports the
  shared `cancelRunningQuery`. The local `runningQueries` map is removed in favor of
  the shared registry (the `{client, pid, connectionId}` data the old map held is
  captured inside the cancel thunk closure instead).

### TD-2 (folded in, modest scope)

- BigQuery `searchTables`: replace the manual `for (i += CONCURRENCY)` batch loop
  with `runCapped(datasetIds, 5, …)` accumulating hits (respecting the existing
  early-exit at `hits.length >= limit` and final `slice(0, limit)`).
- BigQuery / Postgres / Snowflake `getDatasetColumns`: replace the inline
  `(out[t] ??= []).push(...)` accumulator with `groupColumnsByTable(rows, accessor)`;
  each adapter supplies its own `accessor` (dialect column-key casing + nullable→mode
  mapping stay in the accessor). The SQL query itself is unchanged.

## Intentional behavioral notes

1. **BigQuery heartbeat timing.** Today BigQuery starts its heartbeat *after*
   `createQueryJob` resolves; under `runWithLifecycle` the heartbeat starts before
   `execute` runs, so a slow job-create phase may emit one extra "Still running…"
   line. Harmless, arguably better feedback.
2. **Postgres heartbeat string.** Changes from `${seconds}s elapsed` to
   `${elapsed(start)} elapsed` (e.g. `1m 5s`), matching the other three engines.
   This is the drift fix, not a regression.

## Testing

`queryRuntime.ts` is under `src/main/db/**`, which is in the coverage include set, so
it requires its own unit tests:

- `elapsed` — sub-minute and over-minute formatting.
- `runCapped` — respects the cap, runs all items, surfaces/handles errors per current
  semantics.
- `groupColumnsByTable` — groups multiple tables, preserves column order, empty input.
- `runWithLifecycle` — happy path (resolves, heartbeat fired, registry cleaned up),
  timeout path (uses fake timers; cancel thunk invoked, rejects with `timeoutMessage`),
  external-cancel path (registered thunk invoked, "Cancelled by user." logged), and
  the no-unhandled-rejection guarantee on the losing race branch.
- `cancelRunningQuery` — no-op when absent; logs + invokes thunk + deletes when present.

The existing adapter suites (`bigquery.test.ts`, `snowflake.test.ts`,
`neo4j.test.ts`, `postgres.test.ts`) already exercise heartbeat/timeout/cancel and are
the regression net; they should stay green with minimal edits (e.g. the postgres
heartbeat-string assertion updates to the shared format). `adapterRegistry.test.ts`
mocks already include `cancelRunningQuery`; re-exporting it keeps those green.

**Acceptance:** `just ci` green; coverage ≥ 70% across all gates; no change to query
results, `QUERY_LOG` cadence (beyond the two notes above), cancel, timeout, or
pagination behavior in any engine.

## Suggested implementation order

1. Add `queryRuntime.ts` with helpers + its unit tests (no adapter wiring yet).
2. Migrate Neo4j `runQuery` to `runWithLifecycle` (simplest handle/cancel) — prove
   the wrapper end-to-end against its existing tests.
3. Migrate Snowflake, then BigQuery `runQuery`.
4. Migrate Postgres (shared elapsed/logger/heartbeat/registry/cancel; keep
   statement_timeout).
5. TD-2: BigQuery `searchTables` → `runCapped`; three `getDatasetColumns` →
   `groupColumnsByTable`.
6. Update affected adapter tests; run `just ci`.
