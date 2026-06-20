# Design: Multi-connection split view, result charts, and clipboard copy

**Date:** 2026-06-20
**Status:** Approved (pending implementation plan)

## Overview

Three related enhancements to the editor/results experience:

1. **Multi-connection split view** — replace the current intra-tab "second SQL pane" split with **editor groups**: up to two side-by-side groups, each with its own tab strip, where tabs can be dragged between groups and each tab carries (and can change) its own connection.
2. **Result charts** — a Chart view alongside the results Table, supporting bar/line/scatter with X/Y axis selection and optional aggregation.
3. **Copy results to clipboard** — a TSV copy button reflecting the current filtered/sorted view.

The split-view refactor is the heaviest, architecturally distinct piece and is independent of the two results-panel features; the implementation plan should sequence them separately (it could land as its own PR).

---

## Current state (what exists today)

- **Split** is *intra-tab*: a `QueryTab` may hold a `rightPane: QueryPane`, but both panes share the tab's single `connectionId`. Implemented via `toggleSplit` / `updateRightPaneSql` / `runRightPane` / `cancelRightPane` in `queryStore.ts`; `QUERY_LOG` push events route to the right pane via a `-right` tabId suffix.
- **Tab drag-drop** only *reorders* within the single tab bar (`reorderTabs`).
- **Connection** is per-tab (`tab.connectionId`), but driven by a single global `activeConnectionId` (connectionStore): an effect in `Editor.tsx` syncs the active tab to the global active connection.
- **Export** exists as **file** export (CSV/TSV/JSON via `EXPORT_RESULTS` IPC → save dialog). No clipboard copy.
- **Visualization**: none, except the Neo4j `GraphView` (toggled in `ResultsRegion` via `viewAsGraph`). Results are otherwise table-only.

---

## Feature 1: Editor groups (multi-connection split)

### Model

Replace the `rightPane` split with **editor groups**. Up to **2 groups** side-by-side (left/right). Each group is a layout container with its own tab strip, active tab, editor pane, and results region.

- `queryStore` gains:
  - `groups: { id: string; activeTabId: string | null }[]` — length 1 or 2.
  - `focusedGroupId: string` — which group currently has focus (drives the catalog sidebar + breadcrumb).
- Each `QueryTab` gains `groupId: string`.
- The flat `tabs[]` array stays; a group's tabs are `tabs.filter(t => t.groupId === group.id)` in array order. Reorder/move operations mutate `groupId` and array position.

### Connection model

- **Connection stays per-tab** (`tab.connectionId`) and becomes **user-changeable** via a connection picker in each tab's editor toolbar (`EditorPane`). Changing it sets `tab.connectionId`.
- A tab **carries its connection when dragged** between groups (the connection does not change on move; it remains independently changeable).
- New tabs default to the focused tab's connection.

### Decoupling the global active connection

Today an effect syncs the active tab to one global `activeConnectionId`. With two tabs on two connections visible at once, a single global active connection no longer makes sense.

- The **catalog sidebar and the TitleBar connection breadcrumb follow the focused group's active tab's connection.**
- Switching focus between groups re-points the sidebar/breadcrumb.
- The connectionStore's `activeConnectionId` is retained only as the **default connection for brand-new tabs** (and what the connection picker in the catalog/title bar sets). The `Editor.tsx` effect that synced the active tab to `activeConnectionId` is **removed**, so selecting a connection never silently swaps an existing tab's connection — that only happens via a tab's own connection picker.

### Interaction

- **Drag-drop:** dragging a tab onto the *other* group's tab strip moves it there (`moveTabToGroup(tabId, targetGroupId, index)`), keeping its connection. Within a strip, dragging reorders (existing behavior, generalized to be group-aware).
- **Split:** a Split button moves the active tab into a new second group (creating group 2 if absent).
- **Collapse:** closing/moving a group's last tab collapses back to a single group; `focusedGroupId` falls back to the remaining group.
- A horizontal divider between groups is resizable (reusing today's `splitHPct` drag logic).

### Removed

- `rightPane`, the `QueryPane` type, and `toggleSplit` / `updateRightPaneSql` / `runRightPane` / `cancelRightPane`.
- The `-right` `QUERY_LOG` suffix routing — every pane is now a normal tab, so logs route by plain `tabId`.

### Components affected

- `queryStore.ts` — groups, focus, move/split/collapse, per-tab connection setter; simplify `QUERY_LOG` listener.
- `Editor.tsx` — render N groups (1 or 2) each with its own tab strip + `EditorPane` + `ResultsRegion`; group-aware drag-drop; remove the connection-sync effect and the `rightPane` split branch.
- `EditorPane.tsx` — add a per-tab connection picker to the toolbar.
- `TitleBar.tsx` — breadcrumb follows focused tab's connection.
- `connectionStore.ts` — active-connection semantics reworked to "default for new tabs" / derived from focus.
- `ResultsRegion.tsx` — already keyed by `tabId`; unchanged in principle.

---

## Feature 2: Result charts

- A **Table / Chart** segmented toggle in the results region, following the `GraphView` toggle pattern in `ResultsRegion`.
- New `ChartView` component:
  - Chart type segmented control: **Bar / Line / Scatter**.
  - **X**, **Y**, and **Aggregate** dropdowns populated from `result.columns`.
  - Aggregate options: `none / SUM / AVG / COUNT / MIN / MAX`.
  - Aggregate ≠ none → rows grouped by X, Y aggregated per group. Aggregate = none → one mark per row (the natural scatter default).
- **Data source:** computed **client-side over the fetched `result.rows`** — no extra query. It reads all fetched rows, *not* the table's live filters (filter state is local to `ResultsTable`); unifying the two is out of scope for v1.
- **Pure helper** `aggregateForChart(rows, xCol, yCol, aggregate)` → chart-ready array; unit-tested (lives in `lib/`, outside the coverage include set like other parsers).
- **Per-tab persistence:** `QueryTab` gains `resultView?: 'table' | 'chart'` and `chartConfig?: { type: 'bar' | 'line' | 'scatter'; xCol: string; yCol: string; aggregate: 'none' | 'sum' | 'avg' | 'count' | 'min' | 'max' }`, mirroring how `viewAsGraph` persists.
- **Library:** add **Recharts** — idiomatic, declarative React charting covering all three types.

---

## Feature 3: Copy results to clipboard

- A **Copy** button beside the existing Export button in the `ResultsTable` status bar.
- **TSV only**, built from the **current filtered/sorted view** (`filteredRows`, already computed in `ResultsTable`) across all fetched rows — pastes cleanly into Google Sheets / Excel.
- **Pure helper** `rowsToTsv(rows, columns)`; uses `navigator.clipboard.writeText`, with a transient "Copied ✓" confirmation (same pattern as the column-name copy already in the table).

---

## Testing & docs

- **Coverage-gated** (`src/renderer/src/store/**`): `queryStore` reworked for groups — move tab between groups, focus switching, split/collapse, per-tab connection change. Existing split-pane (`rightPane`) tests removed/replaced.
- **Pure unit tests:** `aggregateForChart` (grouping + each aggregate + none/scatter path), `rowsToTsv` (escaping, column order, empty rows).
- `README.md` + `CHANGELOG.md` updated; CLAUDE.md change-log entry appended after implementation.

## Out of scope (v1)

- More than 2 editor groups.
- Multi-series charts (more than one Y) or a separate series/group-by column.
- Unifying the chart's data with the table's active filters/sort.
- Clipboard formats other than TSV (CSV/JSON/Markdown) — file export still covers CSV/TSV/JSON.
