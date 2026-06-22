# Decompose `ResultsTable.tsx` (TD-3) Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Split the 607-line `ResultsTable.tsx` into focused, single-responsibility units behind its existing `memo` boundary, with zero behavior change.

**Architecture:** `ResultsTable` stays the default-exported, memoized **orchestrator** — it keeps all state (page, filters, sort, column widths, export/copy UI flags) and the derivations (`filteredRows`/`pageRows`), and delegates rendering to presentational children: a non-table state view, a toolbar, a filter/sort bar, a virtualized grid, and a pagination bar. Two pure formatters move to `lib/`. State stays colocated exactly where it is today; children are presentational and receive props + callbacks, so the render output and all interactions are byte-identical.

**Tech Stack:** React 18 + TypeScript (strict), `@tanstack/react-virtual`, Tailwind, Vitest.

**Source of truth:** the current `src/renderer/src/components/results/ResultsTable.tsx` (read it; this plan cites its line ranges).

## Global Constraints

- TypeScript strict mode; no `any`; prefer explicit prop interfaces.
- **No behavior change.** Identical DOM/classes, identical interactions (resize, sort, filter, copy, export, pin, pagination, virtualization, log/cancelled/error/empty states).
- `ResultsTable` keeps its **default export wrapped in `memo`** and its existing `ResultsTableProps` (consumed by `ResultsRegion.tsx` and `Editor.tsx`) — do not change the public prop surface.
- New presentational children are **not** individually memoized (they re-render with the parent, which is already gated by `memo` + `ResultsRegion`'s `useShallow`). Do not add `memo` to children.
- These components have **no unit tests and no component-test infra** (`@testing-library` is absent). Verification per task = `npx tsc --noEmit` clean + `npx vitest run` stays green (502 tests). The pure `lib/` helpers (Task 1) get real unit tests. Final task = manual verification in the running app.
- Tailwind utility classes only; reuse the exact class strings being moved.
- Work on the current branch `feat/tier2-decomposition`; commit per task.

## File Structure

New files (all under `src/renderer/src/`):
- `lib/formatCell.ts` — `formatCell(value: unknown): string` (moved from ResultsTable).
- `lib/formatBytes.ts` — `formatBytes(bytes: number): string` (moved from ResultsTable; renderer-local copy).
- `components/results/QueryLogView.tsx` — the repeated log-list renderer.
- `components/results/ResultsStateView.tsx` — running / cancelled / error / empty early states.
- `components/results/ResultsToolbar.tsx` — top status bar (counts + filter/pin/copy/export controls).
- `components/results/FilterSortBar.tsx` — per-column filter input row.
- `components/results/ResultsGrid.tsx` — the virtualized `<table>` (owns the virtualizer + column-resize).
- `components/results/ResultsPagination.tsx` — bottom pagination bar.

Modified:
- `components/results/ResultsTable.tsx` — becomes the orchestrator (~150 lines).

**Convention for moved JSX:** each task gives the new file in full (imports, props interface, component) and the exact orchestrator edit. Where a block is moved verbatim from the current file, the cited line range is the authority — copy it exactly, changing only the local-state references into the named props the task lists.

---

### Task 1: Extract pure formatters to `lib/` (with tests)

**Files:**
- Create: `src/renderer/src/lib/formatCell.ts`
- Create: `src/renderer/src/lib/formatBytes.ts`
- Create: `src/__tests__/renderer/lib/formatCell.test.ts`
- Create: `src/__tests__/renderer/lib/formatBytes.test.ts`
- Modify: `src/renderer/src/components/results/ResultsTable.tsx` (remove the two local fns, import from lib)

**Interfaces:**
- Produces: `formatCell(value: unknown): string`, `formatBytes(bytes: number): string`.

- [ ] **Step 1: Write the failing tests**

`src/__tests__/renderer/lib/formatCell.test.ts`:

```ts
import { describe, it, expect } from 'vitest'
import { formatCell } from '../../../renderer/src/lib/formatCell'

describe('formatCell', () => {
  it('renders null/undefined as NULL', () => {
    expect(formatCell(null)).toBe('NULL')
    expect(formatCell(undefined)).toBe('NULL')
  })
  it('unwraps BigQuery { value } wrappers', () => {
    expect(formatCell({ value: '2024-01-01' })).toBe('2024-01-01')
  })
  it('JSON-stringifies other objects', () => {
    expect(formatCell({ a: 1 })).toBe('{"a":1}')
  })
  it('stringifies primitives', () => {
    expect(formatCell(42)).toBe('42')
    expect(formatCell(true)).toBe('true')
  })
})
```

`src/__tests__/renderer/lib/formatBytes.test.ts`:

```ts
import { describe, it, expect } from 'vitest'
import { formatBytes } from '../../../renderer/src/lib/formatBytes'

describe('formatBytes', () => {
  it('formats < 1MB as KB', () => { expect(formatBytes(2_000)).toBe('2.0 KB') })
  it('formats < 1GB as MB', () => { expect(formatBytes(2_000_000)).toBe('2.0 MB') })
  it('formats >= 1GB as GB', () => { expect(formatBytes(2_000_000_000)).toBe('2.00 GB') })
})
```

- [ ] **Step 2: Run tests to verify they fail**

Run: `npx vitest run src/__tests__/renderer/lib/formatCell.test.ts src/__tests__/renderer/lib/formatBytes.test.ts`
Expected: FAIL — cannot find module `formatCell`/`formatBytes`.

- [ ] **Step 3: Create the lib files**

`src/renderer/src/lib/formatCell.ts` (moved verbatim from ResultsTable.tsx:592–601):

```ts
export function formatCell(value: unknown): string {
  if (value === null || value === undefined) return 'NULL'
  if (typeof value === 'object') {
    // BigQuery wraps DATE / DATETIME / TIMESTAMP / NUMERIC as { value: "..." }
    const v = value as Record<string, unknown>
    if ('value' in v && typeof v.value === 'string') return v.value
    return JSON.stringify(value)
  }
  return String(value)
}
```

`src/renderer/src/lib/formatBytes.ts` (moved verbatim from ResultsTable.tsx:603–607):

```ts
export function formatBytes(bytes: number): string {
  if (bytes < 1e6) return `${(bytes / 1e3).toFixed(1)} KB`
  if (bytes < 1e9) return `${(bytes / 1e6).toFixed(1)} MB`
  return `${(bytes / 1e9).toFixed(2)} GB`
}
```

- [ ] **Step 4: Remove the local fns from ResultsTable and import from lib**

In `ResultsTable.tsx`: delete the `formatCell` (lines 592–601) and `formatBytes` (lines 603–607) function definitions at the bottom of the file. Add to the import block near the top:

```ts
import { formatCell } from '../../lib/formatCell'
import { formatBytes } from '../../lib/formatBytes'
```

- [ ] **Step 5: Verify**

Run: `npx vitest run src/__tests__/renderer/lib/formatCell.test.ts src/__tests__/renderer/lib/formatBytes.test.ts` → PASS.
Run: `npx tsc --noEmit -p tsconfig.web.json` → clean.

- [ ] **Step 6: Commit**

```bash
git add src/renderer/src/lib/formatCell.ts src/renderer/src/lib/formatBytes.ts \
        src/__tests__/renderer/lib/formatCell.test.ts src/__tests__/renderer/lib/formatBytes.test.ts \
        src/renderer/src/components/results/ResultsTable.tsx
git commit -m "refactor(results): extract formatCell/formatBytes to lib (TD-3)"
```

---

### Task 2: Extract `QueryLogView` + `ResultsStateView` (non-table states)

**Files:**
- Create: `src/renderer/src/components/results/QueryLogView.tsx`
- Create: `src/renderer/src/components/results/ResultsStateView.tsx`
- Modify: `src/renderer/src/components/results/ResultsTable.tsx`

**Interfaces:**
- Consumes: nothing new.
- Produces:
  - `QueryLogView({ logs, highlightLast }: { logs: string[]; highlightLast?: boolean })`
  - `resultsViewState(p: { isRunning?: boolean; cancelled?: boolean; error?: string; hasResult: boolean }): 'running' | 'cancelled' | 'error' | 'empty' | 'table'`
  - `ResultsStateView({ state, logs, error, onFixWithAI }: { state: 'running' | 'cancelled' | 'error' | 'empty'; logs: string[]; error?: string; onFixWithAI?: () => void })`

- [ ] **Step 1: Create `QueryLogView.tsx`**

This consolidates the three near-identical log lists (running 169–185, cancelled 193–204, error 216–227). The running variant highlights the last line; the others don't. It also owns the auto-scroll-to-end behavior (currently the `logEndRef` effect at 73–75).

```tsx
import { useEffect, useRef } from 'react'

interface QueryLogViewProps {
  logs: string[]
  /** Running state brightens the most recent line; terminal states don't. */
  highlightLast?: boolean
}

export default function QueryLogView({ logs, highlightLast = false }: QueryLogViewProps) {
  const logEndRef = useRef<HTMLDivElement>(null)
  useEffect(() => {
    logEndRef.current?.scrollIntoView({ behavior: 'smooth' })
  }, [logs])

  return (
    <div className="space-y-1">
      {logs.map((line, i) => (
        <div
          key={i}
          className={`flex items-start gap-2 ${
            highlightLast && i === logs.length - 1 ? 'text-app-text' : 'text-app-text-3'
          }`}
        >
          <span className="shrink-0 mt-px text-app-text-3/50">›</span>
          <span>{line}</span>
        </div>
      ))}
      <div ref={logEndRef} />
    </div>
  )
}
```

- [ ] **Step 2: Create `ResultsStateView.tsx`**

Move the four early-return blocks (running 161–188, cancelled 190–211, error 213–244, empty 246–253) here, using `QueryLogView` for the log lists. Also export the `resultsViewState` discriminator.

```tsx
import { Sparkles } from 'lucide-react'
import QueryLogView from './QueryLogView'

export type ResultsView = 'running' | 'cancelled' | 'error' | 'empty' | 'table'

export function resultsViewState(p: {
  isRunning?: boolean
  cancelled?: boolean
  error?: string
  hasResult: boolean
}): ResultsView {
  if (p.isRunning) return 'running'
  if (p.cancelled) return 'cancelled'
  if (p.error) return 'error'
  if (!p.hasResult) return 'empty'
  return 'table'
}

interface ResultsStateViewProps {
  state: Exclude<ResultsView, 'table'>
  logs: string[]
  error?: string
  onFixWithAI?: () => void
}

export default function ResultsStateView({ state, logs, error, onFixWithAI }: ResultsStateViewProps) {
  if (state === 'running') {
    return (
      <div className="flex flex-col h-full">
        <div className="flex items-center gap-2 px-3 py-1.5 border-b border-app-border bg-app-surface shrink-0">
          <span className="app-dot animate-pulse" style={{ backgroundColor: 'rgb(var(--c-accent))' }} />
          <span className="text-xs text-app-text-2 font-medium">Running…</span>
        </div>
        <div className="flex-1 overflow-y-auto p-4 font-mono text-xs selectable bg-app-bg">
          {logs.length === 0 ? (
            <span className="text-app-text-3 animate-pulse">Connecting…</span>
          ) : (
            <QueryLogView logs={logs} highlightLast />
          )}
        </div>
      </div>
    )
  }

  if (state === 'cancelled') {
    return (
      <div className="flex flex-col h-full">
        {logs.length > 0 && (
          <div className="flex-1 overflow-y-auto p-4 font-mono text-xs selectable bg-app-bg">
            <QueryLogView logs={logs} />
          </div>
        )}
        <div className="flex items-center justify-center gap-2 py-6 text-app-warn text-xs border-t border-app-border bg-app-warn-subtle/40">
          <span className="app-dot" style={{ backgroundColor: 'rgb(var(--c-state-warn))' }} />
          Query cancelled
        </div>
      </div>
    )
  }

  if (state === 'error') {
    return (
      <div className="flex flex-col h-full">
        {logs.length > 0 && (
          <div className="overflow-y-auto max-h-32 p-3 font-mono text-xs border-b border-app-border selectable bg-app-bg">
            <QueryLogView logs={logs} />
          </div>
        )}
        <div className="p-4">
          <div className="bg-app-err-subtle border border-app-err/30 rounded-lg p-3">
            <p className="text-xs font-mono text-app-err whitespace-pre-wrap selectable">{error}</p>
          </div>
          {onFixWithAI && (
            <button
              type="button"
              onClick={onFixWithAI}
              className="mt-3 inline-flex items-center gap-1.5 px-2.5 py-1 rounded-md text-ui font-medium bg-app-accent hover:bg-app-accent-hover text-white transition-colors"
            >
              <Sparkles size={13} /> Fix with AI
            </button>
          )}
        </div>
      </div>
    )
  }

  // empty
  return (
    <div className="h-full flex flex-col items-center justify-center gap-2 text-app-text-3 text-sm bg-app-bg">
      <span className="app-section-label">Empty</span>
      <span>Run a query to see results</span>
    </div>
  )
}
```

> Note: the cancelled/error log lists previously did not auto-scroll (only the running one had `logEndRef`). Routing all three through `QueryLogView` adds a harmless `scrollIntoView` on mount for those terminal states — acceptable and consistent. If you want to preserve the exact prior behavior, pass a `scrollToEnd` prop and set it only for running; the simpler unified version is preferred unless review objects.

- [ ] **Step 3: Wire into ResultsTable**

In `ResultsTable.tsx`: delete the `logEndRef` ref (line 37) and its effect (73–75); delete the four early-return blocks (161–253). Add imports:

```ts
import ResultsStateView, { resultsViewState } from './ResultsStateView'
```

After the derivations and before the table return, add:

```tsx
  const state = resultsViewState({ isRunning, cancelled, error, hasResult: !!result })
  if (state !== 'table') {
    return <ResultsStateView state={state} logs={logs} error={error} onFixWithAI={onFixWithAI} />
  }
```

Because `state === 'table'` guarantees `result` is defined, the existing `const { columns, rows, … } = result` (line 255) is still safe — but TypeScript won't narrow through the helper. Keep the existing non-null usage working by changing line 255 to read from `result!`:

```ts
  const { columns, rows, executionTimeMs, bytesProcessed, totalRows: serverTotal, hasMore } = result!
```

- [ ] **Step 4: Verify**

Run: `npx tsc --noEmit -p tsconfig.web.json` → clean.
Run: `npx vitest run` → 502 passing (unchanged).

- [ ] **Step 5: Commit**

```bash
git add src/renderer/src/components/results/QueryLogView.tsx \
        src/renderer/src/components/results/ResultsStateView.tsx \
        src/renderer/src/components/results/ResultsTable.tsx
git commit -m "refactor(results): extract QueryLogView + ResultsStateView (TD-3)"
```

---

### Task 3: Extract `ResultsToolbar` (status bar)

**Files:**
- Create: `src/renderer/src/components/results/ResultsToolbar.tsx`
- Modify: `src/renderer/src/components/results/ResultsTable.tsx`

**Interfaces:**
- Consumes: `formatBytes` (from `lib/`).
- Produces: `ResultsToolbar` with the props listed below.

- [ ] **Step 1: Create `ResultsToolbar.tsx`**

Move the status-bar block (current lines 312–392). The toolbar owns the export popover's outside-click effect (currently 77–87) and the `exportRef`. State for `builderOpen`, `exportOpen`, `exporting`, `copied` and the `handleExport`/`handleCopy` callbacks stay in the parent and arrive as props, EXCEPT the export popover's open/outside-click which is local presentation — move `exportOpen` + `exportRef` + its effect into the toolbar, and accept `onExport(format)` as the action.

```tsx
import { useEffect, useRef, useState } from 'react'
import { Download, Copy, Check, Pin, SlidersHorizontal } from 'lucide-react'
import { formatBytes } from '../../lib/formatBytes'

interface ResultsToolbarProps {
  displayTotal: number
  displayTotalStr: string
  hasMore?: boolean
  serverTotal?: number
  executionTimeMs: number
  bytesProcessed?: number
  fetchedRows: number
  activeFilterCount: number
  builderOpen: boolean
  onToggleBuilder: () => void
  onPin?: () => void
  pinned?: boolean
  copied: boolean
  onCopy: () => void
  exporting: boolean
  onExport: (format: 'csv' | 'json' | 'tsv') => void
}

export default function ResultsToolbar({
  displayTotal, displayTotalStr, hasMore, serverTotal, executionTimeMs, bytesProcessed,
  fetchedRows, activeFilterCount, builderOpen, onToggleBuilder, onPin, pinned,
  copied, onCopy, exporting, onExport,
}: ResultsToolbarProps) {
  const [exportOpen, setExportOpen] = useState(false)
  const exportRef = useRef<HTMLDivElement>(null)

  useEffect(() => {
    if (!exportOpen) return
    const handler = (e: MouseEvent) => {
      if (exportRef.current && !exportRef.current.contains(e.target as Node)) setExportOpen(false)
    }
    document.addEventListener('mousedown', handler)
    return () => document.removeEventListener('mousedown', handler)
  }, [exportOpen])

  return (
    <div className="flex items-center gap-4 px-3 py-1.5 border-b border-app-border bg-app-surface shrink-0">
      <span className="text-xs text-app-text-2 font-tabular">
        {displayTotal === 1 ? '1 row' : `${displayTotalStr} rows`}
        {hasMore && serverTotal == null && '+'}
      </span>
      <span className="text-xs text-app-text-3 font-tabular">{executionTimeMs}ms</span>
      {bytesProcessed !== undefined && (
        <span className="text-xs text-app-text-3 font-tabular">{formatBytes(bytesProcessed)} processed</span>
      )}
      {fetchedRows < (serverTotal ?? fetchedRows) && (
        <span className="text-xs text-app-text-3 font-tabular">
          ({fetchedRows.toLocaleString()} fetched)
        </span>
      )}
      <div className="flex-1" />
      <button
        onClick={onToggleBuilder}
        title={builderOpen ? 'Hide filter bar' : 'Filter & sort'}
        className={`relative flex items-center gap-1 text-xs px-2 py-0.5 rounded transition-colors border border-app-border ${
          builderOpen || activeFilterCount > 0
            ? 'text-app-accent border-app-accent/50 hover:bg-app-elevated'
            : 'text-app-text-2 hover:text-app-text hover:bg-app-elevated'
        }`}
      >
        <SlidersHorizontal size={11} />
        <span>Filter</span>
        {activeFilterCount > 0 && (
          <span className="absolute -top-1 -right-1 bg-app-accent text-white text-[9px] rounded-full w-3.5 h-3.5 flex items-center justify-center font-bold">
            {activeFilterCount}
          </span>
        )}
      </button>
      {onPin && (
        <button
          onClick={onPin}
          disabled={pinned || fetchedRows === 0}
          title={pinned ? 'Result pinned' : 'Pin result as snapshot tab'}
          className="flex items-center gap-1 text-xs px-2 py-0.5 rounded text-app-text-2 hover:text-app-text hover:bg-app-elevated disabled:opacity-40 disabled:cursor-not-allowed transition-colors border border-app-border"
        >
          <Pin size={11} className={pinned ? 'text-app-accent' : ''} />
          <span>{pinned ? 'Pinned' : 'Pin'}</span>
        </button>
      )}
      <button
        onClick={onCopy}
        disabled={fetchedRows === 0}
        title="Copy results to clipboard (TSV)"
        className="flex items-center gap-1 text-xs px-2 py-0.5 rounded text-app-text-2 hover:text-app-text hover:bg-app-elevated disabled:opacity-40 disabled:cursor-not-allowed transition-colors border border-app-border"
      >
        {copied ? <Check size={11} className="text-app-ok" /> : <Copy size={11} />}
        <span>{copied ? 'Copied' : 'Copy'}</span>
      </button>
      <div ref={exportRef} className="relative">
        <button
          onClick={() => setExportOpen((v) => !v)}
          disabled={exporting || fetchedRows === 0}
          title="Export results"
          className="flex items-center gap-1 text-xs px-2 py-0.5 rounded text-app-text-2 hover:text-app-text hover:bg-app-elevated disabled:opacity-40 disabled:cursor-not-allowed transition-colors border border-app-border"
        >
          <Download size={11} />
          <span>{exporting ? 'Saving…' : 'Export'}</span>
        </button>
        {exportOpen && (
          <div className="absolute top-full right-0 mt-1 bg-app-surface border border-app-border rounded-lg shadow-xl py-1 z-50 min-w-[100px]">
            {(['csv', 'tsv', 'json'] as const).map((fmt) => (
              <button
                key={fmt}
                onClick={() => { setExportOpen(false); onExport(fmt) }}
                className="w-full text-left px-3 py-1.5 text-xs text-app-text hover:bg-app-elevated transition-colors uppercase"
              >
                {fmt}
              </button>
            ))}
          </div>
        )}
      </div>
    </div>
  )
}
```

> `handleExport` in the parent already calls `setExportOpen(false)` first (line 285); since `exportOpen` now lives in the toolbar, drop that line from the parent's `handleExport` (the toolbar closes the popover before invoking `onExport`).

- [ ] **Step 2: Wire into ResultsTable**

In `ResultsTable.tsx`: delete `exportOpen`/`exportRef` state (lines 41, 45), the export outside-click effect (77–87), and the status-bar JSX (312–392). Remove the `setExportOpen(false)` line from `handleExport`. Add import `import ResultsToolbar from './ResultsToolbar'`. In the return, replace the status-bar block with:

```tsx
      <ResultsToolbar
        displayTotal={displayTotal}
        displayTotalStr={displayTotalStr}
        hasMore={hasMore}
        serverTotal={serverTotal}
        executionTimeMs={executionTimeMs}
        bytesProcessed={bytesProcessed}
        fetchedRows={fetchedRows}
        activeFilterCount={activeFilterCount}
        builderOpen={builderOpen}
        onToggleBuilder={() => setBuilderOpen((v) => !v)}
        onPin={onPin}
        pinned={pinned}
        copied={copied}
        onCopy={handleCopy}
        exporting={exporting}
        onExport={handleExport}
      />
```

Remove the now-unused `Download, Copy, Check, Pin, SlidersHorizontal` and `formatBytes` imports from ResultsTable if no longer referenced there (the grid task still needs some lucide icons — verify with `tsc`).

- [ ] **Step 3: Verify**

`npx tsc --noEmit -p tsconfig.web.json` → clean. `npx vitest run` → 502 passing.

- [ ] **Step 4: Commit**

```bash
git add src/renderer/src/components/results/ResultsToolbar.tsx src/renderer/src/components/results/ResultsTable.tsx
git commit -m "refactor(results): extract ResultsToolbar status bar (TD-3)"
```

---

### Task 4: Extract `FilterSortBar`

**Files:**
- Create: `src/renderer/src/components/results/FilterSortBar.tsx`
- Modify: `src/renderer/src/components/results/ResultsTable.tsx`

**Interfaces:**
- Produces: `FilterSortBar` with the props below.

- [ ] **Step 1: Create `FilterSortBar.tsx`**

Move the filter-bar block (current lines 395–421). Filter/sort/page state stays in the parent; the bar receives values + setters.

```tsx
import { X } from 'lucide-react'

const DEFAULT_COL_WIDTH = 160

interface FilterSortBarProps {
  columns: string[]
  colWidths: Record<string, number>
  colFilters: Record<string, string>
  activeFilterCount: number
  onFilterChange: (col: string, value: string) => void
  onClear: () => void
}

export default function FilterSortBar({
  columns, colWidths, colFilters, activeFilterCount, onFilterChange, onClear,
}: FilterSortBarProps) {
  return (
    <div className="flex items-center gap-1 px-2 py-1.5 border-b border-app-border bg-app-elevated/40 shrink-0 overflow-x-auto">
      {columns.map((col) => (
        <div key={col} className="flex items-center shrink-0" style={{ width: colWidths[col] ?? DEFAULT_COL_WIDTH }}>
          <input
            type="text"
            value={colFilters[col] ?? ''}
            onChange={(e) => onFilterChange(col, e.target.value)}
            placeholder={col}
            className="w-full bg-app-surface border border-app-border rounded px-2 py-0.5 text-[11px] text-app-text placeholder-app-text-3 focus:outline-none focus:border-app-accent transition-colors"
          />
        </div>
      ))}
      {activeFilterCount > 0 && (
        <button
          onClick={onClear}
          className="shrink-0 flex items-center gap-1 text-[11px] px-2 py-0.5 rounded text-app-text-2 hover:text-app-text hover:bg-app-elevated transition-colors border border-app-border"
        >
          <X size={10} />
          Clear
        </button>
      )}
    </div>
  )
}
```

- [ ] **Step 2: Wire into ResultsTable**

Delete the filter-bar JSX (395–421). Import `FilterSortBar`. Replace with:

```tsx
      {builderOpen && (
        <FilterSortBar
          columns={columns}
          colWidths={colWidths}
          colFilters={colFilters}
          activeFilterCount={activeFilterCount}
          onFilterChange={(col, value) => { setColFilters((prev) => ({ ...prev, [col]: value })); setPage(0) }}
          onClear={() => { setColFilters({}); setSortCol(null); setPage(0) }}
        />
      )}
```

- [ ] **Step 3: Verify** — `npx tsc --noEmit -p tsconfig.web.json` clean; `npx vitest run` → 502 passing.

- [ ] **Step 4: Commit**

```bash
git add src/renderer/src/components/results/FilterSortBar.tsx src/renderer/src/components/results/ResultsTable.tsx
git commit -m "refactor(results): extract FilterSortBar (TD-3)"
```

---

### Task 5: Extract `ResultsGrid` (virtualized table)

**Files:**
- Create: `src/renderer/src/components/results/ResultsGrid.tsx`
- Modify: `src/renderer/src/components/results/ResultsTable.tsx`

**Interfaces:**
- Consumes: `formatCell`, `isGraphElement`, `GraphElementChip`.
- Produces: `ResultsGrid` with the props below. The grid owns the virtualizer, the scroll/tbody refs, `scrollMargin`, the reset-scroll effect, and the column-resize handler/state.

- [ ] **Step 1: Create `ResultsGrid.tsx`**

This moves: the column-resize state + handler (current lines 47–48 `colWidths`/`resizingCol`, 103–124 `handleResizeMouseDown`), the virtualizer setup (138–153), the reset-scroll effect (155–159), the copy-col-name behavior (49–50, 66–71), and the `<table>` JSX (425–534). `colWidths` moves INTO the grid because only the grid and the filter bar read it — pass `colWidths` down to `FilterSortBar` from the grid via a lifted callback, OR keep `colWidths` in the parent. **Decision: keep `colWidths` in the parent** (FilterSortBar already needs it and the new-result reset effect clears it), and pass `colWidths` + `setColWidths` into the grid. The grid owns `resizingCol`, the virtualizer, refs, and `copiedCol`.

```tsx
import { useEffect, useLayoutEffect, useRef, useState } from 'react'
import { useVirtualizer } from '@tanstack/react-virtual'
import { ChevronUp, ChevronDown as ChevronDownIcon } from 'lucide-react'
import type { Neo4jGraphValue } from '@shared/types'
import { formatCell } from '../../lib/formatCell'
import { isGraphElement } from '../../lib/formatGraphElement'
import GraphElementChip from './GraphElementChip'

const MIN_COL_WIDTH = 60
const MAX_COL_WIDTH = 1200
const DEFAULT_COL_WIDTH = 160
const ROW_HEIGHT = 29 // px — fixed; cells are single-line (truncate)

interface ResultsGridProps {
  columns: string[]
  pageRows: Record<string, unknown>[]
  page: number
  /** identity changes when the filtered/sorted window changes — triggers scroll reset */
  resetKey: unknown
  colWidths: Record<string, number>
  setColWidths: React.Dispatch<React.SetStateAction<Record<string, number>>>
  sortCol: string | null
  sortDir: 'asc' | 'desc'
  onToggleSort: (col: string) => void
}

export default function ResultsGrid({
  columns, pageRows, page, resetKey, colWidths, setColWidths, sortCol, sortDir, onToggleSort,
}: ResultsGridProps) {
  const resizingCol = useRef<{ col: string; startX: number; startWidth: number } | null>(null)
  const [copiedCol, setCopiedCol] = useState<string | null>(null)
  const copyTimeoutRef = useRef<ReturnType<typeof setTimeout> | null>(null)
  const scrollRef = useRef<HTMLDivElement>(null)
  const tbodyRef = useRef<HTMLTableSectionElement>(null)
  const [scrollMargin, setScrollMargin] = useState(0)

  useEffect(() => () => {
    if (copyTimeoutRef.current) clearTimeout(copyTimeoutRef.current)
    resizingCol.current = null
  }, [])

  const handleCopyColName = (col: string) => {
    navigator.clipboard.writeText(col)
    if (copyTimeoutRef.current) clearTimeout(copyTimeoutRef.current)
    setCopiedCol(col)
    copyTimeoutRef.current = setTimeout(() => setCopiedCol(null), 1500)
  }

  const handleResizeMouseDown = (e: React.MouseEvent, col: string) => {
    e.preventDefault()
    e.stopPropagation()
    const currentWidth = colWidths[col] ?? DEFAULT_COL_WIDTH
    resizingCol.current = { col, startX: e.clientX, startWidth: currentWidth }
    const onMove = (ev: MouseEvent) => {
      if (!resizingCol.current) return
      const delta = ev.clientX - resizingCol.current.startX
      const newWidth = Math.min(MAX_COL_WIDTH, Math.max(MIN_COL_WIDTH, resizingCol.current.startWidth + delta))
      const c = resizingCol.current.col
      setColWidths((prev) => ({ ...prev, [c]: newWidth }))
    }
    const onUp = () => {
      resizingCol.current = null
      window.removeEventListener('mousemove', onMove)
      window.removeEventListener('mouseup', onUp)
    }
    window.addEventListener('mousemove', onMove)
    window.addEventListener('mouseup', onUp)
  }

  useLayoutEffect(() => {
    const top = tbodyRef.current?.offsetTop ?? 0
    setScrollMargin((prev) => (prev !== top ? top : prev))
  })

  const rowVirtualizer = useVirtualizer({
    count: pageRows.length,
    getScrollElement: () => scrollRef.current,
    estimateSize: () => ROW_HEIGHT,
    overscan: 12,
    scrollMargin,
  })

  useEffect(() => {
    if (scrollRef.current) scrollRef.current.scrollTop = 0
  }, [page, resetKey])

  return (
    <div ref={scrollRef} className="flex-1 overflow-auto selectable results-area">
      <table className="text-xs border-collapse" style={{ tableLayout: 'fixed', width: 'max-content', minWidth: '100%' }}>
        <colgroup>
          {columns.map((col) => (
            <col key={col} style={{ width: colWidths[col] ?? DEFAULT_COL_WIDTH }} />
          ))}
        </colgroup>
        <thead className="sticky top-0 bg-app-bg z-10">
          <tr>
            {columns.map((col) => (
              <th
                key={col}
                className="relative px-3 py-2 text-left text-app-text-2 font-medium border-b border-app-border whitespace-nowrap select-none"
                style={{ width: colWidths[col] ?? DEFAULT_COL_WIDTH }}
              >
                <div className="flex items-center gap-1 pr-2">
                  <span
                    onClick={() => handleCopyColName(col)}
                    title={`Click to copy "${col}"`}
                    className="block truncate cursor-pointer hover:text-app-text transition-colors flex-1 min-w-0"
                  >
                    {copiedCol === col ? '✓ Copied' : col}
                  </span>
                  <button
                    onClick={() => onToggleSort(col)}
                    className={`shrink-0 transition-opacity ${sortCol === col ? 'opacity-100' : 'opacity-0 group-hover:opacity-60'}`}
                    title={sortCol === col ? (sortDir === 'asc' ? 'Sort descending' : 'Remove sort') : `Sort by ${col}`}
                  >
                    {sortCol === col
                      ? (sortDir === 'asc' ? <ChevronUp size={10} className="text-app-accent" /> : <ChevronDownIcon size={10} className="text-app-accent" />)
                      : <ChevronUp size={10} className="text-app-text-3" />
                    }
                  </button>
                </div>
                <div
                  onMouseDown={(e) => handleResizeMouseDown(e, col)}
                  className="absolute right-0 top-0 h-full w-3 flex items-center justify-center cursor-col-resize group z-20"
                >
                  <div className="w-px h-4 bg-app-border group-hover:bg-app-accent transition-colors" />
                </div>
              </th>
            ))}
          </tr>
        </thead>
        <tbody ref={tbodyRef}>
          {(() => {
            const virtualItems = rowVirtualizer.getVirtualItems()
            const totalSize = rowVirtualizer.getTotalSize()
            const paddingTop = virtualItems.length > 0 ? virtualItems[0].start - scrollMargin : 0
            const paddingBottom =
              virtualItems.length > 0
                ? totalSize - (virtualItems[virtualItems.length - 1].end - scrollMargin)
                : 0
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
      </table>
    </div>
  )
}
```

- [ ] **Step 2: Wire into ResultsTable**

In `ResultsTable.tsx`: delete `resizingCol`, `copiedCol`, `copyTimeoutRef` (48–50), `handleCopyColName` (66–71), `handleResizeMouseDown` (103–124), `scrollRef`/`tbodyRef`/`scrollMargin`/the `useLayoutEffect` (138–153), the reset-scroll effect (155–159), and the `<table>` JSX (424–535). In the unmount cleanup effect (57–64), remove the `copyTimeoutRef`/`resizingCol` lines (now owned by the grid) — keep the `copiedTimeoutRef` clear (that belongs to the parent's TSV-copy). Keep `colWidths`/`setColWidths` in the parent (used by FilterSortBar + new-result reset). Remove now-unused lucide icon imports (`ChevronUp`, `ChevronDownIcon`) and the `@tanstack/react-virtual`, `Neo4jGraphValue`, `isGraphElement`, `GraphElementChip`, `formatCell` imports if no longer referenced in the parent (verify with `tsc`).

Add `import ResultsGrid from './ResultsGrid'`. The sort toggle handler moves to a parent callback (it sets sort + page). Define it inline and pass down:

```tsx
      <ResultsGrid
        columns={columns}
        pageRows={pageRows}
        page={page}
        resetKey={filteredRows}
        colWidths={colWidths}
        setColWidths={setColWidths}
        sortCol={sortCol}
        sortDir={sortDir}
        onToggleSort={(col) => {
          if (sortCol === col) {
            if (sortDir === 'asc') setSortDir('desc')
            else { setSortCol(null); setSortDir('asc') }
          } else {
            setSortCol(col); setSortDir('asc')
          }
          setPage(0)
        }}
      />
```

> The `resetKey={filteredRows}` preserves the original effect dependency (`[page, filteredRows]`): a new array identity from filter/sort/new-result resets scroll, exactly as before.

- [ ] **Step 3: Verify** — `npx tsc --noEmit -p tsconfig.web.json` clean; `npx vitest run` → 502 passing.

- [ ] **Step 4: Commit**

```bash
git add src/renderer/src/components/results/ResultsGrid.tsx src/renderer/src/components/results/ResultsTable.tsx
git commit -m "refactor(results): extract virtualized ResultsGrid (TD-3)"
```

---

### Task 6: Extract `ResultsPagination`

**Files:**
- Create: `src/renderer/src/components/results/ResultsPagination.tsx`
- Modify: `src/renderer/src/components/results/ResultsTable.tsx`

**Interfaces:**
- Produces: `ResultsPagination` with the props below.

- [ ] **Step 1: Create `ResultsPagination.tsx`**

Move the pagination-bar block (current lines 538–584).

```tsx
import { ChevronLeft, ChevronRight, Loader2 } from 'lucide-react'

const PAGE_SIZES = [50, 100, 250, 500]

interface ResultsPaginationProps {
  filteredCount: number
  startRow: number
  endRow: number
  displayTotalStr: string
  activeFilterCount: number
  hasMore?: boolean
  serverTotal?: number
  page: number
  totalPages: number
  pageSize: number
  loadingMore: boolean
  onPrev: () => void
  onNext: () => void
  onPageSizeChange: (size: number) => void
  onLastFetchedPage: boolean
  canLoadMore: boolean | undefined
}

export default function ResultsPagination({
  filteredCount, startRow, endRow, displayTotalStr, activeFilterCount, hasMore, serverTotal,
  page, totalPages, pageSize, loadingMore, onPrev, onNext, onPageSizeChange,
  onLastFetchedPage, canLoadMore,
}: ResultsPaginationProps) {
  return (
    <div className="flex items-center justify-between px-3 py-1.5 border-t border-app-border bg-app-surface shrink-0">
      <span className="text-xs text-app-text-3 font-tabular">
        {filteredCount === 0
          ? 'No rows'
          : `${startRow.toLocaleString()}–${endRow.toLocaleString()} of ${activeFilterCount > 0 ? `${filteredCount.toLocaleString()} filtered` : displayTotalStr}`}
        {!activeFilterCount && hasMore && serverTotal == null && '+'}
      </span>

      <div className="flex items-center gap-3">
        <div className="flex items-center gap-1.5">
          <span className="text-xs text-app-text-3">Rows per page</span>
          <select
            value={pageSize}
            onChange={(e) => onPageSizeChange(Number(e.target.value))}
            className="bg-app-elevated text-app-text text-xs rounded px-1.5 py-0.5 border border-app-border focus:outline-none focus:border-app-accent cursor-pointer"
          >
            {PAGE_SIZES.map((s) => (
              <option key={s} value={s}>{s}</option>
            ))}
          </select>
        </div>

        <div className="flex items-center gap-1">
          <button
            onClick={onPrev}
            disabled={page === 0}
            className="p-0.5 rounded text-app-text-2 hover:text-app-text hover:bg-app-elevated disabled:opacity-30 disabled:cursor-not-allowed transition-colors"
          >
            <ChevronLeft size={14} />
          </button>
          <span className="text-xs text-app-text-2 min-w-[60px] text-center font-tabular">
            {loadingMore ? (
              <Loader2 size={12} className="inline animate-spin" />
            ) : (
              `${page + 1} / ${totalPages}${hasMore ? '+' : ''}`
            )}
          </span>
          <button
            onClick={onNext}
            disabled={onLastFetchedPage && !canLoadMore}
            className="p-0.5 rounded text-app-text-2 hover:text-app-text hover:bg-app-elevated disabled:opacity-30 disabled:cursor-not-allowed transition-colors"
          >
            <ChevronRight size={14} />
          </button>
        </div>
      </div>
    </div>
  )
}
```

- [ ] **Step 2: Wire into ResultsTable**

Delete the pagination JSX (538–584). Move `PAGE_SIZES` out of ResultsTable (now lives in the pagination file) — remove it from the parent's constants (line 26). Import `ResultsPagination`. Replace with:

```tsx
      <ResultsPagination
        filteredCount={filteredRows.length}
        startRow={startRow}
        endRow={endRow}
        displayTotalStr={displayTotalStr}
        activeFilterCount={activeFilterCount}
        hasMore={hasMore}
        serverTotal={serverTotal}
        page={page}
        totalPages={totalPages}
        pageSize={pageSize}
        loadingMore={loadingMore}
        onPrev={() => setPage((p) => p - 1)}
        onNext={handleNextPage}
        onPageSizeChange={(size) => { setPageSize(size); setPage(0) }}
        onLastFetchedPage={onLastFetchedPage}
        canLoadMore={canLoadMore}
      />
```

Remove now-unused `ChevronLeft, ChevronRight, Loader2` imports from ResultsTable (verify with `tsc`).

- [ ] **Step 3: Verify** — `npx tsc --noEmit -p tsconfig.web.json` clean; `npx vitest run` → 502 passing.

- [ ] **Step 4: Commit**

```bash
git add src/renderer/src/components/results/ResultsPagination.tsx src/renderer/src/components/results/ResultsTable.tsx
git commit -m "refactor(results): extract ResultsPagination (TD-3)"
```

---

### Task 7: Final cleanup + manual verification

**Files:**
- Modify: `src/renderer/src/components/results/ResultsTable.tsx` (import hygiene only)
- Modify: `CHANGELOG.md`, `CLAUDE.md`

- [ ] **Step 1: Import + lint hygiene**

Confirm `ResultsTable.tsx` is now ~150 lines: it imports the six new children + the two lib formatters, holds state (page, pageSize, loadingMore, copied, copiedTimeoutRef, exporting, colWidths, builderOpen, colFilters, sortCol, sortDir), the new-result reset effect (89–101), the unmount cleanup for `copiedTimeoutRef`, the derivations (`filteredRows`/`pageRows`), the derived counts, `handleNextPage`/`handleExport`/`handleCopy`, the `resultsViewState` early return, and a return that composes `<ResultsToolbar/>`, `{builderOpen && <FilterSortBar/>}`, `<ResultsGrid/>`, `<ResultsPagination/>` inside the `flex flex-col h-full` wrapper. Run:

```bash
npx tsc --noEmit -p tsconfig.web.json
```
Remove any import flagged unused. Confirm no `eslint-disable` was needed.

- [ ] **Step 2: Full CI**

Run: `just ci`
Expected: typecheck clean; 502 + 6 new lib tests pass; coverage gate holds (new `lib/*` formatters sit outside the include set like the other `lib/*` parsers; the new `results/*` components are outside it too).

- [ ] **Step 3: Manual verification (the real safety net)**

Run `just dev`, open a query with results, and verify each interaction is unchanged:
- Run a query → results render; row counts / ms / bytes / "(N fetched)" correct.
- Scroll a large result (≥500 rows) → virtualization smooth, sticky header stays, no row gaps.
- Drag a column border → resize works; filter-bar inputs track the same widths.
- Click a header name → copies, shows "✓ Copied" for ~1.5s.
- Toggle sort on a column (asc → desc → off); page resets to 1.
- Open Filter → type a filter → rows filter, count badge updates, pagination "filtered" label shows; Clear resets.
- Copy (TSV) → clipboard has the filtered/sorted view; "Copied" flips for ~1.5s.
- Export → CSV/TSV/JSON; popover closes on outside click.
- Pin (when `onPin` present) and pagination (prev/next, rows-per-page, server "load more" with the spinner + `+` indicator).
- Running state (live logs autoscroll), cancelled state, error state (+ "Fix with AI" when `onFixWithAI` present), empty state.

Capture a screenshot of a populated results table for the PR.

- [ ] **Step 4: Docs + commit**

Add a CHANGELOG "Changed" line (internal: ResultsTable decomposed into focused units, no behavior change) and a CLAUDE.md change-log entry following the existing format (list the new files + the orchestrator). Then:

```bash
git add CHANGELOG.md CLAUDE.md src/renderer/src/components/results/ResultsTable.tsx
git commit -m "docs: ResultsTable decomposition (TD-3) changelog + change-log"
```

---

## Self-Review notes (for the implementer)

- **Behavior parity is the whole point.** Every moved block keeps its exact classes and logic; only state-vs-prop wiring changes. If `tsc` or the manual checklist reveals a divergence, fix it before moving on.
- **State stays in the orchestrator** except: the export popover open/outside-click (Task 3, local to the toolbar) and the column-resize/copied-col/virtualizer internals (Task 5, local to the grid). These are presentation-only and have no cross-component consumers.
- **`memo` stays only on the default export of `ResultsTable`.** Do not memoize children.
- **`resetKey={filteredRows}`** must be the array identity (not `.length`) to match the original `[page, filteredRows]` effect dependency.
