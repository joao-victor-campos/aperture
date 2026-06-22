# Shared Adapter Query-Runtime Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** De-duplicate the run/heartbeat/timeout/cancel lifecycle across the four DB adapters into one shared `src/main/db/queryRuntime.ts`, behavior-preserving.

**Architecture:** A new `queryRuntime.ts` owns `elapsed`, a logger factory, a shared `runningJobs` registry keyed by `tabId` with opaque cancel thunks, one `cancelRunningQuery`, a `runWithLifecycle` wrapper (heartbeat + 180s timeout race + idempotent cleanup), `runCapped`, and `groupColumnsByTable`. BigQuery/Snowflake/Neo4j route `runQuery` through `runWithLifecycle`; Postgres keeps its `SET statement_timeout` model but shares the smaller primitives. Engine-specific pagination/retention maps stay local.

**Tech Stack:** TypeScript (strict), Electron main process, Vitest. Engines: `@google-cloud/bigquery`, `pg`, `snowflake-sdk`, `neo4j-driver`.

**Spec:** [`docs/superpowers/specs/2026-06-21-adapter-query-runtime-design.md`](../specs/2026-06-21-adapter-query-runtime-design.md)

## Global Constraints

- TypeScript strict mode; prefer explicit types over `any` (per CLAUDE.md).
- All DB work stays in the main process; no IPC channel or `DbAdapter` interface signature changes.
- `queryRuntime.ts` is under `src/main/db/**` → **in the coverage include set** → must be unit-tested; the 70% lines/functions/branches/statements gate must hold.
- All tests must pass before merge: `just ci` green.
- Heartbeat string is exactly `Still running… ${elapsed(start)} elapsed` (note the `…` ellipsis char, not three dots).
- "Cancelled by user." log message text is exact.
- `QUERY_TIMEOUT_MS = 180_000`, `HEARTBEAT_INTERVAL_MS = 10_000`.
- Work on a feature branch; never commit to `master`. Update `CHANGELOG.md` (and `CLAUDE.md` change log) at the end.

## File Structure

- **Create** `src/main/db/queryRuntime.ts` — shared lifecycle primitives (one responsibility: query-execution lifecycle + concurrency + column grouping).
- **Create** `src/__tests__/main/db/queryRuntime.test.ts` — unit tests for the new module.
- **Modify** `src/main/db/neo4j.ts` — `runQuery` via `runWithLifecycle`; re-export shared `cancelRunningQuery`; drop local lifecycle.
- **Modify** `src/main/db/snowflake.ts` — same.
- **Modify** `src/main/db/bigquery.ts` — same; plus `searchTables` → `runCapped`; `getDatasetColumns` → `groupColumnsByTable`.
- **Modify** `src/main/db/postgres.ts` — share elapsed/logger/heartbeat/registry/cancel; keep `statement_timeout`; `getDatasetColumns` → `groupColumnsByTable`.
- **Modify** the four adapter test files as needed (postgres heartbeat-string assertion; cancel still reachable via shared registry).

---

### Task 1: Create `queryRuntime.ts` + unit tests

**Files:**
- Create: `src/main/db/queryRuntime.ts`
- Test: `src/__tests__/main/db/queryRuntime.test.ts`

**Interfaces:**
- Consumes: nothing (foundational).
- Produces:
  - `elapsed(startMs: number): string`
  - `makeLogger(webContents: WebContents, tabId: string): (msg: string) => void`
  - `startHeartbeat(log: (m: string) => void, start: number): () => void`
  - `runningJobs: Map<string, { cancel: () => Promise<void>; webContents: WebContents }>`
  - `cancelRunningQuery(tabId: string): Promise<void>`
  - `runWithLifecycle(opts: { tabId: string; webContents: WebContents; timeoutMessage: string; execute: (ctx: { log: (m: string) => void; registerCancel: (thunk: () => Promise<void>) => void }) => Promise<QueryResult> }): Promise<QueryResult>`
  - `runCapped<T>(items: T[], limit: number, fn: (item: T) => Promise<void>): Promise<void>`
  - `groupColumnsByTable(rows: Record<string, unknown>[], accessor: (row: Record<string, unknown>) => { tableId: string; field: TableField }): Record<string, TableField[]>`
  - `QUERY_TIMEOUT_MS`, `HEARTBEAT_INTERVAL_MS` constants

- [ ] **Step 1: Write the failing test**

Create `src/__tests__/main/db/queryRuntime.test.ts`:

```ts
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest'
import { CHANNELS } from '../../../shared/ipc'

vi.mock('electron', () => ({}))

import {
  elapsed, makeLogger, startHeartbeat, runningJobs, cancelRunningQuery,
  runWithLifecycle, runCapped, groupColumnsByTable,
  HEARTBEAT_INTERVAL_MS,
} from '../../../main/db/queryRuntime'
import type { QueryResult, TableField } from '../../../shared/types'

const makeWC = () => ({ send: vi.fn(), isDestroyed: vi.fn(() => false) })

beforeEach(() => {
  runningJobs.clear()
  vi.clearAllMocks()
})

describe('elapsed', () => {
  it('formats sub-minute as seconds', () => {
    const t = Date.now() - 5_000
    expect(elapsed(t)).toMatch(/^[45]s$/)
  })
  it('formats over a minute as "Xm Ys"', () => {
    const t = Date.now() - 65_000
    expect(elapsed(t)).toMatch(/^1m [45]s$/)
  })
})

describe('makeLogger', () => {
  it('sends QUERY_LOG when the webContents is alive', () => {
    const wc = makeWC()
    makeLogger(wc as never, 'tab1')('hello')
    expect(wc.send).toHaveBeenCalledWith(CHANNELS.QUERY_LOG, { tabId: 'tab1', message: 'hello' })
  })
  it('does not send when the webContents is destroyed', () => {
    const wc = { send: vi.fn(), isDestroyed: vi.fn(() => true) }
    makeLogger(wc as never, 'tab1')('hello')
    expect(wc.send).not.toHaveBeenCalled()
  })
})

describe('startHeartbeat', () => {
  it('logs on each interval until stopped', () => {
    vi.useFakeTimers()
    const log = vi.fn()
    const stop = startHeartbeat(log, Date.now())
    vi.advanceTimersByTime(HEARTBEAT_INTERVAL_MS * 2)
    expect(log).toHaveBeenCalledTimes(2)
    expect(log.mock.calls[0][0]).toMatch(/^Still running… .* elapsed$/)
    stop()
    vi.advanceTimersByTime(HEARTBEAT_INTERVAL_MS * 2)
    expect(log).toHaveBeenCalledTimes(2)
    vi.useRealTimers()
  })
})

describe('runCapped', () => {
  it('runs every item and never exceeds the concurrency cap', async () => {
    let active = 0
    let maxActive = 0
    const seen: number[] = []
    await runCapped([1, 2, 3, 4, 5, 6, 7], 2, async (n) => {
      active++; maxActive = Math.max(maxActive, active)
      await Promise.resolve()
      seen.push(n); active--
    })
    expect(seen.sort((a, b) => a - b)).toEqual([1, 2, 3, 4, 5, 6, 7])
    expect(maxActive).toBeLessThanOrEqual(2)
  })
  it('handles an empty list', async () => {
    const fn = vi.fn()
    await runCapped([], 5, fn)
    expect(fn).not.toHaveBeenCalled()
  })
})

describe('groupColumnsByTable', () => {
  it('groups fields by table id preserving order', () => {
    const rows = [
      { t: 'a', c: 'id' }, { t: 'a', c: 'name' }, { t: 'b', c: 'x' },
    ]
    const out = groupColumnsByTable(rows, (r) => ({
      tableId: r.t as string,
      field: { name: r.c as string, type: 'STRING', mode: 'NULLABLE' } as TableField,
    }))
    expect(Object.keys(out)).toEqual(['a', 'b'])
    expect(out.a.map((f) => f.name)).toEqual(['id', 'name'])
    expect(out.b.map((f) => f.name)).toEqual(['x'])
  })
  it('returns {} for empty input', () => {
    expect(groupColumnsByTable([], () => ({ tableId: 'x', field: {} as TableField }))).toEqual({})
  })
})

describe('runWithLifecycle', () => {
  const okResult: QueryResult = { columns: ['a'], rows: [{ a: 1 }], rowCount: 1, executionTimeMs: 0 }

  it('resolves with the execute result and cleans up the registry', async () => {
    const wc = makeWC()
    const result = await runWithLifecycle({
      tabId: 'ok', webContents: wc as never, timeoutMessage: 'timed out',
      execute: async ({ registerCancel }) => { registerCancel(async () => {}); return okResult },
    })
    expect(result).toEqual(okResult)
    expect(runningJobs.has('ok')).toBe(false)
  })

  it('propagates execute errors and cleans up', async () => {
    const wc = makeWC()
    await expect(runWithLifecycle({
      tabId: 'err', webContents: wc as never, timeoutMessage: 'timed out',
      execute: async () => { throw new Error('boom') },
    })).rejects.toThrow('boom')
    expect(runningJobs.has('err')).toBe(false)
  })

  it('on timeout invokes the registered cancel and rejects with timeoutMessage', async () => {
    vi.useFakeTimers()
    const wc = makeWC()
    const cancel = vi.fn(async () => {})
    const p = runWithLifecycle({
      tabId: 'to', webContents: wc as never, timeoutMessage: 'Query timed out after 180 seconds.',
      execute: async ({ registerCancel }) => {
        registerCancel(cancel)
        return new Promise<QueryResult>(() => {}) // never resolves
      },
    })
    const assertion = expect(p).rejects.toThrow('Query timed out after 180 seconds.')
    await vi.advanceTimersByTimeAsync(180_000)
    await assertion
    expect(cancel).toHaveBeenCalledTimes(1)
    expect(runningJobs.has('to')).toBe(false)
    vi.useRealTimers()
  })
})

describe('cancelRunningQuery', () => {
  it('is a no-op when no query is registered', async () => {
    await expect(cancelRunningQuery('absent')).resolves.toBeUndefined()
  })
  it('logs, invokes the cancel thunk, and deletes the entry', async () => {
    const wc = makeWC()
    const cancel = vi.fn(async () => {})
    runningJobs.set('live', { cancel, webContents: wc as never })
    await cancelRunningQuery('live')
    expect(wc.send).toHaveBeenCalledWith(CHANNELS.QUERY_LOG, { tabId: 'live', message: 'Cancelled by user.' })
    expect(cancel).toHaveBeenCalledTimes(1)
    expect(runningJobs.has('live')).toBe(false)
  })
})
```

- [ ] **Step 2: Run the test to verify it fails**

Run: `npx vitest run src/__tests__/main/db/queryRuntime.test.ts`
Expected: FAIL — `Cannot find module '../../../main/db/queryRuntime'`.

- [ ] **Step 3: Write the implementation**

Create `src/main/db/queryRuntime.ts`:

```ts
import type { WebContents } from 'electron'
import { CHANNELS } from '../../shared/ipc'
import type { QueryResult, TableField } from '../../shared/types'

export const QUERY_TIMEOUT_MS = 180_000
export const HEARTBEAT_INTERVAL_MS = 10_000

/** Single source of truth for the "Xm Ys" / "Ns" elapsed label. */
export function elapsed(startMs: number): string {
  const s = Math.round((Date.now() - startMs) / 1000)
  const m = Math.floor(s / 60)
  return m > 0 ? `${m}m ${s % 60}s` : `${s}s`
}

/** The isDestroyed()-guarded QUERY_LOG sender every adapter hand-rolls. */
export function makeLogger(webContents: WebContents, tabId: string): (msg: string) => void {
  return (message: string) => {
    if (!webContents.isDestroyed()) {
      webContents.send(CHANNELS.QUERY_LOG, { tabId, message })
    }
  }
}

/** Logs `Still running… Ns elapsed` every HEARTBEAT_INTERVAL_MS. Returns stop(). */
export function startHeartbeat(log: (m: string) => void, start: number): () => void {
  const timer = setInterval(() => log(`Still running… ${elapsed(start)} elapsed`), HEARTBEAT_INTERVAL_MS)
  return () => clearInterval(timer)
}

export interface RunningEntry {
  cancel: () => Promise<void>
  webContents: WebContents
}

/** Shared registry of in-flight queries, keyed by tabId (replaces 4 per-adapter maps). */
export const runningJobs = new Map<string, RunningEntry>()

/** Single cancel path for all engines. Adapters re-export this. */
export async function cancelRunningQuery(tabId: string): Promise<void> {
  const entry = runningJobs.get(tabId)
  if (!entry) return
  if (!entry.webContents.isDestroyed()) {
    entry.webContents.send(CHANNELS.QUERY_LOG, { tabId, message: 'Cancelled by user.' })
  }
  try {
    await entry.cancel()
  } catch {
    // ignore — query may have already completed
  }
  runningJobs.delete(tabId)
}

export interface LifecycleContext {
  log: (message: string) => void
  registerCancel: (thunk: () => Promise<void>) => void
}

/**
 * Full lifecycle wrapper for BigQuery / Snowflake / Neo4j.
 * Owns the heartbeat, 180s timeout race, idempotent cleanup, and registry
 * insert/delete. `execute` does the engine work and calls registerCancel(thunk)
 * the moment it holds its cancellable handle.
 */
export async function runWithLifecycle(opts: {
  tabId: string
  webContents: WebContents
  timeoutMessage: string
  execute: (ctx: LifecycleContext) => Promise<QueryResult>
}): Promise<QueryResult> {
  const { tabId, webContents, timeoutMessage, execute } = opts
  const start = Date.now()
  const log = makeLogger(webContents, tabId)

  let done = false
  const stopHeartbeat = startHeartbeat(log, start)
  let timeoutTimer: ReturnType<typeof setTimeout> | null = null

  const cleanup = () => {
    if (done) return
    done = true
    stopHeartbeat()
    if (timeoutTimer) clearTimeout(timeoutTimer)
    runningJobs.delete(tabId)
  }

  const registerCancel = (thunk: () => Promise<void>) => {
    runningJobs.set(tabId, { cancel: thunk, webContents })
  }

  const workPromise = execute({ log, registerCancel })
    .then((result) => {
      cleanup()
      return result
    })
    .catch((err: Error) => {
      cleanup()
      throw err
    })

  // Prevent an unhandled rejection on the losing branch of the race.
  workPromise.catch(() => {})

  const timeoutPromise = new Promise<never>((_, reject) => {
    timeoutTimer = setTimeout(async () => {
      log('Timeout reached (180s) · Cancelling…')
      const entry = runningJobs.get(tabId)
      if (entry) {
        try { await entry.cancel() } catch { /* ignore */ }
      }
      cleanup()
      reject(new Error(timeoutMessage))
    }, QUERY_TIMEOUT_MS)
  })

  return Promise.race([workPromise, timeoutPromise])
}

/** Main-process concurrency cap (twin of the renderer catalogStore helper). */
export async function runCapped<T>(
  items: T[],
  limit: number,
  fn: (item: T) => Promise<void>,
): Promise<void> {
  const queue = [...items]
  const workers = Array.from({ length: Math.min(limit, queue.length) }, async () => {
    while (queue.length) await fn(queue.shift()!)
  })
  await Promise.all(workers)
}

/** The identical getDatasetColumns accumulator (dialect reading stays in accessor). */
export function groupColumnsByTable(
  rows: Record<string, unknown>[],
  accessor: (row: Record<string, unknown>) => { tableId: string; field: TableField },
): Record<string, TableField[]> {
  const out: Record<string, TableField[]> = {}
  for (const row of rows) {
    const { tableId, field } = accessor(row)
    ;(out[tableId] ??= []).push(field)
  }
  return out
}
```

- [ ] **Step 4: Run the test to verify it passes**

Run: `npx vitest run src/__tests__/main/db/queryRuntime.test.ts`
Expected: PASS (all describe blocks green).

- [ ] **Step 5: Commit**

```bash
git add src/main/db/queryRuntime.ts src/__tests__/main/db/queryRuntime.test.ts
git commit -m "feat(db): shared query-runtime primitives (TD-1 core)"
```

---

### Task 2: Migrate Neo4j `runQuery` to `runWithLifecycle`

**Files:**
- Modify: `src/main/db/neo4j.ts` (the `runQuery`, `runningJobs`/`RunningJob`, `cancelRunningQuery`, `elapsed` regions)
- Test: `src/__tests__/main/db/neo4j.test.ts`

**Interfaces:**
- Consumes: `runWithLifecycle`, `cancelRunningQuery`, `elapsed` from `queryRuntime.ts`.
- Produces: unchanged `runQuery` / `cancelRunningQuery` signatures (adapter contract intact).

- [ ] **Step 1: Replace the `runQuery` body**

In `src/main/db/neo4j.ts`, replace the entire `runQuery` function (currently lines ~399–481) with:

```ts
export async function runQuery(
  connection: Neo4jConnection,
  cypher: string,
  tabId: string,
  webContents: WebContents,
): Promise<QueryResult> {
  const driver = getDriver(connection)
  const start = Date.now()

  return runWithLifecycle({
    tabId,
    webContents,
    timeoutMessage: 'Query timed out after 180 seconds. The session has been closed.',
    execute: async ({ log, registerCancel }) => {
      const session = driver.session({ database: databaseName(connection) })
      registerCancel(async () => { await session.close().catch(() => {}) })
      log('Submitting query to Neo4j…')

      try {
        const result = await session.run(cypher)
        const rawKeys = (result as { keys?: ReadonlyArray<PropertyKey> }).keys
          ?? result.records[0]?.keys
          ?? []
        const columns = (rawKeys as ReadonlyArray<PropertyKey>).map((k) => String(k))
        const allRows = result.records.map((r) => serializeRecord(r, columns))
        await session.close().catch(() => {})

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
      } catch (err) {
        await session.close().catch(() => {})
        throw err
      }
    },
  })
}
```

- [ ] **Step 2: Replace `cancelRunningQuery` and drop local lifecycle state**

In `src/main/db/neo4j.ts`:
1. Delete the local `RunningJob` interface and `const runningJobs = new Map<...>()` (lines ~308–312); **keep** `completedResults`.
2. Delete the local `function elapsed(...)` (lines ~43-47).
3. Replace the local `cancelRunningQuery` function (lines ~507–517) with a re-export. Near the top imports add:

```ts
import {
  runWithLifecycle, elapsed,
  cancelRunningQuery as _cancelRunningQuery,
} from './queryRuntime'
```

and where `cancelRunningQuery` was defined, put:

```ts
export const cancelRunningQuery = _cancelRunningQuery
```

4. Remove `elapsed`, `QUERY_TIMEOUT_MS`, `HEARTBEAT_INTERVAL_MS` from the `_internal` export object if present (they now live in `queryRuntime`); leave the rest of `_internal` intact. Remove the now-unused local `QUERY_TIMEOUT_MS` / `HEARTBEAT_INTERVAL_MS` consts if they are no longer referenced. (Neo4j does not use `runCapped`, so do not import it here — keeping the import would fail the unused-import typecheck.)

- [ ] **Step 3: Run the Neo4j tests**

Run: `npx vitest run src/__tests__/main/db/neo4j.test.ts`
Expected: PASS. The cancel test (`cancelRunningQuery closes the active session and logs`) still passes because Neo4j creates the session and calls `registerCancel` synchronously before its first `await`, so the shared registry is populated before `cancelRunningQuery('tab-cancel')` runs.

If the timeout test references the local `QUERY_TIMEOUT_MS`/`elapsed` via `_internal`, update it to import from `queryRuntime` or assert the message text directly.

- [ ] **Step 4: Typecheck**

Run: `npx tsc --noEmit -p tsconfig.node.json`
Expected: no errors (no unused imports, no missing references).

- [ ] **Step 5: Commit**

```bash
git add src/main/db/neo4j.ts src/__tests__/main/db/neo4j.test.ts
git commit -m "refactor(db): route Neo4j runQuery through shared runWithLifecycle"
```

---

### Task 3: Migrate Snowflake `runQuery` to `runWithLifecycle`

**Files:**
- Modify: `src/main/db/snowflake.ts`
- Test: `src/__tests__/main/db/snowflake.test.ts`

**Interfaces:**
- Consumes: `runWithLifecycle`, `cancelRunningQuery`, `elapsed` from `queryRuntime.ts`.
- Produces: unchanged `runQuery` / `cancelRunningQuery` signatures.

- [ ] **Step 1: Replace the `runQuery` body**

Replace the `runQuery` function (currently lines ~361–460) with:

```ts
export async function runQuery(
  connection: SnowflakeConnection,
  sql: string,
  tabId: string,
  webContents: WebContents
): Promise<QueryResult> {
  const sfConn = await getConnection(connection)
  const start = Date.now()

  return runWithLifecycle({
    tabId,
    webContents,
    timeoutMessage: 'Query timed out after 180 seconds. The statement has been cancelled.',
    execute: async ({ log, registerCancel }) => {
      log('Submitting query to Snowflake…')
      const { promise: stmtPromise, statement: earlyStmt } = executeStream(sfConn, sql)
      // Register immediately for early cancellation (before complete fires).
      registerCancel(() => new Promise<void>((res) => { earlyStmt.cancel(() => res()) }))

      const stmt = await stmtPromise
      const queryId = stmt.getQueryId()
      log(`Query complete · ${queryId} · Fetching first page…`)

      const totalRows = stmt.getNumRows()
      const pageEnd = Math.min(DEFAULT_PAGE_SIZE, totalRows)
      const rows = pageEnd > 0 ? await streamPage(stmt, 0, pageEnd - 1) : []

      const columns =
        rows.length > 0
          ? Object.keys(rows[0])
          : (stmt.getColumns() ?? []).map((c) => c.getName())

      const hasMore = totalRows > DEFAULT_PAGE_SIZE
      const totalLabel = ` (${totalRows.toLocaleString()} total)`
      log(`Fetched ${rows.length.toLocaleString()} rows${totalLabel} · ${elapsed(start)}`)

      completedStatements.set(tabId, stmt)

      return {
        columns,
        rows,
        rowCount: rows.length,
        executionTimeMs: Date.now() - start,
        totalRows,
        pageToken: hasMore ? String(DEFAULT_PAGE_SIZE) : null,
        hasMore
      } satisfies QueryResult
    }
  })
}
```

- [ ] **Step 2: Drop local lifecycle state and re-export cancel**

In `src/main/db/snowflake.ts`:
1. Delete the local `RunningJob` interface + `const runningJobs = new Map<...>()` (top of file, ~line 30). **Keep** `completedStatements`.
2. Delete the local `function elapsed(...)` (lines ~162–166).
3. Replace the local `cancelRunningQuery` (lines ~497–508) with a re-export. Add to imports:

```ts
import {
  runWithLifecycle, elapsed,
  cancelRunningQuery as _cancelRunningQuery,
} from './queryRuntime'
```

and:

```ts
export const cancelRunningQuery = _cancelRunningQuery
```

4. Delete the now-unused local `QUERY_TIMEOUT_MS` / `HEARTBEAT_INTERVAL_MS` consts.

- [ ] **Step 3: Run the Snowflake tests**

Run: `npx vitest run src/__tests__/main/db/snowflake.test.ts`
Expected: PASS. Snowflake obtains `earlyStmt` synchronously inside `execute` and calls `registerCancel` before awaiting `stmtPromise`, so the cancel test still reaches the registry. If a timeout test asserts on the old inline message, confirm it matches `…The statement has been cancelled.` (unchanged text).

- [ ] **Step 4: Typecheck**

Run: `npx tsc --noEmit -p tsconfig.node.json`
Expected: no errors.

- [ ] **Step 5: Commit**

```bash
git add src/main/db/snowflake.ts src/__tests__/main/db/snowflake.test.ts
git commit -m "refactor(db): route Snowflake runQuery through shared runWithLifecycle"
```

---

### Task 4: Migrate BigQuery `runQuery` to `runWithLifecycle`

**Files:**
- Modify: `src/main/db/bigquery.ts`
- Test: `src/__tests__/main/db/bigquery.test.ts`

**Interfaces:**
- Consumes: `runWithLifecycle`, `cancelRunningQuery`, `elapsed` from `queryRuntime.ts`.
- Produces: unchanged `runQuery` / `cancelRunningQuery` signatures.

- [ ] **Step 1: Replace the `runQuery` body**

Replace the `runQuery` function (currently lines ~180–275) with:

```ts
export async function runQuery(
  connection: BigQueryConnection,
  sql: string,
  tabId: string,
  webContents: WebContents
): Promise<QueryResult> {
  const client = getClient(connection)
  const start = Date.now()

  return runWithLifecycle({
    tabId,
    webContents,
    timeoutMessage: 'Query timed out after 180 seconds. The job has been cancelled.',
    execute: async ({ log, registerCancel }) => {
      log('Creating BigQuery job…')
      const [job] = await client.createQueryJob({ query: sql, useLegacySql: false })
      log(`Job created · ${job.id}`)
      log('Waiting for results…')
      registerCancel(async () => { await job.cancel() })

      const [rows, nextQuery, apiResponse] = await job.getQueryResults({
        autoPaginate: false,
        maxResults: DEFAULT_PAGE_SIZE,
      })

      const columns = rows.length > 0 ? Object.keys(rows[0] as object) : []
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      const statsBytes = (job.metadata as any)?.statistics?.query?.totalBytesProcessed
      const bytes = statsBytes != null ? Number(statsBytes) : undefined
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      const totalRowsStr = (apiResponse as any)?.totalRows
      const totalRows = totalRowsStr != null ? Number(totalRowsStr) : undefined
      const pageToken = nextQuery?.pageToken ?? null
      const byteLabel = bytes != null ? ` · ${formatBytes(bytes)} processed` : ''
      const totalLabel = totalRows != null ? ` (${totalRows.toLocaleString()} total)` : ''
      log(`Done · ${rows.length.toLocaleString()} rows fetched${totalLabel} · ${elapsed(start)}${byteLabel}`)

      completedJobs.set(tabId, job)

      return {
        columns,
        rows: rows as Record<string, unknown>[],
        rowCount: rows.length,
        executionTimeMs: Date.now() - start,
        bytesProcessed: bytes,
        totalRows,
        pageToken,
        hasMore: pageToken != null
      } satisfies QueryResult
    }
  })
}
```

- [ ] **Step 2: Drop local lifecycle state and re-export cancel**

In `src/main/db/bigquery.ts`:
1. Delete the local `RunningJob` interface + `const runningJobs = new Map<...>()` (lines ~13–17). **Keep** `const completedJobs = new Map<string, Job>()`.
2. Delete the local `function elapsed(...)` (lines ~35–39).
3. Replace the local `cancelRunningQuery` (lines ~307–320) with a re-export. Add to imports:

```ts
import {
  runWithLifecycle, elapsed,
  cancelRunningQuery as _cancelRunningQuery,
} from './queryRuntime'
```

and:

```ts
export const cancelRunningQuery = _cancelRunningQuery
```

4. Delete the now-unused local `QUERY_TIMEOUT_MS` / `HEARTBEAT_INTERVAL_MS` consts. (`runCapped` and `groupColumnsByTable` are added to this import in Task 6 when first used — do not import them yet, or the unused-import typecheck fails.)

- [ ] **Step 3: Run the BigQuery tests**

Run: `npx vitest run src/__tests__/main/db/bigquery.test.ts`
Expected: PASS. Note: BigQuery now starts the heartbeat *before* `createQueryJob` resolves (intentional per spec). If the existing timeout test (`vi.useFakeTimers()`) asserts a specific log-call ordering or count for heartbeats, relax it to assert the rejection message `…The job has been cancelled.` and that `job.cancel()` was called, rather than exact heartbeat counts. The cancel test continues to register after `createQueryJob` resolves — same timing as before.

- [ ] **Step 4: Typecheck**

Run: `npx tsc --noEmit -p tsconfig.node.json`
Expected: no errors.

- [ ] **Step 5: Commit**

```bash
git add src/main/db/bigquery.ts src/__tests__/main/db/bigquery.test.ts
git commit -m "refactor(db): route BigQuery runQuery through shared runWithLifecycle"
```

---

### Task 5: Migrate Postgres to shared primitives (keep `statement_timeout`)

**Files:**
- Modify: `src/main/db/postgres.ts`
- Test: `src/__tests__/main/db/postgres.test.ts`

**Interfaces:**
- Consumes: `elapsed`, `makeLogger`, `startHeartbeat`, `runningJobs`, `cancelRunningQuery` from `queryRuntime.ts`.
- Produces: unchanged `runQuery` / `cancelRunningQuery` signatures. Postgres does **not** use `runWithLifecycle`.

- [ ] **Step 1: Replace the `runQuery` body**

Replace the `runQuery` function (currently lines ~154–212) with:

```ts
export async function runQuery(
  connection: PostgresConnection,
  sql: string,
  tabId: string,
  webContents: WebContents
): Promise<QueryResult> {
  const pool = getPool(connection)
  const start = Date.now()
  const log = makeLogger(webContents, tabId)

  log('Connecting to Postgres...')
  const client = await pool.connect()

  let stopHeartbeat: (() => void) | null = null
  try {
    const pidRes = await client.query('SELECT pg_backend_pid()')
    const pid = pidRes.rows[0].pg_backend_pid
    // Register cancel via a separate pooled connection (pg_cancel_backend).
    runningJobs.set(tabId, {
      webContents,
      cancel: async () => { await pool.query('SELECT pg_cancel_backend($1)', [pid]) },
    })

    log(`Query started · PID: ${pid}`)
    stopHeartbeat = startHeartbeat(log, start)

    await client.query(`SET statement_timeout = ${QUERY_TIMEOUT_MS}`)
    const res = await client.query(sql)
    stopHeartbeat()

    const rows = res.rows
    const columns = rows.length > 0 ? Object.keys(rows[0]) : []
    cachedResults.set(tabId, rows)
    log(`Done · ${rows.length.toLocaleString()} rows fetched · ${elapsed(start)}`)

    return {
      columns,
      rows: rows.slice(0, DEFAULT_PAGE_SIZE),
      rowCount: rows.length,
      executionTimeMs: Date.now() - start,
      hasMore: rows.length > DEFAULT_PAGE_SIZE,
      pageToken: rows.length > DEFAULT_PAGE_SIZE ? '1' : null
    }
  } catch (err) {
    log(`Error: ${(err as Error).message}`)
    throw err
  } finally {
    if (stopHeartbeat) stopHeartbeat()
    runningJobs.delete(tabId)
    client.release()
  }
}
```

Note: `QUERY_TIMEOUT_MS` must now come from `queryRuntime` (see Step 2). The "Done" log changes from `${Date.now() - start}ms` to `${elapsed(start)}` — the intentional drift fix.

- [ ] **Step 2: Wire imports, drop local state, re-export cancel**

In `src/main/db/postgres.ts`:
1. Add imports:

```ts
import {
  elapsed, makeLogger, startHeartbeat, runningJobs,
  cancelRunningQuery as _cancelRunningQuery, QUERY_TIMEOUT_MS,
} from './queryRuntime'
```

2. Delete the local `QUERY_TIMEOUT_MS` / `HEARTBEAT_INTERVAL_MS` consts (lines ~6–7).
3. Delete the local `RunningQuery` interface + `const runningQueries = new Map<...>()` (lines ~12–19). **Keep** `cachedResults`. (The `{client, pid, connectionId}` data is now captured in the cancel thunk closure.)
4. Replace the local `cancelRunningQuery` (lines ~233–245) with:

```ts
export const cancelRunningQuery = _cancelRunningQuery
```

5. Delete the now-unused `logToWebContents` helper (lines ~267–271) if nothing else references it (the old `cancelRunningQuery` was its only caller).

- [ ] **Step 3: Update the Postgres tests**

Run: `npx vitest run src/__tests__/main/db/postgres.test.ts`
Expected: initially may FAIL on two assertions:
- Any assertion on the "Done" heartbeat/log text expecting `...ms` — update it to expect the `elapsed()` form (e.g. `expect(...).toContain('rows fetched ·')`, dropping the `ms`-specific check).
- The cancel test: ensure it calls `runQuery(...)` far enough that `runningJobs` is populated (the cancel thunk is registered after `SELECT pg_backend_pid()` resolves). If the existing test mocks `pg_backend_pid` to resolve synchronously and then calls `cancelRunningQuery`, confirm the mocked `pool.query('SELECT pg_cancel_backend...')` is still asserted — it is now invoked by the shared `cancelRunningQuery` via the thunk. Adjust the mock/assertion to expect `pg_cancel_backend` to be called and the `Cancelled by user.` QUERY_LOG to be sent by the shared path.

Apply the minimal assertion edits, then re-run until PASS.

- [ ] **Step 4: Typecheck**

Run: `npx tsc --noEmit -p tsconfig.node.json`
Expected: no errors (no unused `HEARTBEAT_INTERVAL_MS`, `logToWebContents`, or `RunningQuery`).

- [ ] **Step 5: Commit**

```bash
git add src/main/db/postgres.ts src/__tests__/main/db/postgres.test.ts
git commit -m "refactor(db): Postgres shares query-runtime primitives, fixes heartbeat drift"
```

---

### Task 6: TD-2 — `runCapped` in BigQuery search + `groupColumnsByTable` in three adapters

**Files:**
- Modify: `src/main/db/bigquery.ts` (`searchTables`, `getDatasetColumns`)
- Modify: `src/main/db/postgres.ts` (`getDatasetColumns`)
- Modify: `src/main/db/snowflake.ts` (`getDatasetColumns`)
- Test: existing `searchTables` / `getDatasetColumns` tests in the three adapter test files

**Interfaces:**
- Consumes: `runCapped`, `groupColumnsByTable` from `queryRuntime.ts`.
- Produces: unchanged `searchTables` / `getDatasetColumns` signatures + return shapes.

- [ ] **Step 1: BigQuery `searchTables` → `runCapped`**

Replace the manual batch loop (currently lines ~103–137) with:

```ts
  const CONCURRENCY = 5
  const hits: TableSearchHit[] = []

  await runCapped(datasetIds, CONCURRENCY, async (datasetId) => {
    if (hits.length >= limit) return
    try {
      const sql = `
        SELECT table_name, table_type
          FROM \`${connection.projectId}.${datasetId}.INFORMATION_SCHEMA.TABLES\`
         WHERE LOWER(table_name) LIKE LOWER(@pattern) ESCAPE '\\\\'
         LIMIT ${perDatasetLimit}
      `
      const [rows] = await client.query({ query: sql, params: { pattern } })
      for (const r of rows as Record<string, unknown>[]) {
        hits.push({
          datasetId,
          tableId: r.table_name as string,
          name: r.table_name as string,
          type:
            (r.table_type as string) === 'VIEW' ||
            (r.table_type as string) === 'MATERIALIZED VIEW'
              ? 'VIEW'
              : 'TABLE'
        } satisfies TableSearchHit)
      }
    } catch {
      // Skip datasets we can't query (permission errors, regional mismatches)
    }
  })

  return hits.slice(0, limit)
```

Add `runCapped` to the `queryRuntime` import in `bigquery.ts` (it was intentionally left out in Task 4). The `hits.length >= limit` early-return inside the worker preserves the old batch-level short-circuit closely enough; the final `slice(0, limit)` enforces the cap exactly.

- [ ] **Step 2: BigQuery `getDatasetColumns` → `groupColumnsByTable`**

Replace the accumulation loop (currently lines ~158–167) with:

```ts
  return groupColumnsByTable(rows as Record<string, unknown>[], (r) => ({
    tableId: r.table_name as string,
    field: { name: r.column_name as string, type: r.data_type as string, mode: 'NULLABLE' },
  }))
```

Add `groupColumnsByTable` to the `queryRuntime` import in `bigquery.ts`.

- [ ] **Step 3: Postgres `getDatasetColumns` → `groupColumnsByTable`**

Replace the accumulation loop (currently lines ~143–151) with:

```ts
  return groupColumnsByTable(res.rows, (c) => ({
    tableId: c.table_name as string,
    field: {
      name: c.column_name as string,
      type: c.data_type as string,
      mode: c.is_nullable === 'YES' ? 'NULLABLE' : 'REQUIRED',
    },
  }))
```

Add `groupColumnsByTable` to the `queryRuntime` import in `postgres.ts`.

- [ ] **Step 4: Snowflake `getDatasetColumns` → `groupColumnsByTable`**

Replace the accumulation loop (currently lines ~294–303) with:

```ts
  return groupColumnsByTable(rows, (r) => ({
    tableId: str(r, 'TABLE_NAME'),
    field: {
      name: str(r, 'COLUMN_NAME'),
      type: str(r, 'DATA_TYPE'),
      mode: str(r, 'IS_NULLABLE').toUpperCase() === 'YES' ? 'NULLABLE' : 'REQUIRED',
    },
  }))
```

Add `groupColumnsByTable` to the `queryRuntime` import in `snowflake.ts`.

- [ ] **Step 5: Run the three adapters' tests**

Run: `npx vitest run src/__tests__/main/db/bigquery.test.ts src/__tests__/main/db/postgres.test.ts src/__tests__/main/db/snowflake.test.ts`
Expected: PASS — `searchTables` (including the skip-dataset-on-error branch) and `getDatasetColumns` (happy path + empty dataset) return identical shapes to before.

- [ ] **Step 6: Typecheck + commit**

Run: `npx tsc --noEmit -p tsconfig.node.json`
Expected: no errors.

```bash
git add src/main/db/bigquery.ts src/main/db/postgres.ts src/main/db/snowflake.ts \
        src/__tests__/main/db/bigquery.test.ts src/__tests__/main/db/postgres.test.ts \
        src/__tests__/main/db/snowflake.test.ts
git commit -m "refactor(db): share runCapped + groupColumnsByTable across adapters (TD-2)"
```

---

### Task 7: Full CI, docs, change log

**Files:**
- Modify: `CHANGELOG.md`
- Modify: `CLAUDE.md` (Change Log & Error Report section)

- [ ] **Step 1: Run the full suite + coverage**

Run: `just ci`
Expected: typecheck clean; all tests pass; coverage ≥ 70% on lines/functions/branches/statements. `queryRuntime.ts` is covered by Task 1's tests.

If coverage on `queryRuntime.ts` dips below the gate, add the missing-branch test (e.g. `cancelRunningQuery` no-op branch, `runWithLifecycle` error branch) — both are already in Task 1; verify none were dropped.

- [ ] **Step 2: Update `CHANGELOG.md`**

Add under the Unreleased section:

```markdown
### Changed
- Internal: de-duplicated the DB adapter query lifecycle (heartbeat, 180s timeout,
  cancel, concurrency) into a shared `queryRuntime` module. No user-facing behavior
  change except a unified "still running" progress label across all engines.
```

- [ ] **Step 3: Append a CLAUDE.md change-log entry**

Add a `### [2026-06-21] Refactor: Shared adapter query-runtime (TD-1/TD-2)` entry following the existing format (Type / Context / Problem / Solution / Files affected), referencing the spec and plan and listing the created `queryRuntime.ts` + test and the four migrated adapters.

- [ ] **Step 4: Commit**

```bash
git add CHANGELOG.md CLAUDE.md
git commit -m "docs: changelog + change-log entry for shared query-runtime"
```

---

## Self-Review notes (for the implementer)

- **Spec coverage:** Task 1 = `queryRuntime.ts` (all helpers) + tests; Tasks 2–4 = `runWithLifecycle` adopters; Task 5 = Postgres shared-pieces exception; Task 6 = TD-2; Task 7 = CI/docs. Every spec section maps to a task.
- **Behavioral notes from the spec are honored:** BigQuery heartbeat-before-create (Task 4 Step 3), Postgres heartbeat-string fix (Task 5 Step 1).
- **Type consistency:** the registry entry shape `{ cancel: () => Promise<void>; webContents }`, `registerCancel(thunk)`, and `groupColumnsByTable(rows, accessor)` are used identically in Tasks 1–6.
- **Cancel-timing caveat:** Neo4j/Snowflake register cancel synchronously inside `execute` (registry ready before the first await); BigQuery/Postgres register after their first await — identical to current behavior, so existing cancel tests keep their timing assumptions.
```
