# Tech-Debt Register — Aperture

**Date:** 2026-06-21
**Type:** Audit / register (not a single feature spec)
**Status:** Approved structure; individual items to be designed + planned separately

## Purpose

After a dense run of feature work (theme import, Neo4j engine + graph viz, ⌘K palette,
AI chat companion, AI inline autocomplete, multi-connection split view + charts + clipboard,
catalog warm-up), this document inventories the accumulated tech debt: stale code,
duplication, oversized units, and runtime-performance concerns.

It is a **register**, not an implementation plan. Each item is sized so it can later be
taken through the normal brainstorming → spec → plan → implement cycle on its own. Nothing
here changes code; it is the map we work from.

## How items are ranked

Each item carries two estimates:

- **Payoff** — maintainability and/or runtime gain if fixed (Low / Med / High).
- **Risk·Effort** — likelihood of regression × amount of work (Low / Med / High).

Tier = roughly Payoff ÷ Risk·Effort. Tier 1 items are high-payoff and low-risk and should
be done first; Tier 3 items are worth doing but less urgent or higher-surface.

Evidence is cited as `file:line` so each item is independently actionable without re-deriving
the finding.

---

## Tier 1 — Do first (high payoff, low risk)

### TD-1 · Extract a shared adapter query-runtime

**What.** The query-execution scaffolding is copy-pasted across the four DB adapters:

- `elapsed(startMs)` is defined **identically** in three files —
  [`bigquery.ts:35`](../../../src/main/db/bigquery.ts),
  [`snowflake.ts:162`](../../../src/main/db/snowflake.ts),
  [`neo4j.ts:43`](../../../src/main/db/neo4j.ts).
- The `runningJobs` Map + heartbeat `setInterval` + 180s timeout + cancel/cleanup lifecycle
  is reimplemented in all four —
  [`bigquery.ts:201`](../../../src/main/db/bigquery.ts),
  [`snowflake.ts:379`](../../../src/main/db/snowflake.ts),
  [`neo4j.ts:417`](../../../src/main/db/neo4j.ts),
  [`postgres.ts:179`](../../../src/main/db/postgres.ts).
- Each adapter hand-rolls its own `Promise.all` fan-out; the renderer already has a clean
  `runCapped` concurrency helper ([`catalogStore.ts:27`](../../../src/renderer/src/store/catalogStore.ts))
  with no main-process equivalent.

**Evidence of rot.** The heartbeat log string has already drifted: `postgres.ts:180` uses
`Math.round((Date.now() - start)/1000)+"s"` while the other three use `elapsed(start)`.
Copy-paste is actively diverging.

**Proposed direction.** A `src/main/db/queryRuntime.ts` exposing: `elapsed()`, a
`registerRunningJob` / `clearRunningJob` lifecycle around a single shared `runningJobs` Map,
a `startHeartbeat(log, start)` helper, a `withTimeout(promise, ms, onTimeout)` wrapper, and a
main-process `runCapped`. Adapters keep their engine-specific execution but call the shared
lifecycle. Watch out for: each adapter's cancel mechanism differs (`job.cancel()` /
`stmt.cancel()` / `session.close()`) — the shared Map should store an opaque `cancel()` thunk
rather than the engine handle.

**Payoff:** High — removes ~4× duplication and prevents further drift.
**Risk·Effort:** Low — behavior-preserving; the existing adapter test suites
(`bigquery.test.ts`, `snowflake.test.ts`, `neo4j.test.ts`, `postgres.test.ts`) already cover
heartbeat/timeout/cancel paths and will catch regressions.

**Acceptance:** all adapter tests green; heartbeat string identical across engines; no
behavioral change to query execution, cancel, or pagination.

### TD-2 · Shared INFORMATION_SCHEMA / fan-out helpers

**What.** `searchTables` and `getDatasetColumns` repeat per-adapter INFORMATION_SCHEMA
querying and concurrency-capped fan-out across the three SQL engines. `INFORMATION_SCHEMA`
references: `postgres.ts` (9), `snowflake.ts` (6), `bigquery.ts` (5). The BigQuery variants
fan out one query per dataset with concurrency 5 and swallow per-dataset errors — a pattern
duplicated between `searchTables` and `getDatasetColumns`.

**Proposed direction.** Extract the shared fan-out + error-swallowing skeleton (depends on
TD-1's `runCapped`). Keep dialect-specific SQL in each adapter; share the orchestration.

**Payoff:** Med-High.
**Risk·Effort:** Low-Med — dialect differences (identifier quoting, scoping to
`database.schema`) must be preserved; Neo4j has no INFORMATION_SCHEMA and stays separate.

**Acceptance:** adapter tests green; search + dataset-columns behavior unchanged per engine.

---

## Tier 2 — High value, more surface

### TD-3 · Decompose `ResultsTable.tsx`

**What.** Largest file in the repo —
[`ResultsTable.tsx`](../../../src/renderer/src/components/results/ResultsTable.tsx) at 607 LOC
with ~27 top-level hooks/functions, 15 commits. It bundles row virtualization,
filter/sort UI + state, TSV clipboard copy, server-side pagination controls, and
graph-element cell rendering.

**Proposed direction.** Split behind the existing `React.memo` boundary into focused units
(e.g. `useFilterSort`, a virtualized `<TableBody>`, a `<ResultsStatusBar>` owning copy +
pagination). Pure logic (`filterSortRows`, `paginate`) already lives in `lib/` — keep it there.

**Payoff:** High — biggest, busiest file.
**Risk·Effort:** Med — UI regressions in virtualization/sticky-header/resize are easy to
introduce; requires manual verification in the running app, not just unit tests.

### TD-4 · Decompose `TitleBar.tsx`

**What.** Most-churned file in the repo —
[`TitleBar.tsx`](../../../src/renderer/src/components/layout/TitleBar.tsx), 310 LOC, **17 commits**.
It has accreted: connection breadcrumb + dropdown, edit/delete-confirm flow, health status
dots, per-engine accent coloring, theme/settings gear with update badge, AI sparkles toggle,
and the ⌘K command-palette slot.

**Proposed direction.** Extract `ConnectionBreadcrumb` + `ConnectionDropdown` (with the
edit/delete/health logic), a `StatusDot` module, and an action-button cluster. TitleBar
becomes a thin layout shell.

**Payoff:** High — churn magnet; every feature touches it.
**Risk·Effort:** Med — many small interactions (dropdown, confirm timers) to preserve.

---

## Tier 3 — Worth doing, lower urgency

### TD-5 · Bound / lazy catalog warm-up (performance)

**What.** [`warmCatalog`](../../../src/renderer/src/store/catalogStore.ts:91) eagerly fires
**two IPC calls per dataset** (`CATALOG_TABLES` + `CATALOG_DATASET_COLUMNS`) on every connect,
concurrency-capped at 5. On a large BigQuery project (hundreds of datasets) that is hundreds
of round-trips — each `getDatasetColumns` runs an `INFORMATION_SCHEMA.COLUMN_FIELD_PATHS`
query — for datasets the user may never open.

**Proposed direction.** Options to weigh during its own design: a hard cap on datasets warmed
eagerly; prioritize by recently-used / currently-expanded; or lazy warm-on-expand with a
background trickle. **Constraint:** sidebar search and editor autocomplete currently rely on
the fully-warmed `tablesByDataset` + `schemaCache`; any change must not silently shrink their
coverage (that coverage was the entire point of the 2026-06-20 warm-up feature).

**Payoff:** Med — real perf win on big projects.
**Risk·Effort:** Med — must not regress search/autocomplete completeness.

### TD-6 · Split `shared/types.ts`

**What.** [`shared/types.ts`](../../../src/shared/types.ts) — 42 exported interfaces/types in
one 376-LOC file, 16 commits. Mild god-file spanning connections, query, catalog, AI, and
graph domains.

**Proposed direction.** Group into `shared/types/` modules (connections, query, catalog, ai,
graph) re-exported from a barrel so import sites stay stable.

**Payoff:** Low-Med.
**Risk·Effort:** Low — mechanical, but touches many imports.

### TD-7 · Large modals — watch-list only

**What.** [`CommandPalette.tsx`](../../../src/renderer/src/components/command/CommandPalette.tsx)
(531), [`SettingsModal.tsx`](../../../src/renderer/src/components/settings/SettingsModal.tsx)
(526), [`ConnectionModal.tsx`](../../../src/renderer/src/components/connections/ConnectionModal.tsx)
(501). Long but cohesive — each is one coherent surface.

**Proposed direction.** No action now. Decompose only if they keep growing (e.g. SettingsModal
gaining a third/fourth section, ConnectionModal gaining a fifth engine).

**Payoff:** Low.
**Risk·Effort:** Med.

---

## Explicitly NOT debt (audited, ruled clean)

- **`queryStore` rewrite** — the split-pane → editor-groups rewrite left **no** dead remnants
  (no `rightPane` / `QueryPane` / `toggleSplit` references survive in the store).
- **`lib/` helpers** — every pure helper in `src/renderer/src/lib/` is referenced in production
  code, not just tests. No orphans.
- **`any` usage** — only 5 non-test occurrences, all intentional and `eslint-disable`-annotated
  (BigQuery dynamic metadata, force-graph canvas).
- **Console noise** — negligible (~9 occurrences, mostly legitimate error reporting).

The codebase is in genuinely good shape. This register is targeted cleanup, not a rescue.

---

## Suggested sequencing

1. **TD-1** (shared query-runtime) — unblocks TD-2's `runCapped` reuse and stops active drift.
2. **TD-2** (shared INFORMATION_SCHEMA fan-out) — builds on TD-1.
3. **TD-4** (TitleBar) and **TD-3** (ResultsTable) — independent UI decompositions; either order.
4. **TD-5** (warm-up perf) — schedule when large-project performance becomes a felt problem.
5. **TD-6 / TD-7** — opportunistic.

Each item should be taken through its own spec + plan before implementation.
