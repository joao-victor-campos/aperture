# Aperture Responsiveness Refactor Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Eliminate editor-typing lag and big-table jank by decoupling the editor render path from the results render path and making the results table cheap to render — without changing the Zustand store's public API.

**Architecture:** Three layers. (1) Memoize `ResultsTable` (`React.memo` + memoized filter/sort/page derivation, hoisted above early returns). (2) Virtualize result rows with `@tanstack/react-virtual`, preserving the sticky `<thead>`, `colgroup` widths, column-resize, and `GraphElementChip` cells via spacer-row virtualization. (3) Extract memoized `ResultsRegion` + `EditorPane` children that subscribe to narrow store slices via selectors/`useShallow`, so a keystroke re-renders only the editor and a log tick re-renders only the results region.

**Tech Stack:** React 18, Zustand v5 (`useShallow` from `zustand/react/shallow`), `@tanstack/react-virtual`, CodeMirror 6 (`@uiw/react-codemirror`), Vitest + jsdom.

---

## File Structure

| File | Responsibility | Change |
|---|---|---|
| `package.json` | deps | add `@tanstack/react-virtual` |
| `src/renderer/src/lib/paginate.ts` | pure page-slice helper (unit-tested) | create |
| `src/__tests__/renderer/lib/paginate.test.ts` | tests for `paginate` | create |
| `src/renderer/src/components/results/ResultsTable.tsx` | memoized + virtualized table | modify |
| `src/renderer/src/components/results/ResultsRegion.tsx` | memoized results swap (explain/graph/table), own slice | create |
| `src/renderer/src/components/editor/EditorPane.tsx` | memoized editor + limit banner, own `sql` slice | create |
| `src/renderer/src/components/editor/QueryEditor.tsx` | memoized extensions array + `React.memo` | modify |
| `src/renderer/src/pages/Editor.tsx` | selector subscriptions; delegate to `EditorPane`/`ResultsRegion` | modify |

**Mechanism recap (why this fixes the cascade):** `React.memo` only blocks *prop-driven* re-renders; a component that subscribes to the store via a selector still re-renders when *its own* selected slice changes. So `EditorPane` selects `sql` (re-renders on typing — correct) and `ResultsRegion` selects `result`/`logs` (does **not** re-render on typing). `Editor` keeps the tab bar and still re-renders on keystroke (the `tabs` array changes), but that subtree is cheap once the heavy children are isolated and memoized.

---

## Task 1: Branch + add `@tanstack/react-virtual`

**Files:**
- Modify: `package.json` (dependencies block)

- [ ] **Step 1: Create the branch off master**

Run:
```bash
git checkout master && git pull && git checkout -b feat/responsiveness
```
Expected: `Switched to a new branch 'feat/responsiveness'`

- [ ] **Step 2: Add the dependency**

Run:
```bash
npm install @tanstack/react-virtual@^3.10.8
```
Expected: completes; `@tanstack/react-virtual` added to `dependencies` in `package.json`.

- [ ] **Step 3: Verify it resolves**

Run: `npm ls @tanstack/react-virtual`
Expected: prints `@tanstack/react-virtual@3.10.x` with no "missing"/"invalid".

- [ ] **Step 4: Commit**

```bash
git add package.json package-lock.json
git commit -m "✨ perf: add @tanstack/react-virtual for results row virtualization"
```

---

## Task 2: Pure `paginate` helper (TDD)

**Files:**
- Create: `src/renderer/src/lib/paginate.ts`
- Test: `src/__tests__/renderer/lib/paginate.test.ts`

This is the unit-testable core of the results derivation. `filterSortRows` is already tested; `paginate` is the remaining pure piece used by the memoized derivation in Task 3.

- [ ] **Step 1: Write the failing test**

Create `src/__tests__/renderer/lib/paginate.test.ts`:

```ts
import { describe, it, expect } from 'vitest'
import { paginate } from '../../../renderer/src/lib/paginate'

const rows = Array.from({ length: 250 }, (_, i) => ({ id: i }))

describe('paginate', () => {
  it('returns the slice for the given page + size', () => {
    expect(paginate(rows, 0, 100).map((r) => r.id)[0]).toBe(0)
    expect(paginate(rows, 0, 100)).toHaveLength(100)
    expect(paginate(rows, 1, 100).map((r) => r.id)[0]).toBe(100)
    expect(paginate(rows, 2, 100)).toHaveLength(50)
  })

  it('returns an empty array for an out-of-range page', () => {
    expect(paginate(rows, 99, 100)).toEqual([])
  })

  it('handles an empty input', () => {
    expect(paginate([], 0, 100)).toEqual([])
  })

  it('returns the same array reference is NOT required, but content is a shallow copy slice', () => {
    const out = paginate(rows, 0, 2)
    expect(out).toEqual([{ id: 0 }, { id: 1 }])
  })
})
```

- [ ] **Step 2: Run the test to verify it fails**

Run: `npx vitest run src/__tests__/renderer/lib/paginate.test.ts`
Expected: FAIL — `Cannot find module '.../paginate'`.

- [ ] **Step 3: Implement**

Create `src/renderer/src/lib/paginate.ts`:

```ts
/**
 * Pure page-slice helper. Returns the rows for a zero-based page index at the
 * given page size. Out-of-range pages return an empty array.
 */
export function paginate<T>(rows: T[], page: number, pageSize: number): T[] {
  const start = page * pageSize
  return rows.slice(start, start + pageSize)
}
```

- [ ] **Step 4: Run the test to verify it passes**

Run: `npx vitest run src/__tests__/renderer/lib/paginate.test.ts`
Expected: PASS (4 tests).

- [ ] **Step 5: Commit**

```bash
git add src/renderer/src/lib/paginate.ts src/__tests__/renderer/lib/paginate.test.ts
git commit -m "✨ perf: pure paginate() helper for memoized results derivation"
```

---

## Task 3: Memoize + virtualize ResultsTable

**Files:**
- Modify: `src/renderer/src/components/results/ResultsTable.tsx`

This task has the most nuance: hooks must move above the early returns (rules of hooks), the filter/sort/page derivation becomes memoized, the row body becomes virtualized via spacer rows, and the component is wrapped in `React.memo`.

- [ ] **Step 1: Update imports**

In `src/renderer/src/components/results/ResultsTable.tsx`, replace the React import on line 1:

```ts
import { useEffect, useRef, useState } from 'react'
```

with:

```ts
import { memo, useEffect, useMemo, useRef, useState } from 'react'
import { useVirtualizer } from '@tanstack/react-virtual'
```

- [ ] **Step 2: Rename the function + add a row-height constant**

The component is currently `export default function ResultsTable({...})`. Change it to a named function (it will be wrapped with `memo` at the bottom in Step 7). Replace the declaration line:

```ts
export default function ResultsTable({
  result, error, isRunning, cancelled, logs = [], onFetchPage, onPin, pinned,
}: ResultsTableProps) {
```

with:

```ts
const ROW_HEIGHT = 29 // px — fixed; cells are single-line (truncate)
const EMPTY_ROWS: Record<string, unknown>[] = []

function ResultsTable({
  result, error, isRunning, cancelled, logs = [], onFetchPage, onPin, pinned,
}: ResultsTableProps) {
```

- [ ] **Step 3: Hoist the filter/sort/page derivation into memoized hooks above the early returns**

The derivation currently lives at lines ~200-208, *after* the `if (isRunning) … if (!result) …` early returns. Hooks cannot run conditionally, so move the heavy computation up.

Add these hooks immediately after the existing `useState`/`useRef`/`useEffect` declarations and **before** the `if (isRunning)` block (i.e. right after the `handleResizeMouseDown` function definition, before `if (isRunning) {`):

```ts
  // Derive filtered/sorted/paged rows once — memoized so typing/resizing the
  // parent does not recompute over the full result set.
  const allRows = result?.rows ?? EMPTY_ROWS
  const filteredRows = useMemo(
    () => filterSortRows(allRows, colFilters, sortCol, sortDir),
    [allRows, colFilters, sortCol, sortDir],
  )
  const pageRows = useMemo(
    () => paginate(filteredRows, page, pageSize),
    [filteredRows, page, pageSize],
  )
```

Add the `paginate` import near the `filterSortRows` import at the top:

```ts
import { filterSortRows } from '../../lib/filterSortRows'
import { paginate } from '../../lib/paginate'
```

- [ ] **Step 4: Remove the now-duplicated derivation in the render body**

Delete the old inline derivation lines (currently 202-208):

```ts
  // Apply client-side filter + sort before pagination
  const filteredRows = filterSortRows(rows, colFilters, sortCol, sortDir)
  const activeFilterCount = Object.values(colFilters).filter((v) => v.trim() !== '').length
  const totalPages = Math.max(1, Math.ceil(filteredRows.length / pageSize))
  const pageRows = filteredRows.slice(page * pageSize, (page + 1) * pageSize)
  const startRow = filteredRows.length === 0 ? 0 : page * pageSize + 1
  const endRow = Math.min((page + 1) * pageSize, filteredRows.length)
```

and replace with (drops the duplicate `filteredRows`/`pageRows`, keeps the rest):

```ts
  const activeFilterCount = Object.values(colFilters).filter((v) => v.trim() !== '').length
  const totalPages = Math.max(1, Math.ceil(filteredRows.length / pageSize))
  const startRow = filteredRows.length === 0 ? 0 : page * pageSize + 1
  const endRow = Math.min((page + 1) * pageSize, filteredRows.length)
```

> Note: the line just above (`const { columns, rows, … } = result`) still destructures `rows` from `result`; that's fine — `allRows` (used by the memo) equals `result.rows` here. Leave the destructure as-is; `rows` is still referenced by the export handler and status bar.

- [ ] **Step 5: Add a scroll-container ref + virtualizer (place beside the other hooks from Step 3)**

Immediately after the `pageRows` memo from Step 3, add:

```ts
  const scrollRef = useRef<HTMLDivElement>(null)
  const rowVirtualizer = useVirtualizer({
    count: pageRows.length,
    getScrollElement: () => scrollRef.current,
    estimateSize: () => ROW_HEIGHT,
    overscan: 12,
  })
```

- [ ] **Step 6: Virtualize the table body**

Replace the scroll container + `<tbody>` (currently lines ~352 `<div className="flex-1 overflow-auto selectable results-area">` through the close of `</tbody>`). The `<thead>` and `<colgroup>` stay unchanged; only the scroll `div` gets the ref and the `<tbody>` switches to spacer-row virtualization.

Change the scroll container opening tag:

```tsx
      <div className="flex-1 overflow-auto selectable results-area">
```

to:

```tsx
      <div ref={scrollRef} className="flex-1 overflow-auto selectable results-area">
```

Then replace the entire `<tbody>…</tbody>` block:

```tsx
          <tbody>
            {pageRows.map((row, i) => (
              <tr
                key={`${page}-${i}`}
                className={`hover:bg-app-elevated/40 transition-colors ${i % 2 === 0 ? '' : 'bg-app-surface/30'}`}
              >
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
              </tr>
            ))}
          </tbody>
```

with the virtualized version (a top spacer row of height = first virtual item's offset, the virtual rows, then a bottom spacer filling the remaining scroll height):

```tsx
          <tbody>
            {(() => {
              const virtualItems = rowVirtualizer.getVirtualItems()
              const totalSize = rowVirtualizer.getTotalSize()
              const paddingTop = virtualItems.length > 0 ? virtualItems[0].start : 0
              const paddingBottom =
                virtualItems.length > 0 ? totalSize - virtualItems[virtualItems.length - 1].end : 0
              return (
                <>
                  {paddingTop > 0 && (
                    <tr aria-hidden="true">
                      <td colSpan={columns.length} style={{ height: paddingTop, padding: 0, border: 0 }} />
                    </tr>
                  )}
                  {virtualItems.map((vi) => {
                    const row = pageRows[vi.index]
                    return (
                      <tr
                        key={`${page}-${vi.index}`}
                        style={{ height: ROW_HEIGHT }}
                        className={`hover:bg-app-elevated/40 transition-colors ${vi.index % 2 === 0 ? '' : 'bg-app-surface/30'}`}
                      >
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
                      </tr>
                    )
                  })}
                  {paddingBottom > 0 && (
                    <tr aria-hidden="true">
                      <td colSpan={columns.length} style={{ height: paddingBottom, padding: 0, border: 0 }} />
                    </tr>
                  )}
                </>
              )
            })()}
          </tbody>
```

- [ ] **Step 7: Wrap the component in `React.memo` at the bottom of the file**

At the very end of the file, after the `function ResultsTable(...) { … }` body and the helper functions (`formatCell`, `formatBytes`), add a default export. Find the end of the `ResultsTable` function (the closing `}` of the component, before `// ── Cell formatter ──`) — the component currently ends with `)` then `}`. Immediately after the component function's closing brace, add:

```ts
export default memo(ResultsTable)
```

And confirm the old `export default function ResultsTable` was already changed to `function ResultsTable` in Step 2 (no other `export default` for it should remain).

- [ ] **Step 8: Typecheck + run the existing results-related tests**

Run: `npm run typecheck:web`
Expected: PASS (no errors).

Run: `npx vitest run src/__tests__/renderer/lib/paginate.test.ts src/__tests__/renderer/lib/filterSortRows.test.ts`
Expected: PASS.

- [ ] **Step 9: Manual smoke (build sanity)**

Run: `npm run build`
Expected: completes without error (confirms the virtualizer import + JSX compile in the production build).

- [ ] **Step 10: Commit**

```bash
git add src/renderer/src/components/results/ResultsTable.tsx
git commit -m "⚡️ perf: memoize + virtualize ResultsTable rows

React.memo + memoized filterSortRows/paginate derivation (hoisted above
early returns), and @tanstack/react-virtual spacer-row virtualization of
the tbody. Sticky thead, colgroup widths, column-resize, and
GraphElementChip cells preserved."
```

---

## Task 4: Extract memoized `ResultsRegion` (selector-subscribed)

**Files:**
- Create: `src/renderer/src/components/results/ResultsRegion.tsx`
- Modify: `src/renderer/src/pages/Editor.tsx`

`ResultsRegion` owns the explain/graph/table swap and the graph-shape detection, subscribing only to the active tab's result-relevant slice. Moving the `logs` subscription here is what stops a streaming query from re-rendering the editor.

- [ ] **Step 1: Create the component**

Create `src/renderer/src/components/results/ResultsRegion.tsx`:

```tsx
import { memo, useMemo } from 'react'
import { useShallow } from 'zustand/react/shallow'
import { useQueryStore } from '../../store/queryStore'
import ResultsTable from './ResultsTable'
import ExplainPanel from './ExplainPanel'
import GraphView from './GraphView'
import GraphShapedBanner from './GraphShapedBanner'
import { detectGraphShape } from '../../lib/detectGraphShape'
import { buildGraphFromRecords } from '../../lib/buildGraphFromRecords'

/**
 * The results area of a query tab: explain plan > graph view > banner + table.
 * Subscribes only to the active tab's result-relevant fields, so editor typing
 * (which mutates `sql`) never re-renders this subtree, and a streaming log tick
 * never re-renders the editor.
 */
function ResultsRegion({ tabId }: { tabId: string }) {
  const tab = useQueryStore(
    useShallow((s) => {
      const t = s.tabs.find((x) => x.id === tabId)
      return {
        result: t?.result,
        error: t?.error,
        isRunning: t?.isRunning ?? false,
        cancelled: t?.cancelled,
        logs: t?.logs,
        explainResult: t?.explainResult,
        isExplaining: t?.isExplaining,
        viewAsGraph: t?.viewAsGraph,
      }
    }),
  )
  const fetchPage = useQueryStore((s) => s.fetchPage)
  const openResultTab = useQueryStore((s) => s.openResultTab)
  const toggleGraphView = useQueryStore((s) => s.toggleGraphView)
  const clearExplain = useQueryStore((s) => s.clearExplain)

  const graphShape = useMemo(() => {
    const rows = tab.result?.rows
    if (!rows || rows.length === 0) return { isGraph: false, truncated: false, nodeCount: 0 }
    if (!detectGraphShape(rows)) return { isGraph: false, truncated: false, nodeCount: 0 }
    const built = buildGraphFromRecords(rows)
    if (built.truncated) return { isGraph: true, truncated: true, nodeCount: built.nodeCount }
    return { isGraph: true, truncated: false, nodeCount: built.nodes.length }
  }, [tab.result?.rows])

  if (tab.explainResult || tab.isExplaining) {
    return (
      <ExplainPanel
        result={tab.explainResult ?? { bytesProcessed: 0 }}
        isLoading={tab.isExplaining}
        onClose={() => clearExplain(tabId)}
      />
    )
  }

  if (tab.viewAsGraph && tab.result && graphShape.isGraph && !graphShape.truncated) {
    return <GraphView result={tab.result} onBack={() => toggleGraphView(tabId)} />
  }

  return (
    <>
      {graphShape.isGraph && (
        <GraphShapedBanner
          truncated={graphShape.truncated}
          nodeCount={graphShape.nodeCount}
          onViewAsGraph={() => toggleGraphView(tabId)}
        />
      )}
      <ResultsTable
        result={tab.result}
        error={tab.error}
        isRunning={tab.isRunning}
        cancelled={tab.cancelled}
        logs={tab.logs}
        onFetchPage={() => fetchPage(tabId)}
        onPin={() => openResultTab(tabId)}
      />
    </>
  )
}

export default memo(ResultsRegion)
```

- [ ] **Step 2: Replace the two inline result blocks in `Editor.tsx` with `<ResultsRegion>`**

In `src/renderer/src/pages/Editor.tsx`, add the import (near the other results imports):

```ts
import ResultsRegion from '../components/results/ResultsRegion'
```

Find the split-pane left result wrapper (currently):

```tsx
                <div style={{ height: `${100 - splitPct}%` }} className="overflow-hidden min-h-0">
                  <div className="flex flex-col h-full overflow-hidden">
                    {renderResultsRegion(activeTab)}
                  </div>
                </div>
```

and the single-pane result wrapper (currently):

```tsx
              <div style={{ height: `${100 - splitPct}%` }} className="overflow-hidden min-h-0">
                <div className="flex flex-col h-full overflow-hidden">
                  {renderResultsRegion(activeTab)}
                </div>
              </div>
```

Replace **both** inner `{renderResultsRegion(activeTab)}` calls with:

```tsx
                    <ResultsRegion tabId={activeTab.id} />
```

(matching each block's indentation; keep the surrounding `<div className="flex flex-col h-full overflow-hidden">` wrappers).

- [ ] **Step 3: Delete the now-unused `renderResultsRegion` helper + dead imports/memo in `Editor.tsx`**

Remove the `renderResultsRegion` function definition (the `const renderResultsRegion = (tab: NonNullable<typeof activeTab>) => { … }` block added in the Phase 2 work).

Remove the now-unused `graphShape` `useMemo` in `Editor.tsx` (it moved into `ResultsRegion`).

Remove now-unused imports from `Editor.tsx`: `ExplainPanel`, `GraphView`, `GraphShapedBanner`, `ResultsTable` (only if no longer referenced — note the `type === 'result'` branch at line ~330 still renders `<ResultsTable result={activeTab.result} pinned />`, so **keep the `ResultsTable` import** and that branch as-is), `detectGraphShape`, `buildGraphFromRecords`.

Remove now-unused store actions from the destructure that were only used by `renderResultsRegion`: `clearExplain`, `fetchPage`, `openResultTab`, `toggleGraphView` — **but** verify each isn't used elsewhere in `Editor.tsx` first (e.g. `clearExplain` is also called in `handleRun`; `explainQuery` stays). Keep any still-referenced action.

- [ ] **Step 4: Typecheck**

Run: `npm run typecheck`
Expected: PASS. If it reports an unused variable, remove that specific binding; if it reports a *missing* one (e.g. `ResultsTable` still needed by the pinned-result branch), keep its import.

- [ ] **Step 5: Run the full suite**

Run: `npx vitest run`
Expected: PASS (336 tests — store API unchanged, no test references `renderResultsRegion`).

- [ ] **Step 6: Commit**

```bash
git add src/renderer/src/components/results/ResultsRegion.tsx src/renderer/src/pages/Editor.tsx
git commit -m "⚡️ perf: extract memoized ResultsRegion with narrow store selectors

Results swap (explain/graph/table) + graph-shape detection now live in a
React.memo component that subscribes only to the active tab's
result-relevant slice via useShallow. Editor typing no longer re-renders
the results subtree; streaming log ticks no longer re-render the editor."
```

---

## Task 5: Memoize the editor subtree (`QueryEditor` extensions + `EditorPane`)

**Files:**
- Modify: `src/renderer/src/components/editor/QueryEditor.tsx`
- Create: `src/renderer/src/components/editor/EditorPane.tsx`
- Modify: `src/renderer/src/pages/Editor.tsx`

- [ ] **Step 1: Memoize the CodeMirror extensions array in `QueryEditor`**

In `src/renderer/src/components/editor/QueryEditor.tsx`, add a memoized extensions array after the `keymapExtension` memo (after line ~106):

```ts
  const extensions = useMemo(
    () => [languageExtension, keymapExtension, customTheme],
    [languageExtension, keymapExtension],
  )
```

Then change the CodeMirror prop (line ~195) from:

```tsx
          extensions={[languageExtension, keymapExtension, customTheme]}
```

to:

```tsx
          extensions={extensions}
```

This stops `@uiw/react-codemirror` from reconfiguring the editor on every keystroke (a fresh array literal currently triggers reconfiguration each render).

- [ ] **Step 2: Wrap `QueryEditor` in `React.memo`**

At the top of `QueryEditor.tsx`, add `memo` to the React import. The file currently imports from `'react'`:

```ts
import { useCallback, useMemo } from 'react'
```

Change to:

```ts
import { memo, useCallback, useMemo } from 'react'
```

Change the declaration from `export default function QueryEditor({…}: QueryEditorProps) {` to a named function `function QueryEditor({…}: QueryEditorProps) {`, and at the end of the file add:

```ts
export default memo(QueryEditor)
```

- [ ] **Step 2.5: Run the full suite (QueryEditor change is behavior-neutral)**

Run: `npx vitest run`
Expected: PASS (336). Catches any accidental signature break before the EditorPane wiring.

- [ ] **Step 3: Create `EditorPane`**

This wraps `QueryEditor` + the limit-warning banner for the **main tab** editor (used by both single-pane and split-left). It subscribes to the tab's `sql`/`isRunning`/`isExplaining`/`savedQueryId`, owns the limit-warning local state, and receives stable `onSave`/`onSplit` callbacks from `Editor`. Run/cancel/explain use store actions directly.

Create `src/renderer/src/components/editor/EditorPane.tsx`:

```tsx
import { memo, useCallback, useState } from 'react'
import { useShallow } from 'zustand/react/shallow'
import { useQueryStore } from '../../store/queryStore'
import { detectMissingLimit } from '../../lib/detectMissingLimit'
import QueryEditor from './QueryEditor'
import LimitWarningBanner from './LimitWarningBanner'
import type { ConnectionEngine } from '@shared/types'

interface EditorPaneProps {
  tabId: string
  engine?: ConnectionEngine
  sqlSchema?: Record<string, string[]>
  cypherSchema?: import('../../lib/cypherLanguage').CypherSchema
  isSplit: boolean
  onSplit: () => void
  onSave: () => void
}

/**
 * The editor half of a query tab: CodeMirror + toolbar + auto-limit banner.
 * Subscribes only to the active tab's editing fields so a keystroke re-renders
 * this pane and nothing else. Run/cancel/explain dispatch store actions; save
 * and split are delegated to the parent (they touch Editor-level modal state).
 */
function EditorPane({ tabId, engine, sqlSchema, cypherSchema, isSplit, onSplit, onSave }: EditorPaneProps) {
  const { sql, isRunning, isExplaining, savedQueryId } = useQueryStore(
    useShallow((s) => {
      const t = s.tabs.find((x) => x.id === tabId)
      return {
        sql: t?.sql ?? '',
        isRunning: t?.isRunning ?? false,
        isExplaining: t?.isExplaining,
        savedQueryId: t?.savedQueryId,
      }
    }),
  )
  const updateTabSql = useQueryStore((s) => s.updateTabSql)
  const runQuery = useQueryStore((s) => s.runQuery)
  const cancelQuery = useQueryStore((s) => s.cancelQuery)
  const explainQuery = useQueryStore((s) => s.explainQuery)
  const clearExplain = useQueryStore((s) => s.clearExplain)

  const [showLimitWarning, setShowLimitWarning] = useState(false)

  const handleChange = useCallback((next: string) => updateTabSql(tabId, next), [updateTabSql, tabId])

  const handleRun = useCallback(() => {
    clearExplain(tabId) // drop any stale explain panel (no-op if none)
    const current = useQueryStore.getState().tabs.find((t) => t.id === tabId)?.sql ?? ''
    if (detectMissingLimit(current)) setShowLimitWarning(true)
    else runQuery(tabId)
  }, [clearExplain, runQuery, tabId])

  const handleRunAnyway = useCallback(() => {
    setShowLimitWarning(false)
    runQuery(tabId)
  }, [runQuery, tabId])

  const handleAddLimit = useCallback(() => {
    const current = useQueryStore.getState().tabs.find((t) => t.id === tabId)?.sql ?? ''
    updateTabSql(tabId, current.trimEnd() + '\nLIMIT 1000')
    runQuery(tabId)
    setShowLimitWarning(false)
  }, [updateTabSql, runQuery, tabId])

  return (
    <>
      <QueryEditor
        value={sql}
        onChange={handleChange}
        onRun={handleRun}
        onCancel={() => cancelQuery(tabId)}
        onExplain={() => explainQuery(tabId)}
        onSave={onSave}
        onSplit={onSplit}
        isSplit={isSplit}
        isRunning={isRunning}
        isExplaining={isExplaining}
        savedQueryId={savedQueryId}
        sqlSchema={sqlSchema}
        cypherSchema={cypherSchema}
        engine={engine}
      />
      {showLimitWarning && (
        <LimitWarningBanner
          onRunAnyway={handleRunAnyway}
          onAddLimit={handleAddLimit}
          onDismiss={() => setShowLimitWarning(false)}
        />
      )}
    </>
  )
}

export default memo(EditorPane)
```

> This reproduces the existing `handleRun`/`handleRunAnyway`/`handleAddLimit` behavior from `Editor.tsx` (clear stale explain, detect missing LIMIT, append `\nLIMIT 1000`) but scoped to one tab. It reads `sql` fresh from the store inside the handlers so the callbacks stay referentially stable.

- [ ] **Step 4: Wire `EditorPane` into `Editor.tsx` (single-pane + split-left)**

In `src/renderer/src/pages/Editor.tsx`:

Add the import:

```ts
import EditorPane from '../components/editor/EditorPane'
```

Stabilize `handleSave` so it can be passed to a memoized child. Replace the current `handleSave` (which closes over `activeTab`) with a `useCallback` that reads fresh state and takes the tab id — and a per-tab wrapper is not needed since `EditorPane` calls `onSave()` for the active tab:

```ts
  const handleSave = useCallback(async () => {
    const tab = useQueryStore.getState().tabs.find((t) => t.id === useQueryStore.getState().activeTabId)
    if (!tab || !tab.sql.trim()) return
    if (tab.savedQueryId) {
      const { queries } = useSavedQueryStore.getState()
      const existing = queries.find((q) => q.id === tab.savedQueryId)
      if (existing) {
        await updateQuery({ ...existing, sql: tab.sql })
        setSavedFlash(true)
        if (savedFlashTimerRef.current) clearTimeout(savedFlashTimerRef.current)
        savedFlashTimerRef.current = setTimeout(() => setSavedFlash(false), 1500)
      }
    } else {
      setSavingTabId(useQueryStore.getState().activeTabId)
    }
  }, [updateQuery])
```

Replace the **single-pane** `<QueryEditor … />` + its inline `{limitWarningTabId === activeTab.id && <LimitWarningBanner … />}` block with:

```tsx
                <EditorPane
                  tabId={activeTab.id}
                  engine={activeEngine}
                  sqlSchema={sqlSchema}
                  cypherSchema={cypherSchema}
                  isSplit={false}
                  onSplit={() => toggleSplit(activeTab.id)}
                  onSave={handleSave}
                />
```

Replace the **split-left** `<QueryEditor … />` + its inline limit-banner block with:

```tsx
                  <EditorPane
                    tabId={activeTab.id}
                    engine={activeEngine}
                    sqlSchema={sqlSchema}
                    cypherSchema={cypherSchema}
                    isSplit
                    onSplit={() => toggleSplit(activeTab.id)}
                    onSave={handleSave}
                  />
```

Leave the **split-right** pane's inline `<QueryEditor>` (bound to `rightPane` via `updateRightPaneSql`/`runRightPane`/`cancelRightPane`) unchanged — it's the lower-traffic path and out of scope for v1.

- [ ] **Step 5: Remove now-dead code in `Editor.tsx`**

Remove the now-unused: `limitWarningTabId` state + `setLimitWarningTabId`, the `handleRun`/`handleRunAnyway`/`handleAddLimit` functions, the `detectMissingLimit` import, and the `LimitWarningBanner` import (the single-pane + split-left banners moved into `EditorPane`; confirm the split-right pane did not use them). Keep `QueryEditor` imported (still used by the split-right pane). Remove `updateTabSql` from the Editor destructure only if no longer referenced (the right pane uses `updateRightPaneSql`, not `updateTabSql`; the limit "Add LIMIT" path moved to EditorPane — so `updateTabSql` is likely now unused in Editor; remove it if typecheck flags it).

- [ ] **Step 6: Convert `Editor.tsx`'s store subscription to selectors**

Replace the whole-store destructure at the top of `Editor()`:

```ts
  const {
    tabs, activeTabId,
    openTab, openResultTab, closeTab, setActiveTab, updateTabSql,
    runQuery, cancelQuery, explainQuery, clearExplain, fetchPage, reorderTabs,
    toggleGraphView, toggleSplit, updateRightPaneSql, runRightPane, cancelRightPane,
  } = useQueryStore()
```

with selector subscriptions limited to what `Editor` itself still uses (tab bar + layout + split-right). Keep only the bindings actually referenced after Steps 3–5; the canonical set is:

```ts
  const tabs = useQueryStore(useShallow((s) => s.tabs.map((t) => ({
    id: t.id, title: t.title, type: t.type, isRunning: t.isRunning, savedQueryId: t.savedQueryId,
  }))))
  const activeTabId = useQueryStore((s) => s.activeTabId)
  const openTab = useQueryStore((s) => s.openTab)
  const openResultTab = useQueryStore((s) => s.openResultTab)
  const closeTab = useQueryStore((s) => s.closeTab)
  const setActiveTab = useQueryStore((s) => s.setActiveTab)
  const reorderTabs = useQueryStore((s) => s.reorderTabs)
  const toggleSplit = useQueryStore((s) => s.toggleSplit)
  const updateRightPaneSql = useQueryStore((s) => s.updateRightPaneSql)
  const runRightPane = useQueryStore((s) => s.runRightPane)
  const cancelRightPane = useQueryStore((s) => s.cancelRightPane)
  const activeTab = useQueryStore((s) => s.tabs.find((t) => t.id === s.activeTabId))
```

Add `import { useShallow } from 'zustand/react/shallow'` to `Editor.tsx`.

> `activeTab` is selected as the full tab object (the `type === 'table'` / `type === 'result'` branches and the split-pane wiring read `activeTab.sql`, `activeTab.rightPane`, `activeTab.tableRef`, etc.). `tabs` is reduced to the tab-bar fields so unrelated per-tab changes don't churn the bar. The pinned `type === 'result'` branch keeps using `<ResultsTable result={activeTab.result} pinned />`.

- [ ] **Step 7: Typecheck + full suite + build**

Run: `npm run typecheck`
Expected: PASS. Fix any "declared but never read" by removing that binding; re-add anything typecheck reports as missing.

Run: `npx vitest run`
Expected: PASS (337 total: 336 prior + the new `paginate` file's 4 tests, minus none — confirm green).

Run: `npm run build`
Expected: completes without error.

- [ ] **Step 8: Commit**

```bash
git add src/renderer/src/components/editor/QueryEditor.tsx src/renderer/src/components/editor/EditorPane.tsx src/renderer/src/pages/Editor.tsx
git commit -m "⚡️ perf: memoized EditorPane + QueryEditor, selector subscriptions in Editor

Memoize CodeMirror extensions (no reconfigure per keystroke) and wrap
QueryEditor in React.memo. New EditorPane subscribes only to the tab's
editing fields and owns the auto-limit banner. Editor.tsx switches to
narrow selectors so log ticks / cross-tab changes don't re-render it."
```

---

## Task 6: Profiler verification + docs

**Files:**
- Modify: `README.md` (optional perf note), `CHANGELOG.md`, `CLAUDE.md`

- [ ] **Step 1: Profiler verification (manual)**

Run `just dev`. Open React DevTools → Profiler → enable "Highlight updates when components render."

Verify against the spec's acceptance checklist:
1. Type a character in the editor with a result displayed → only the editor pane highlights; `ResultsTable` does **not** flash.
2. With a 500-row result (set page size to 500), typing has no perceptible stutter.
3. Scroll the 500-row table → smooth; inspect the DOM and confirm only ~visible rows + 2 spacer `<tr>`s are mounted (not 500).
4. While a query streams logs, the editor stays responsive.
5. Regression sweep: run, cancel, export, explain panel, graph view (Neo4j), split panes, save-query modal all behave as before.

Record the before/after observation in the commit message or PR description.

- [ ] **Step 2: Update CHANGELOG**

Under `## [Unreleased]` in `CHANGELOG.md` (create the section above the latest version if absent), add:

```markdown
### Changed
- **Renderer responsiveness** — editor typing and large result tables are now smooth. The results area (`ResultsRegion`) and editor (`EditorPane`) are split into memoized components that subscribe to narrow store slices, so a keystroke re-renders only the editor and a streaming log tick re-renders only the results. `ResultsTable` is memoized, its filter/sort/page derivation is memoized, and its rows are virtualized via `@tanstack/react-virtual` (only visible rows mount). No behavior changes.
```

- [ ] **Step 3: Add the CLAUDE.md change-log entry**

Insert at the top of the entries (newest first) in `CLAUDE.md`:

```markdown
### [2026-06-14] Performance: Renderer responsiveness refactor

**Type:** Change
**Context:** Editor typing and large result tables felt janky. Profiling traced it to `Editor` subscribing to the whole query store: each keystroke (`updateTabSql`) re-rendered the un-memoized `ResultsTable`, which re-ran `filterSortRows` over the full result set and repainted up to 500 rows. Per the spec at `docs/superpowers/specs/2026-06-14-responsiveness-refactor-design.md`, this was a renderer refactor (Approach A), not a stack swap.
**Problem / Change:** Whole-store subscriptions + an un-memoized, un-virtualized results table made every keystroke pay for a full table repaint.
**Solution / Outcome:**
- **`ResultsTable`** — wrapped in `React.memo`; `filterSortRows` + `paginate` derivation hoisted above the early returns and memoized; rows virtualized with `@tanstack/react-virtual` using spacer-row (`paddingTop`/`paddingBottom`) virtualization that preserves the sticky `<thead>`, `colgroup` widths, column-resize, and `GraphElementChip` cells.
- **`ResultsRegion`** (new) — memoized; owns the explain/graph/table swap + graph-shape detection; subscribes via `useShallow` to only the active tab's result/logs/explain/graph fields.
- **`EditorPane`** (new) + **`QueryEditor`** — memoized; CodeMirror `extensions` array memoized so typing no longer reconfigures the editor; `EditorPane` subscribes to only the tab's `sql`/run fields and owns the auto-limit banner.
- **`Editor.tsx`** — whole-store destructure replaced with narrow selectors; `tabs` reduced to tab-bar fields. No store API change → 337 tests green; coverage gate unaffected (changed UI files are outside the coverage include set).
- **New pure helper** `paginate()` (4 tests). `@tanstack/react-virtual` added.

**Files affected:**
- `package.json` — `@tanstack/react-virtual`
- `src/renderer/src/lib/paginate.ts` + test — created
- `src/renderer/src/components/results/ResultsTable.tsx` — memo + virtualize
- `src/renderer/src/components/results/ResultsRegion.tsx` — created
- `src/renderer/src/components/editor/EditorPane.tsx` — created
- `src/renderer/src/components/editor/QueryEditor.tsx` — memo + memoized extensions
- `src/renderer/src/pages/Editor.tsx` — selector subscriptions; delegate to EditorPane/ResultsRegion
- `README.md`, `CHANGELOG.md` — docs
```

- [ ] **Step 4: Commit**

```bash
git add README.md CHANGELOG.md CLAUDE.md
git commit -m "📝 docs: document renderer responsiveness refactor"
```

- [ ] **Step 5: Push + open PR**

```bash
git push -u origin feat/responsiveness
```
Then open a PR summarizing the three layers (memoize + virtualize table, ResultsRegion isolation, EditorPane/QueryEditor memo + selectors), the Profiler verification results, and that all 337 tests + typecheck + build pass.

---

## Self-Review

**1. Spec coverage:**
- Selector/`useShallow` narrowing + `EditorPane`/`ResultsRegion` split → Tasks 4, 5 ✓
- `React.memo` `ResultsTable` + memoized filter/sort/page → Task 3 ✓
- `@tanstack/react-virtual` row virtualization preserving sticky thead / colWidths / GraphElementChip → Tasks 1, 3 ✓
- Editor-typing decoupling (CM extensions memo, no debounce in base scope) → Task 5 ✓
- No store API change; existing tests stay green → verified in Tasks 4, 5 (Steps run `npx vitest run`) ✓
- Verification/profiling + docs → Task 6 ✓
- Out-of-scope (Apple-like UI, store slicing, framework swap, split-right pane) → respected; split-right left inline, noted ✓

**2. Placeholder scan:** No TBD/"similar to"/vague steps — every code step has full paste-able code and exact commands. The conditional removals in Tasks 4/5 (Steps 3/5) are guarded with explicit "keep X / remove Y if typecheck flags" instructions rather than left vague.

**3. Type consistency:** `paginate<T>(rows, page, pageSize)` signature matches its use in `ResultsTable` Step 3. `ResultsRegion`/`EditorPane` props (`tabId: string`) match their `Editor.tsx` call sites. `EditorPane`'s `cypherSchema` type references `import('../../lib/cypherLanguage').CypherSchema`, matching `QueryEditor`'s existing prop type. The `useShallow` slice field names (`result`, `logs`, `sql`, `isRunning`, …) match `QueryTab` in `shared/types.ts`. `ROW_HEIGHT`/`EMPTY_ROWS` are defined once in `ResultsTable` and used there only.

---

## Execution Handoff

**Plan complete and saved to `docs/superpowers/plans/2026-06-14-responsiveness-refactor.md`. Two execution options:**

**1. Subagent-Driven (recommended)** — I dispatch a fresh subagent per task, review between tasks, fast iteration.

**2. Inline Execution** — Execute tasks in this session using executing-plans, batch execution with checkpoints.

**Which approach?**
