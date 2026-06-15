# Better SQL Autocomplete — Design Spec

**Date:** 2026-06-14
**Status:** Approved for planning

## Context

The SQL editor's autocomplete feels unhelpful in three ways: (1) it suggests table names but **not columns** for tables the user hasn't manually opened; (2) it has no awareness of **table aliases or CTEs** (`FROM users u` then `u.` yields nothing useful); and (3) suggestions don't reliably **pop automatically** and have felt laggy.

Investigation found the root cause of (1): the autocomplete `schema` passed to `@codemirror/lang-sql` is built in `Editor.tsx` (`sqlSchema` useMemo) from `catalogStore.schemaCache`, which only fills when the user opens a table's detail/preview tab (`loadSchema`). For every other table, `cols = []` — the table name completes but no columns. Completion itself is synchronous/in-memory, so there is no inherent per-keystroke latency; "delay" is mostly "columns never show up." The recent renderer responsiveness refactor (memoized CodeMirror extensions) already addresses most popup lag.

`@codemirror/lang-sql` is at 6.10.0 — modern enough to support schema-aware completion with built-in `FROM`-alias resolution, so the work is to *feed it the right data* and *layer CTE awareness + trigger tuning on top*, not to replace it.

## Goals

- Column suggestions appear for any table **referenced in the query**, without the user pre-opening it.
- `alias.` (real-table aliases) and `cte.` (CTE output columns) complete to the right columns.
- Suggestions auto-open as you type and on `.`, accept on Tab/Enter, dismiss on Esc — with no perceptible lag.
- Completion stays **local and instant** (no network/IPC round-trip on the completion path; prefetch happens ahead of time in the background).
- No change to the Zustand store's public API; existing tests stay green.

## Non-goals (out of scope this iteration)

- Cypher autocomplete changes (it already completes labels / relationship types / property keys; prefetch + trigger tuning there is a possible follow-on).
- Nested / correlated-subquery column scoping and JOIN-condition-only narrowing.
- Auto-loading table **lists** for datasets the user has never expanded (v1 resolves table references against already-loaded table lists only).
- A SQL language server or engine-side completion (rejected — adds latency, conflicts with "without delay").

## Architecture

Three pieces around the existing `@codemirror/lang-sql`, plus two pure parsers.

### 1. Background schema prefetch (makes columns appear)

A new hook `useSchemaPrefetch(sql, connectionId)` (called from `Editor.tsx` for the active tab):

- Debounces on `sql` change (250 ms).
- Calls the pure `extractTableRefs(sql)` to get referenced table identifiers.
- Builds a resolver map from already-loaded catalog data: for every table in `catalogStore.tablesByDataset[*]` belonging to `connectionId`, map both the bare name (`users`) and the qualified name (`dataset.users`), case-insensitive, to `{ projectId, datasetId, tableId }`.
- For each referenced name that resolves and whose schema is **not** already in `schemaCache`, calls `catalogStore.loadSchema(connectionId, projectId, datasetId, tableId)`. Concurrency-capped at 5; per-table errors swallowed (a missing/forbidden table must not break completion for the rest).
- Referenced names that don't resolve (dataset never expanded → its table list isn't loaded) are skipped gracefully.

Effect: as the user finishes typing a table name, its columns land in `schemaCache`, `sqlSchema` recomputes, and the next `alias.`/column completion is instant.

### 2. Alias + CTE-aware completion

A new `lib/sqlCompletion.ts` builds the editor's SQL language support:

- **Real-table aliases:** rely on lang-sql's built-in `FROM alias` / `FROM alias AS x` resolution, which now produces columns because §1 loaded them. If implementation reveals lang-sql's alias handling is insufficient for our dialects, add an explicit alias→table override map derived from `extractTableRefs` (which already captures aliases). This fallback is the contingency, not the default.
- **CTEs:** a pure `extractCteCompletions(sql)` parses `WITH name AS ( SELECT col1, expr AS col2, … )` into `[{ name, columns }]`:
  - splits the CTE's top-level select list on commas at parenthesis depth 0;
  - for each item, takes the explicit `AS alias` if present, else the trailing identifier (`t.col` → `col`);
  - `SELECT *` (or unparseable item) → that CTE contributes its name but no columns.
  Supports multiple comma-separated CTEs. A custom CodeMirror `CompletionSource` offers CTE names where a table is expected, and a CTE's columns when completing `cteName.`. It is combined with lang-sql's own source (both contribute; lang-sql handles real schema, the custom source handles CTEs).

### 3. Trigger & feel

- Add `autocompletion({ activateOnTyping: true, defaultKeymap: true, icons: true })` to the editor's extensions so suggestions open as you type and via lang-sql's `.` trigger; Tab/Enter accept, Esc dismisses (CodeMirror defaults).
- The extensions array is already memoized (responsiveness refactor) so the editor does not reconfigure per keystroke; the custom completion source is constructed once (stable identity); `sqlSchema` is memoized and only recomputes when the catalog cache changes. No completion work happens on the render path.

## Components / units

| Unit | Responsibility | Depends on |
|---|---|---|
| `lib/extractTableRefs.ts` (new, pure) | SQL → `{ name, alias? }[]` of referenced tables (FROM/JOIN/UPDATE/INTO), comments/strings stripped | — |
| `lib/extractCteCompletions.ts` (new, pure) | SQL → `{ name, columns: string[] }[]` for top-level CTEs | — |
| `lib/sqlCompletion.ts` (new) | Build lang-sql `LanguageSupport` config + combined CTE completion source | extractCteCompletions, @codemirror/lang-sql, @codemirror/autocomplete |
| `hooks/useSchemaPrefetch.ts` (new) | Debounced resolve-and-prefetch of referenced-table schemas | extractTableRefs, catalogStore |
| `components/editor/QueryEditor.tsx` (modify) | Wire combined completion + `autocompletion()` into the memoized extensions (SQL engines only; Cypher path unchanged) | sqlCompletion |
| `pages/Editor.tsx` (modify) | Call `useSchemaPrefetch(activeTab.sql, activeConnectionId)` | useSchemaPrefetch |

## Error handling

- Prefetch swallows per-table schema-load errors (logged at debug only) so one inaccessible table never blocks completion for others.
- Both parsers are tolerant: malformed/partial SQL (mid-typing) must never throw — they return best-effort partial results or empty arrays. The completion source returns `null`/empty on parse failure so lang-sql's own suggestions still show.
- Unresolved table references (unknown dataset) are silently skipped.

## Testing strategy

- **TDD pure-function tests** (the logic-heavy core):
  - `extractTableRefs`: bare table, qualified `dataset.table`, `project.dataset.table`, `FROM a JOIN b`, alias (`FROM users u`, `FROM users AS u`), multiple tables, ignores `LIMIT`/keywords, ignores table-like text inside strings and comments, partial/mid-typing SQL returns no throw.
  - `extractCteCompletions`: single CTE, multiple CTEs, `expr AS alias` items, `t.col` items, `SELECT *` (name only), nested parens in the CTE body don't break the split, non-CTE SQL returns `[]`.
- **Manual verification** (integration): type `SELECT * FROM <dataset>.<table>` without opening the table → columns autocomplete after a moment (prefetch); `FROM users u` then `u.` → users' columns; `WITH t AS (SELECT a, b FROM x) SELECT t.` → `a`, `b`; popup auto-opens while typing and on `.`; no perceptible lag; Esc dismisses, Tab/Enter accept.
- Existing suite stays green (no store API change). The new `lib/*` parsers get full unit tests for correctness, but — like the existing `detectMissingLimit` / `buildCypherQuery` utilities — they sit outside the coverage include set (`src/main/db/**`, `src/main/ipc/**`, `src/renderer/src/store/**`), so the 70% gate is unaffected either way.

## Verification (acceptance)

1. With a dataset expanded (so its table list is loaded) but its tables **not** opened, typing `SELECT  FROM <table>` then triggering completion in the SELECT list suggests that table's **columns**.
2. `FROM users u` … `u.` completes to `users`' columns.
3. `WITH cte AS (SELECT id, name FROM users) SELECT  FROM cte` → completing after `cte.` (or in the select list) offers `id`, `name`.
4. Completion popup appears automatically while typing an identifier and immediately after `.`; no visible lag on a large schema; Esc/Tab/Enter behave.
5. `npm run typecheck`, `npm run test:coverage`, and `npm run build` all pass; no regression to Cypher completion or to running/exporting queries.

## Implementation order

1. `extractTableRefs` (pure, TDD).
2. `extractCteCompletions` (pure, TDD).
3. `sqlCompletion.ts` — combined lang-sql config + CTE completion source.
4. `useSchemaPrefetch` hook.
5. Wire into `QueryEditor` (completion + `autocompletion()` config) and `Editor` (call the hook).
6. Manual verification against the acceptance checklist; docs.
