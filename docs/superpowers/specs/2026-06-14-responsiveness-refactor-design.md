# Aperture Responsiveness Refactor — Design Spec

**Date:** 2026-06-14
**Status:** Approved for planning

## Context

The app feels janky in interactive use — most acutely **while typing in the SQL/Cypher editor**. Investigation traced the felt lag to a single architectural cause rather than a stack-level problem, so this is a targeted renderer refactor, **not** a framework swap.

A scoping pass (Electron vs. Tauri, bundle size, memory, startup) confirmed the pain is **UI responsiveness only** — install size and memory are not the concern. A framework swap (Tauri) was explicitly rejected: it would be a multi-month rewrite of the Node-based DB SDKs and would not make a single table scroll smoother or a keystroke register faster.

**A separate, later effort** will cover an "Apple-like" native UI polish pass (vibrancy, SF Pro typography, spring/reduced-motion, macOS HIG spacing). That is out of scope here and gets its own brainstorm → spec.

## Root cause

`Editor.tsx` subscribes to the **entire** query store via a whole-store destructure (`const {...} = useQueryStore()`). Every keystroke calls `updateTabSql(activeTab.id, sql)`, which produces a new `tabs` array, which re-renders `Editor` and everything it renders inline — including the un-memoized `ResultsTable`. `ResultsTable` then re-runs `filterSortRows(rows, ...)` (computed unconditionally in the render body, `ResultsTable.tsx:204`) over the full result set and re-renders up to 500 rows × N columns of DOM.

Net: **every typed character pays for a full results-table repaint.** The same cascade is what makes the app stutter while a query streams `QUERY_LOG` heartbeats. Fixing the cascade addresses both complaints.

Confirmed in code:
- `src/renderer/src/pages/Editor.tsx` — whole-store destructure; `onChange={(sql) => updateTabSql(activeTab.id, sql)}`; `ResultsTable` rendered inline in the same component.
- `src/renderer/src/components/results/ResultsTable.tsx` — not wrapped in `React.memo`; `filterSortRows` + `pageRows` recomputed every render; no row virtualization.

## Goals

- Typing in the editor re-renders **only** the editor pane, never the results subtree.
- A large result set (≈500 rows × many columns) scrolls, sorts, filters, and resizes without stutter.
- No change to the Zustand store's public API or shape — the existing 336 tests stay green.
- No new heavyweight dependencies (one small headless virtualization lib only).

## Non-goals (out of scope for this iteration)

- "Apple-like" native UI polish — separate brainstorm/spec.
- Store slicing / moving per-tab editor state to component-local state (the deeper "Approach B"). Only revisit if profiling after this work still shows a hot spot.
- Framework / stack swap (Tauri, lighter renderer).
- Graph-view (force-graph) perf tuning and autocomplete-on-huge-schema latency — only if they surface as real pain later.
- Raising the default page size or other results-pagination changes.

## Architecture

Three coordinated layers. The first decouples the render paths; the second and third make the results table cheap to render once it does update.

### 1. Subscription narrowing + component split

Replace whole-store destructures with **selector subscriptions**. Zustand action references are stable across renders, so each action is selected individually (`useQueryStore((s) => s.updateTabSql)`); multi-field object slices use `useShallow` (from `zustand/react/shallow`, available in zustand v5) to avoid returning a fresh object identity every render.

Split the per-tab body of `Editor.tsx` into two `React.memo` children:

- **`EditorPane`** — wraps the existing `QueryEditor` + limit-warning banner. Subscribes to the active tab's `sql`, `isRunning`, `savedQueryId`, and `rightPane` only.
- **`ResultsRegion`** — the explain / graph / table swap (today's `renderResultsRegion` helper). Subscribes to the active tab's `result`, `error`, `isRunning`, `cancelled`, `logs`, `explainResult`, `isExplaining`, `viewAsGraph` only.

`Editor.tsx` keeps the tab bar (which legitimately needs the `tabs` list: `id`, `title`, `type`, `isRunning`, `savedQueryId`) and renders the two children, passing `activeTabId` plus stable action refs.

**Why this works even though `Editor` still re-renders:** on a keystroke, `tabs` changes so `Editor` re-renders its cheap tab bar — but `ResultsRegion` is memoized and the slice it selects (`result`, etc.) is unchanged, so it skips. `EditorPane`'s `sql` changed, so it re-renders, which is correct and cheap. The expensive subtree no longer participates in typing.

Split-pane note: the split layout's right pane (`rightPane`) keeps its current table-only behavior; `ResultsRegion` is used for the primary/left result area. The right pane's editor + results follow the same selector discipline but are not required to be separately memoized in v1 (split mode is the less common path; revisit only if it stutters).

### 2. ResultsTable memoization

- Wrap `ResultsTable` in `React.memo`.
- `useMemo` the `filterSortRows(rows, colFilters, sortCol, sortDir)` result, keyed on exactly those dependencies.
- `useMemo` `pageRows`, keyed on the memoized filtered rows + `page` + `pageSize`.
- Stabilize the callback props the parent passes (`onFetchPage`, `onPin`) via `useCallback` or selected stable action refs, so the `React.memo` comparison actually holds (inline arrows would defeat it).

### 3. Row virtualization

- Add `@tanstack/react-virtual` (headless, ~2 KB, no styling opinions).
- Virtualize the `<tbody>`: a scroll container drives `useVirtualizer({ count: pageRows.length, estimateSize: () => ROW_HEIGHT, getScrollElement, overscan })`, rendering only the visible rows plus a top and bottom spacer `<tr>` (or an equivalent translate offset) to preserve scroll height.
- Preserve: the sticky `<thead>`, the `colWidths` column-resize logic, per-cell rendering (including the Phase-2 `GraphElementChip` branch), and the filter/sort header controls.
- Row height is fixed (`ROW_HEIGHT`, ≈28px) — safe because cells are already single-line (`truncate`), so no dynamic measurement is needed.

### 4. Editor typing specifics

With the split in place no debounce is required: CodeMirror stays controlled (`value={sql}`), only `EditorPane` re-renders on input, and CodeMirror diffs its own document efficiently. The `languageExtension` memo in `QueryEditor` already has stable deps (`sqlSchema` / `cypherSchema` identities only change when the catalog changes, not per keystroke) and is left as-is.

**Contingency (not in base scope, measure first):** if profiling on a very large catalog still shows input latency, add an idle/`requestIdleCallback`-deferred store write so keystrokes update local editor state immediately and the store catches up off the critical path. Only add this if measured.

## Components / units

| Unit | Responsibility | Depends on |
|---|---|---|
| `EditorPane` (new) | Editor toolbar + CodeMirror + limit banner for the active tab | `sql`/`isRunning`/`savedQueryId`/`rightPane` slice; editor actions |
| `ResultsRegion` (new) | Explain / graph / table swap for the active tab | result-relevant slice; `fetchPage`/`openResultTab`/`toggleGraphView`/`clearExplain` |
| `ResultsTable` (modified) | Memoized, virtualized, memo-derived filter/sort/page | `result` + local filter/sort/page/colWidths state |
| `Editor.tsx` (modified) | Tab bar + layout; delegates panes to the two children | `tabs` meta + `activeTabId` + actions |
| `queryStore` | Unchanged public API | — |

## Error handling

No new failure modes. Virtualization must degrade gracefully for empty / single-row / all-filtered-out results (render the existing empty states, not a zero-height scroller). Selector refactors must preserve current behavior for the running/cancelled/error/explain/graph states — these are exercised by manual verification and the unchanged store tests.

## Testing strategy

- **Existing suite (336 tests) must stay green** — the store's public API and shape are unchanged, so store/adapter/IPC tests are unaffected.
- **New unit test:** a focused test that the memoized filter/sort/page derivation returns referentially stable output when inputs are unchanged and recomputes when a dependency changes. (Pure-ish; avoids brittle render-count assertions.)
- **No brittle RTL render-count tests.** Render-count behavior is validated manually via the React DevTools Profiler instead.
- **Coverage gate unaffected:** the coverage include set is `src/main/db/**`, `src/main/ipc/**`, `src/renderer/src/store/**`. The modified UI files are outside it; `queryStore` is touched only at the call-site/selector level with no API change.

## Verification (acceptance)

1. **Profiler:** with React DevTools "highlight updates" on, typing a character in the editor highlights only the editor pane — `ResultsTable` does **not** flash.
2. **Typing under load:** with a 500-row result displayed, typing in the editor has no perceptible stutter.
3. **Table interactions:** scrolling, sorting, filtering, and column-resizing the 500-row table are smooth; only visible rows are in the DOM (verify via element count in DevTools).
4. **Streaming:** while a query streams logs, the editor remains responsive and the results region updates without re-rendering the editor pane.
5. **Regression:** running, cancelling, exporting, explain panel, graph view, split panes, and saved-query flows all behave exactly as before; `npm run typecheck` and `npm run test:coverage` pass.

## Implementation order

1. Add `@tanstack/react-virtual`.
2. Memoize `ResultsTable` (filter/sort/page `useMemo`, `React.memo`, stable callbacks) — independently shippable, already reduces cost.
3. Virtualize `ResultsTable` rows.
4. Extract `EditorPane` + `ResultsRegion`, convert subscriptions to selectors/`useShallow`, thread stable action refs from `Editor.tsx`.
5. Profile against the acceptance checklist; only then consider the typing contingency.
