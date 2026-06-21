# Split View, Result Charts & Clipboard Copy — Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Add (A) copy-results-to-clipboard as TSV, (B) a bar/line/scatter chart view of results with optional aggregation, and (C) a multi-connection split view ("editor groups") where tabs carry their own connection and can be dragged between two side-by-side groups.

**Architecture:** Three independent parts, ordered low-risk → high-risk. Part A and B are isolated to the results panel and pure helpers. Part C replaces today's intra-tab `rightPane` split with a two-group model in `queryStore`: each `QueryTab` gains a `groupId`, the store tracks a focused group and a per-group active tab, and the catalog sidebar follows the focused tab's connection. Pure logic (TSV serialization, chart aggregation, group normalization) lives in unit-tested helpers; React UI follows the existing un-tested-component convention (like `GraphView`).

**Tech Stack:** React + TypeScript, Zustand, Tailwind, CodeMirror, Recharts (new), Vitest.

**Spec:** `docs/superpowers/specs/2026-06-20-split-view-charts-export-design.md`

**Conventions to follow:**
- Pure helpers live in `src/renderer/src/lib/`, tests in `src/__tests__/renderer/lib/`. These sit **outside** the coverage include set (`src/main/db/**`, `src/main/ipc/**`, `src/renderer/src/store/**`) but still get unit tests.
- Store changes ARE coverage-gated (70%) — `queryStore` tests are mandatory.
- Run tests with `npx vitest run <path>` for a single file, `just test` for all, `just typecheck` for `tsc`.
- Commit after each task. Branch is already `claude/vibrant-wozniak-0232d9` (not master) — safe to commit.

---

## PART A — Copy results to clipboard (TSV)

### Task A1: `rowsToTsv` pure helper

**Files:**
- Create: `src/renderer/src/lib/rowsToTsv.ts`
- Test: `src/__tests__/renderer/lib/rowsToTsv.test.ts`

- [ ] **Step 1: Write the failing test**

```ts
// src/__tests__/renderer/lib/rowsToTsv.test.ts
import { describe, it, expect } from 'vitest'
import { rowsToTsv } from '../../../renderer/src/lib/rowsToTsv'

describe('rowsToTsv', () => {
  const cols = ['id', 'name']

  it('emits a header row followed by one line per row, tab-separated', () => {
    const out = rowsToTsv([{ id: 1, name: 'Alice' }, { id: 2, name: 'Bob' }], cols)
    expect(out).toBe('id\tname\n1\tAlice\n2\tBob')
  })

  it('returns just the header when there are no rows', () => {
    expect(rowsToTsv([], cols)).toBe('id\tname')
  })

  it('renders null/undefined as empty cells', () => {
    expect(rowsToTsv([{ id: null, name: undefined }], cols)).toBe('id\tname\n\t')
  })

  it('unwraps BigQuery-style { value } objects, else JSON-stringifies objects', () => {
    const out = rowsToTsv([{ id: { value: '2024-01-01' }, name: { a: 1 } }], cols)
    expect(out).toBe('id\tname\n2024-01-01\t{"a":1}')
  })

  it('replaces embedded tabs and newlines with spaces so structure survives', () => {
    const out = rowsToTsv([{ id: 'a\tb', name: 'c\nd' }], cols)
    expect(out).toBe('id\tname\na b\tc d')
  })

  it('emits cells in column order regardless of object key order', () => {
    const out = rowsToTsv([{ name: 'Alice', id: 1 }], cols)
    expect(out).toBe('id\tname\n1\tAlice')
  })
})
```

- [ ] **Step 2: Run the test to verify it fails**

Run: `npx vitest run src/__tests__/renderer/lib/rowsToTsv.test.ts`
Expected: FAIL — cannot resolve `../../../renderer/src/lib/rowsToTsv`.

- [ ] **Step 3: Write the implementation**

```ts
// src/renderer/src/lib/rowsToTsv.ts

/**
 * Serialize result rows to a TSV string (header + one line per row), suitable
 * for clipboard paste into Google Sheets / Excel. Mirrors ResultsTable's
 * formatCell: BigQuery-style { value } objects are unwrapped, other objects are
 * JSON-stringified, null/undefined become empty cells. Embedded tabs/newlines
 * are flattened to spaces so the row/column structure survives the paste.
 */
export function rowsToTsv(rows: Record<string, unknown>[], columns: string[]): string {
  const cell = (v: unknown): string => {
    if (v === null || v === undefined) return ''
    let s: string
    if (typeof v === 'object') {
      const o = v as Record<string, unknown>
      s = 'value' in o && typeof o.value === 'string' ? o.value : JSON.stringify(v)
    } else {
      s = String(v)
    }
    return s.replace(/\t/g, ' ').replace(/\r?\n/g, ' ')
  }
  const header = columns.join('\t')
  if (rows.length === 0) return header
  const body = rows.map((r) => columns.map((c) => cell(r[c])).join('\t')).join('\n')
  return `${header}\n${body}`
}
```

- [ ] **Step 4: Run the test to verify it passes**

Run: `npx vitest run src/__tests__/renderer/lib/rowsToTsv.test.ts`
Expected: PASS (6 tests).

- [ ] **Step 5: Commit**

```bash
git add src/renderer/src/lib/rowsToTsv.ts src/__tests__/renderer/lib/rowsToTsv.test.ts
git commit -m "feat(results): add rowsToTsv helper for clipboard copy"
```

---

### Task A2: Copy button in ResultsTable status bar

**Files:**
- Modify: `src/renderer/src/components/results/ResultsTable.tsx`

This is a UI-only change (component, not coverage-gated). No new test — verified via typecheck + manual run.

- [ ] **Step 1: Add the import**

In `src/renderer/src/components/results/ResultsTable.tsx`, add to the lucide import on line 3 the `Copy` and `Check` icons, and import the helper. The line 3 import becomes:

```ts
import { ChevronLeft, ChevronRight, Loader2, Download, Copy, Check, Pin, SlidersHorizontal, X, ChevronUp, ChevronDown as ChevronDownIcon, Sparkles } from 'lucide-react'
```

Add below the existing `import { paginate } from '../../lib/paginate'` line:

```ts
import { rowsToTsv } from '../../lib/rowsToTsv'
```

- [ ] **Step 2: Add copied state**

Immediately after the `const [exporting, setExporting] = useState(false)` line (around line 41), add:

```ts
  const [copied, setCopied] = useState(false)
  const copiedTimeoutRef = useRef<ReturnType<typeof setTimeout> | null>(null)
```

Extend the existing unmount cleanup effect (the one that clears `copyTimeoutRef`, around lines 55-60) to also clear this timer:

```ts
  useEffect(() => {
    return () => {
      if (copyTimeoutRef.current) clearTimeout(copyTimeoutRef.current)
      if (copiedTimeoutRef.current) clearTimeout(copiedTimeoutRef.current)
      resizingCol.current = null
    }
  }, [])
```

- [ ] **Step 3: Add the copy handler**

Just after the `handleExport` function (it ends around line 290, before the `return (`), add:

```ts
  const handleCopy = async () => {
    // Copy the current filtered/sorted view across all fetched rows.
    const tsv = rowsToTsv(filteredRows, columns)
    try {
      await navigator.clipboard.writeText(tsv)
      if (copiedTimeoutRef.current) clearTimeout(copiedTimeoutRef.current)
      setCopied(true)
      copiedTimeoutRef.current = setTimeout(() => setCopied(false), 1500)
    } catch {
      // Clipboard can be blocked (permissions); nothing actionable to show here.
    }
  }
```

Note: `filteredRows` and `columns` are both already in scope at this point (`filteredRows` is the memoized filtered/sorted array; `columns` is destructured from `result`).

- [ ] **Step 4: Add the Copy button to the status bar**

In the status bar, immediately BEFORE the Export `<div ref={exportRef} className="relative">` block (around line 341), insert:

```tsx
        {/* Copy to clipboard (TSV) */}
        <button
          onClick={handleCopy}
          disabled={fetchedRows === 0}
          title="Copy results to clipboard (TSV)"
          className="flex items-center gap-1 text-xs px-2 py-0.5 rounded text-app-text-2 hover:text-app-text hover:bg-app-elevated disabled:opacity-40 disabled:cursor-not-allowed transition-colors border border-app-border"
        >
          {copied ? <Check size={11} className="text-app-ok" /> : <Copy size={11} />}
          <span>{copied ? 'Copied' : 'Copy'}</span>
        </button>
```

- [ ] **Step 5: Typecheck and commit**

Run: `just typecheck`
Expected: no errors.

```bash
git add src/renderer/src/components/results/ResultsTable.tsx
git commit -m "feat(results): copy results to clipboard as TSV"
```

---

## PART B — Result charts (bar / line / scatter)

### Task B1: Add Recharts dependency

**Files:**
- Modify: `package.json`

- [ ] **Step 1: Install**

Run: `npm install recharts`
(If the dev app later fails to load native modules, run `just rebuild` — adding a pure-JS dep changes the lockfile, which per project convention can require an electron-rebuild. `just typecheck`/`just test` do not need it.)

- [ ] **Step 2: Verify it's a dependency**

Run: `node -e "console.log(require('./package.json').dependencies.recharts)"`
Expected: prints a version string (not `undefined`).

- [ ] **Step 3: Commit**

```bash
git add package.json package-lock.json
git commit -m "build: add recharts for result charts"
```

---

### Task B2: Chart types in shared/types

**Files:**
- Modify: `src/shared/types.ts`

No standalone test — these types are exercised by B3/B4 and the store tests in B5.

- [ ] **Step 1: Add the chart types**

In `src/shared/types.ts`, immediately AFTER the `GraphData` interface (ends at line 168), add:

```ts
// ── Result charts ────────────────────────────────────────────────────────────

export type ChartAggregate = 'none' | 'sum' | 'avg' | 'count' | 'min' | 'max'

export interface ChartConfig {
  type: 'bar' | 'line' | 'scatter'
  /** Result column used for the X axis (category). */
  xCol: string
  /** Result column used for the Y axis (value). */
  yCol: string
  aggregate: ChartAggregate
}
```

- [ ] **Step 2: Extend QueryTab**

In the `QueryTab` interface, after the `viewAsGraph?: boolean` line (line 201), add:

```ts
  /** Which result surface this tab shows: the data table (default) or a chart. */
  resultView?: 'table' | 'chart'
  /** Persisted chart-builder selection for this tab. */
  chartConfig?: ChartConfig
```

- [ ] **Step 3: Typecheck and commit**

Run: `just typecheck`
Expected: no errors.

```bash
git add src/shared/types.ts
git commit -m "feat(types): add ChartConfig/ChartAggregate and tab chart fields"
```

---

### Task B3: `aggregateForChart` pure helper

**Files:**
- Create: `src/renderer/src/lib/aggregateForChart.ts`
- Test: `src/__tests__/renderer/lib/aggregateForChart.test.ts`

- [ ] **Step 1: Write the failing test**

```ts
// src/__tests__/renderer/lib/aggregateForChart.test.ts
import { describe, it, expect } from 'vitest'
import { aggregateForChart } from '../../../renderer/src/lib/aggregateForChart'

const rows = [
  { month: 'Jan', revenue: 10 },
  { month: 'Jan', revenue: 30 },
  { month: 'Feb', revenue: 20 },
]

describe('aggregateForChart', () => {
  it('aggregate "none" plots one point per row, dropping non-numeric Y', () => {
    const out = aggregateForChart(
      [{ x: 'a', y: 1 }, { x: 'b', y: 'oops' }, { x: 'c', y: 3 }],
      'x', 'y', 'none',
    )
    expect(out).toEqual([{ x: 'a', y: 1 }, { x: 'c', y: 3 }])
  })

  it('SUM groups by X and sums Y, preserving first-seen order', () => {
    expect(aggregateForChart(rows, 'month', 'revenue', 'sum')).toEqual([
      { x: 'Jan', y: 40 },
      { x: 'Feb', y: 20 },
    ])
  })

  it('AVG averages Y per group', () => {
    expect(aggregateForChart(rows, 'month', 'revenue', 'avg')).toEqual([
      { x: 'Jan', y: 20 },
      { x: 'Feb', y: 20 },
    ])
  })

  it('COUNT counts rows per group regardless of Y value', () => {
    const withNulls = [...rows, { month: 'Jan', revenue: null }]
    expect(aggregateForChart(withNulls, 'month', 'revenue', 'count')).toEqual([
      { x: 'Jan', y: 3 },
      { x: 'Feb', y: 1 },
    ])
  })

  it('MIN and MAX reduce Y per group', () => {
    expect(aggregateForChart(rows, 'month', 'revenue', 'min')).toEqual([
      { x: 'Jan', y: 10 },
      { x: 'Feb', y: 20 },
    ])
    expect(aggregateForChart(rows, 'month', 'revenue', 'max')).toEqual([
      { x: 'Jan', y: 30 },
      { x: 'Feb', y: 20 },
    ])
  })

  it('unwraps BigQuery { value } objects for both X labels and Y numbers', () => {
    const bq = [{ d: { value: '2024-01' }, n: { value: '5' } }]
    expect(aggregateForChart(bq, 'd', 'n', 'sum')).toEqual([{ x: '2024-01', y: 5 }])
  })
})
```

- [ ] **Step 2: Run the test to verify it fails**

Run: `npx vitest run src/__tests__/renderer/lib/aggregateForChart.test.ts`
Expected: FAIL — module not found.

- [ ] **Step 3: Write the implementation**

```ts
// src/renderer/src/lib/aggregateForChart.ts
import type { ChartAggregate } from '@shared/types'

export interface ChartDatum {
  x: string
  y: number
}

function toNum(v: unknown): number {
  if (typeof v === 'number') return v
  if (v && typeof v === 'object' && 'value' in (v as Record<string, unknown>)) {
    return Number((v as Record<string, unknown>).value)
  }
  return Number(v)
}

function toLabel(v: unknown): string {
  if (v === null || v === undefined) return ''
  if (typeof v === 'object' && 'value' in (v as Record<string, unknown>)) {
    const inner = (v as Record<string, unknown>).value
    if (typeof inner === 'string') return inner
  }
  return String(v)
}

/**
 * Build chart-ready { x, y } data from result rows.
 * - aggregate === 'none': one datum per row (rows with non-numeric Y are dropped).
 * - otherwise: group rows by X (first-seen order preserved) and reduce Y per group.
 *   COUNT counts rows; SUM/AVG/MIN/MAX ignore non-numeric Y values.
 */
export function aggregateForChart(
  rows: Record<string, unknown>[],
  xCol: string,
  yCol: string,
  aggregate: ChartAggregate,
): ChartDatum[] {
  if (aggregate === 'none') {
    return rows
      .map((r) => ({ x: toLabel(r[xCol]), y: toNum(r[yCol]) }))
      .filter((d) => Number.isFinite(d.y))
  }

  const groups = new Map<string, number[]>()
  for (const r of rows) {
    const key = toLabel(r[xCol])
    if (!groups.has(key)) groups.set(key, [])
    if (aggregate === 'count') {
      groups.get(key)!.push(1)
    } else {
      const n = toNum(r[yCol])
      if (Number.isFinite(n)) groups.get(key)!.push(n)
    }
  }

  const reduce = (vals: number[]): number => {
    if (aggregate === 'count') return vals.length
    if (vals.length === 0) return 0
    switch (aggregate) {
      case 'sum': return vals.reduce((a, b) => a + b, 0)
      case 'avg': return vals.reduce((a, b) => a + b, 0) / vals.length
      case 'min': return Math.min(...vals)
      case 'max': return Math.max(...vals)
      default: return 0
    }
  }

  return Array.from(groups.entries()).map(([x, vals]) => ({ x, y: reduce(vals) }))
}
```

- [ ] **Step 4: Run the test to verify it passes**

Run: `npx vitest run src/__tests__/renderer/lib/aggregateForChart.test.ts`
Expected: PASS (6 tests).

- [ ] **Step 5: Commit**

```bash
git add src/renderer/src/lib/aggregateForChart.ts src/__tests__/renderer/lib/aggregateForChart.test.ts
git commit -m "feat(results): add aggregateForChart helper"
```

---

### Task B4: ChartView component

**Files:**
- Create: `src/renderer/src/components/results/ChartView.tsx`

UI-only (not coverage-gated), like `GraphView`. No unit test; verified by typecheck + run.

- [ ] **Step 1: Create the component**

```tsx
// src/renderer/src/components/results/ChartView.tsx
import { useMemo } from 'react'
import {
  BarChart, Bar, LineChart, Line, ScatterChart, Scatter,
  XAxis, YAxis, CartesianGrid, Tooltip, ResponsiveContainer,
} from 'recharts'
import { Table2 } from 'lucide-react'
import type { QueryResult, ChartConfig, ChartAggregate } from '@shared/types'
import { aggregateForChart } from '../../lib/aggregateForChart'

interface ChartViewProps {
  result: QueryResult
  config: ChartConfig
  onConfigChange: (partial: Partial<ChartConfig>) => void
  /** Switch back to the data table. */
  onShowTable: () => void
}

const CHART_TYPES: ChartConfig['type'][] = ['bar', 'line', 'scatter']
const AGGREGATES: ChartAggregate[] = ['none', 'sum', 'avg', 'count', 'min', 'max']
const ACCENT = 'rgb(196,102,58)' // terracotta — matches --c-accent

export default function ChartView({ result, config, onConfigChange, onShowTable }: ChartViewProps) {
  const data = useMemo(
    () => aggregateForChart(result.rows, config.xCol, config.yCol, config.aggregate),
    [result.rows, config.xCol, config.yCol, config.aggregate],
  )

  const axisProps = { stroke: 'rgb(120,112,104)', fontSize: 11 }

  return (
    <div className="flex flex-col h-full">
      {/* Toolbar */}
      <div className="flex items-center gap-2 px-3 py-1.5 border-b border-app-border bg-app-surface shrink-0 flex-wrap">
        <button
          onClick={onShowTable}
          title="Back to table"
          className="flex items-center gap-1 text-xs px-2 py-0.5 rounded text-app-text-2 hover:text-app-text hover:bg-app-elevated transition-colors border border-app-border"
        >
          <Table2 size={11} /> Table
        </button>

        <div className="app-segmented" style={{ display: 'inline-flex' }}>
          {CHART_TYPES.map((t) => (
            <button key={t} data-active={config.type === t || undefined} onClick={() => onConfigChange({ type: t })}>
              {t[0].toUpperCase() + t.slice(1)}
            </button>
          ))}
        </div>

        <Selector label="X" value={config.xCol} options={result.columns} onChange={(v) => onConfigChange({ xCol: v })} />
        <Selector label="Y" value={config.yCol} options={result.columns} onChange={(v) => onConfigChange({ yCol: v })} />
        <Selector
          label="Aggregate"
          value={config.aggregate}
          options={AGGREGATES}
          onChange={(v) => onConfigChange({ aggregate: v as ChartAggregate })}
          accent
        />
      </div>

      {/* Canvas */}
      <div className="flex-1 min-h-0 p-3 bg-app-bg">
        {data.length === 0 ? (
          <div className="h-full flex items-center justify-center text-app-text-3 text-sm">
            No chartable data for this X/Y selection
          </div>
        ) : (
          <ResponsiveContainer width="100%" height="100%">
            {config.type === 'bar' ? (
              <BarChart data={data}>
                <CartesianGrid strokeDasharray="3 3" stroke="rgb(58,52,46)" />
                <XAxis dataKey="x" {...axisProps} />
                <YAxis {...axisProps} />
                <Tooltip contentStyle={{ background: 'rgb(33,29,25)', border: '1px solid rgb(58,52,46)', fontSize: 12 }} />
                <Bar dataKey="y" fill={ACCENT} />
              </BarChart>
            ) : config.type === 'line' ? (
              <LineChart data={data}>
                <CartesianGrid strokeDasharray="3 3" stroke="rgb(58,52,46)" />
                <XAxis dataKey="x" {...axisProps} />
                <YAxis {...axisProps} />
                <Tooltip contentStyle={{ background: 'rgb(33,29,25)', border: '1px solid rgb(58,52,46)', fontSize: 12 }} />
                <Line type="monotone" dataKey="y" stroke={ACCENT} dot={false} />
              </LineChart>
            ) : (
              <ScatterChart>
                <CartesianGrid strokeDasharray="3 3" stroke="rgb(58,52,46)" />
                <XAxis dataKey="x" {...axisProps} />
                <YAxis dataKey="y" {...axisProps} />
                <Tooltip contentStyle={{ background: 'rgb(33,29,25)', border: '1px solid rgb(58,52,46)', fontSize: 12 }} />
                <Scatter data={data} fill={ACCENT} />
              </ScatterChart>
            )}
          </ResponsiveContainer>
        )}
      </div>
    </div>
  )
}

function Selector({
  label, value, options, onChange, accent,
}: {
  label: string
  value: string
  options: readonly string[]
  onChange: (v: string) => void
  accent?: boolean
}) {
  return (
    <label className="flex items-center gap-1 text-xs text-app-text-3">
      <span className="app-section-label">{label}</span>
      <select
        value={value}
        onChange={(e) => onChange(e.target.value)}
        className={`bg-app-elevated text-app-text text-xs rounded px-1.5 py-0.5 border focus:outline-none cursor-pointer ${
          accent ? 'border-app-accent/50 text-app-accent-text' : 'border-app-border focus:border-app-accent'
        }`}
      >
        {options.map((o) => (
          <option key={o} value={o}>{o}</option>
        ))}
      </select>
    </label>
  )
}
```

- [ ] **Step 2: Typecheck**

Run: `just typecheck`
Expected: no errors.

- [ ] **Step 3: Commit**

```bash
git add src/renderer/src/components/results/ChartView.tsx
git commit -m "feat(results): add ChartView (bar/line/scatter) component"
```

---

### Task B5: Store actions for chart view + config

**Files:**
- Modify: `src/renderer/src/store/queryStore.ts`
- Modify: `src/__tests__/renderer/store/queryStore.test.ts`

Store IS coverage-gated — tests required.

- [ ] **Step 1: Write the failing tests**

Add this `describe` block inside the top-level `describe('queryStore', ...)` in `src/__tests__/renderer/store/queryStore.test.ts`, just before its closing `})` (after the `toggleGraphView` block):

```ts
  describe('chart view', () => {
    it('setResultView sets the view on the targeted tab only', () => {
      const id = useQueryStore.getState().openTab({ sql: 'SELECT 1', connectionId: 'c' })
      const other = useQueryStore.getState().openTab({ sql: 'SELECT 2', connectionId: 'c' })

      useQueryStore.getState().setResultView(id, 'chart')

      expect(useQueryStore.getState().tabs.find((t) => t.id === id)?.resultView).toBe('chart')
      expect(useQueryStore.getState().tabs.find((t) => t.id === other)?.resultView).toBeUndefined()
    })

    it('setChartConfig stores the config on the targeted tab', () => {
      const id = useQueryStore.getState().openTab({ sql: 'SELECT 1', connectionId: 'c' })
      const cfg = { type: 'bar' as const, xCol: 'month', yCol: 'revenue', aggregate: 'sum' as const }

      useQueryStore.getState().setChartConfig(id, cfg)

      expect(useQueryStore.getState().tabs.find((t) => t.id === id)?.chartConfig).toEqual(cfg)
    })
  })
```

- [ ] **Step 2: Run to verify failure**

Run: `npx vitest run src/__tests__/renderer/store/queryStore.test.ts -t "chart view"`
Expected: FAIL — `setResultView`/`setChartConfig` not a function.

- [ ] **Step 3: Implement the actions**

In `src/renderer/src/store/queryStore.ts`:

Add to the imports at the top:

```ts
import type { ConnectionEngine, QueryTab, QueryResult, ChartConfig } from '@shared/types'
```
(Replace the existing `import type { ConnectionEngine, QueryPane, QueryTab, QueryResult } from '@shared/types'` — note `QueryPane` is removed; it's no longer used after Part C, but in Part B we keep the file compiling by only removing `QueryPane` in Part C. For THIS task, instead add `ChartConfig` while leaving `QueryPane` in place:)

```ts
import type { ConnectionEngine, QueryPane, QueryTab, QueryResult, ChartConfig } from '@shared/types'
```

Add to the `QueryState` interface (after `toggleGraphView`):

```ts
  setResultView: (id: string, view: 'table' | 'chart') => void
  setChartConfig: (id: string, config: ChartConfig) => void
```

Add the implementations right after the `toggleGraphView` implementation:

```ts
  setResultView: (id, view) => {
    set((s) => ({ tabs: s.tabs.map((t) => (t.id === id ? { ...t, resultView: view } : t)) }))
  },

  setChartConfig: (id, config) => {
    set((s) => ({ tabs: s.tabs.map((t) => (t.id === id ? { ...t, chartConfig: config } : t)) }))
  },
```

- [ ] **Step 4: Run to verify pass**

Run: `npx vitest run src/__tests__/renderer/store/queryStore.test.ts -t "chart view"`
Expected: PASS (2 tests).

- [ ] **Step 5: Commit**

```bash
git add src/renderer/src/store/queryStore.ts src/__tests__/renderer/store/queryStore.test.ts
git commit -m "feat(store): setResultView and setChartConfig actions"
```

---

### Task B6: Wire Table/Chart toggle into ResultsRegion

**Files:**
- Modify: `src/renderer/src/components/results/ResultsRegion.tsx`

UI-only. No unit test.

- [ ] **Step 1: Replace the file contents**

Replace `src/renderer/src/components/results/ResultsRegion.tsx` entirely with:

```tsx
import { memo, useCallback, useMemo } from 'react'
import { BarChart3 } from 'lucide-react'
import { useShallow } from 'zustand/react/shallow'
import { useQueryStore } from '../../store/queryStore'
import { useChatStore } from '../../store/chatStore'
import ResultsTable from './ResultsTable'
import ChartView from './ChartView'
import ExplainPanel from './ExplainPanel'
import GraphView from './GraphView'
import GraphShapedBanner from './GraphShapedBanner'
import { detectGraphShape } from '../../lib/detectGraphShape'
import { buildGraphFromRecords } from '../../lib/buildGraphFromRecords'
import type { ChartConfig } from '@shared/types'

/**
 * The results area of a query tab: explain plan > graph view > (table | chart).
 * Subscribes only to the active tab's result-relevant fields.
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
        resultView: t?.resultView ?? 'table',
        chartConfig: t?.chartConfig,
      }
    }),
  )
  const fetchPage = useQueryStore((s) => s.fetchPage)
  const openResultTab = useQueryStore((s) => s.openResultTab)
  const toggleGraphView = useQueryStore((s) => s.toggleGraphView)
  const clearExplain = useQueryStore((s) => s.clearExplain)
  const setResultView = useQueryStore((s) => s.setResultView)
  const setChartConfig = useQueryStore((s) => s.setChartConfig)
  const requestFix = useChatStore((s) => s.requestFix)

  const handleFetchPage = useCallback(() => fetchPage(tabId), [fetchPage, tabId])
  const handlePin = useCallback(() => openResultTab(tabId), [openResultTab, tabId])
  const handleFixWithAI = useCallback(() => {
    const t = useQueryStore.getState().tabs.find((x) => x.id === tabId)
    if (!t?.error) return
    requestFix(t.sql, t.error)
  }, [requestFix, tabId])

  const graphShape = useMemo(() => {
    const rows = tab.result?.rows
    if (!rows || rows.length === 0) return { isGraph: false, truncated: false, nodeCount: 0 }
    if (!detectGraphShape(rows)) return { isGraph: false, truncated: false, nodeCount: 0 }
    const built = buildGraphFromRecords(rows)
    if (built.truncated) return { isGraph: true, truncated: true, nodeCount: built.nodeCount }
    return { isGraph: true, truncated: false, nodeCount: built.nodes.length }
  }, [tab.result?.rows])

  // Default chart config: first column as X, first column as Y, no aggregation.
  const defaultConfig = useCallback((): ChartConfig => {
    const cols = tab.result?.columns ?? []
    return { type: 'bar', xCol: cols[0] ?? '', yCol: cols[1] ?? cols[0] ?? '', aggregate: 'none' }
  }, [tab.result?.columns])

  const handleShowChart = useCallback(() => {
    if (!useQueryStore.getState().tabs.find((t) => t.id === tabId)?.chartConfig) {
      setChartConfig(tabId, defaultConfig())
    }
    setResultView(tabId, 'chart')
  }, [tabId, setChartConfig, setResultView, defaultConfig])

  const handleConfigChange = useCallback((partial: Partial<ChartConfig>) => {
    const current = useQueryStore.getState().tabs.find((t) => t.id === tabId)?.chartConfig
    setChartConfig(tabId, { ...defaultConfig(), ...current, ...partial })
  }, [tabId, setChartConfig, defaultConfig])

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

  // Chart view — only meaningful with a result and not on graph-shaped (Neo4j) data.
  if (tab.resultView === 'chart' && tab.result && !graphShape.isGraph) {
    return (
      <ChartView
        result={tab.result}
        config={tab.chartConfig ?? defaultConfig()}
        onConfigChange={handleConfigChange}
        onShowTable={() => setResultView(tabId, 'table')}
      />
    )
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
      {/* Chart toggle — shown when there is a non-graph result to plot */}
      {tab.result && !graphShape.isGraph && tab.result.rows.length > 0 && (
        <div className="flex items-center justify-end px-3 py-1 border-b border-app-border bg-app-surface shrink-0">
          <button
            onClick={handleShowChart}
            title="Visualize as chart"
            className="flex items-center gap-1 text-xs px-2 py-0.5 rounded text-app-text-2 hover:text-app-text hover:bg-app-elevated transition-colors border border-app-border"
          >
            <BarChart3 size={11} /> Chart
          </button>
        </div>
      )}
      <ResultsTable
        result={tab.result}
        error={tab.error}
        isRunning={tab.isRunning}
        cancelled={tab.cancelled}
        logs={tab.logs}
        onFetchPage={handleFetchPage}
        onPin={handlePin}
        onFixWithAI={handleFixWithAI}
      />
    </>
  )
}

export default memo(ResultsRegion)
```

- [ ] **Step 2: Typecheck + full test run**

Run: `just typecheck && just test`
Expected: typecheck clean; all tests pass (Part A + B additions included).

- [ ] **Step 3: Commit**

```bash
git add src/renderer/src/components/results/ResultsRegion.tsx
git commit -m "feat(results): Table/Chart toggle in results region"
```

---

## PART C — Multi-connection split view (editor groups)

> This part replaces the intra-tab `rightPane` split with two editor groups. It touches the store (coverage-gated), `Editor.tsx`, `EditorPane.tsx`, `QueryEditor.tsx`, and `TitleBar.tsx`. Do the store first (C1–C2), then the UI (C3–C6).

### Task C1: Rewrite queryStore for editor groups

**Files:**
- Modify: `src/renderer/src/store/queryStore.ts`
- Modify: `src/__tests__/renderer/store/queryStore.test.ts`

- [ ] **Step 1: Replace the split-pane tests with group tests**

In `src/__tests__/renderer/store/queryStore.test.ts`:

1. DELETE the entire `describe('split pane', () => { ... })` block (lines ~352-515, covering `toggleSplit` / `updateRightPaneSql` / `runRightPane` / `cancelRightPane`).

2. In place of it, add:

```ts
  describe('editor groups', () => {
    it('new tabs land in the focused group (left by default)', () => {
      const id = useQueryStore.getState().openTab({ connectionId: 'c1' })
      const tab = useQueryStore.getState().tabs.find((t) => t.id === id)!
      expect(tab.groupId).toBe('left')
      expect(useQueryStore.getState().focusedGroup).toBe('left')
      expect(useQueryStore.getState().activeTabId).toBe(id)
    })

    it('splitGroup opens a fresh tab in the right group inheriting the focused connection', () => {
      const left = useQueryStore.getState().openTab({ connectionId: 'c1', sql: 'SELECT 1' })
      useQueryStore.getState().splitGroup()

      const s = useQueryStore.getState()
      const right = s.tabs.find((t) => t.groupId === 'right')!
      expect(right).toBeDefined()
      expect(right.connectionId).toBe('c1')
      expect(s.focusedGroup).toBe('right')
      expect(s.activeTabId).toBe(right.id)
      // Left tab untouched
      expect(s.tabs.find((t) => t.id === left)!.groupId).toBe('left')
    })

    it('moveTabToGroup moves a tab to the other group keeping its connection', () => {
      const a = useQueryStore.getState().openTab({ connectionId: 'c1' })
      const b = useQueryStore.getState().openTab({ connectionId: 'c2' })

      useQueryStore.getState().moveTabToGroup(b, 'right')

      const s = useQueryStore.getState()
      expect(s.tabs.find((t) => t.id === b)!.groupId).toBe('right')
      expect(s.tabs.find((t) => t.id === b)!.connectionId).toBe('c2')
      expect(s.tabs.find((t) => t.id === a)!.groupId).toBe('left')
      expect(s.focusedGroup).toBe('right')
      expect(s.activeByGroup.right).toBe(b)
    })

    it('moveTabToGroup with a beforeId reorders within the same group', () => {
      const a = useQueryStore.getState().openTab({ connectionId: 'c1' })
      const b = useQueryStore.getState().openTab({ connectionId: 'c1' })
      // a, b on left. Move b before a.
      useQueryStore.getState().moveTabToGroup(b, 'left', a)
      const leftIds = useQueryStore.getState().tabs.filter((t) => t.groupId === 'left').map((t) => t.id)
      expect(leftIds).toEqual([b, a])
    })

    it('collapses the right group back to a single layout when its last tab leaves', () => {
      const left = useQueryStore.getState().openTab({ connectionId: 'c1' })
      useQueryStore.getState().splitGroup()
      const right = useQueryStore.getState().activeByGroup.right!

      useQueryStore.getState().closeTab(right)

      const s = useQueryStore.getState()
      expect(s.tabs.some((t) => t.groupId === 'right')).toBe(false)
      expect(s.focusedGroup).toBe('left')
      expect(s.activeTabId).toBe(left)
    })

    it('promotes the right group to left if all left tabs are moved away', () => {
      const a = useQueryStore.getState().openTab({ connectionId: 'c1' })
      useQueryStore.getState().splitGroup()
      // Now: a on left, fresh tab on right. Move a to the right too.
      useQueryStore.getState().moveTabToGroup(a, 'right')

      const s = useQueryStore.getState()
      // Left empty -> everything normalized back to 'left'
      expect(s.tabs.every((t) => t.groupId === 'left')).toBe(true)
      expect(s.focusedGroup).toBe('left')
    })

    it('focusGroup switches the focused group and updates activeTabId', () => {
      const left = useQueryStore.getState().openTab({ connectionId: 'c1' })
      useQueryStore.getState().splitGroup()
      const right = useQueryStore.getState().activeByGroup.right!

      useQueryStore.getState().focusGroup('left')
      expect(useQueryStore.getState().activeTabId).toBe(left)

      useQueryStore.getState().focusGroup('right')
      expect(useQueryStore.getState().activeTabId).toBe(right)
    })

    it('setTabConnection changes only the targeted tab connection', () => {
      const a = useQueryStore.getState().openTab({ connectionId: 'c1' })
      const b = useQueryStore.getState().openTab({ connectionId: 'c1' })

      useQueryStore.getState().setTabConnection(a, 'c9')

      expect(useQueryStore.getState().tabs.find((t) => t.id === a)!.connectionId).toBe('c9')
      expect(useQueryStore.getState().tabs.find((t) => t.id === b)!.connectionId).toBe('c1')
    })
  })
```

3. The existing `closeTab` test "activates the last remaining tab when the active one is closed" still holds (both tabs are on left; closing the active one falls back to the last remaining left tab). Leave it.

- [ ] **Step 2: Run to verify failure**

Run: `npx vitest run src/__tests__/renderer/store/queryStore.test.ts`
Expected: FAIL — `focusedGroup`/`activeByGroup`/`splitGroup`/`moveTabToGroup`/`focusGroup`/`setTabConnection` undefined.

- [ ] **Step 3: Replace queryStore.ts**

Replace `src/renderer/src/store/queryStore.ts` entirely with:

```ts
import { create } from 'zustand'
import { CHANNELS } from '@shared/ipc'
import type { ConnectionEngine, QueryTab, QueryResult, ChartConfig } from '@shared/types'

export type GroupId = 'left' | 'right'

interface QueryState {
  tabs: QueryTab[]
  /** Mirror of activeByGroup[focusedGroup] — the globally "active" tab. */
  activeTabId: string | null
  focusedGroup: GroupId
  activeByGroup: Record<GroupId, string | null>

  openTab: (partial?: Partial<Omit<QueryTab, 'id' | 'isRunning' | 'logs'>>) => string
  openResultTab: (sourceTabId: string) => void
  openTableTab: (
    connectionId: string,
    engine: ConnectionEngine,
    projectId: string,
    datasetId: string,
    tableId: string,
    tableName: string
  ) => void
  closeTab: (id: string) => void
  setActiveTab: (id: string) => void
  updateTabSql: (id: string, sql: string) => void
  runQuery: (id: string) => Promise<void>
  cancelQuery: (id: string) => Promise<void>
  explainQuery: (id: string) => Promise<void>
  clearExplain: (id: string) => void
  fetchPage: (id: string) => Promise<void>
  toggleGraphView: (id: string) => void
  setResultView: (id: string, view: 'table' | 'chart') => void
  setChartConfig: (id: string, config: ChartConfig) => void
  // Editor groups
  focusGroup: (group: GroupId) => void
  moveTabToGroup: (tabId: string, target: GroupId, beforeId?: string) => void
  splitGroup: () => void
  setTabConnection: (tabId: string, connectionId: string) => void
}

/**
 * Recompute group invariants after any mutation to `tabs`:
 * - If the left group is empty but the right has tabs, promote right → left
 *   (a single group is always 'left').
 * - Each group's active tab must still exist in that group, else fall back to
 *   the last tab in the group (or null).
 * - The focused group must be non-empty, else fall back to 'left'.
 * - activeTabId mirrors activeByGroup[focusedGroup].
 */
function normalizeGroups(
  tabs: QueryTab[],
  focusedGroup: GroupId,
  activeByGroup: Record<GroupId, string | null>,
): Pick<QueryState, 'tabs' | 'focusedGroup' | 'activeByGroup' | 'activeTabId'> {
  let t = tabs
  let fg = focusedGroup
  let abg = activeByGroup

  const hasLeft = t.some((x) => x.groupId === 'left')
  const hasRight = t.some((x) => x.groupId === 'right')
  if (!hasLeft && hasRight) {
    t = t.map((x) => ({ ...x, groupId: 'left' as GroupId }))
    abg = { left: activeByGroup.right, right: null }
    fg = 'left'
  }

  const lastOf = (g: GroupId): string | null => {
    for (let i = t.length - 1; i >= 0; i--) if (t[i].groupId === g) return t[i].id
    return null
  }
  const validFor = (g: GroupId, id: string | null) => !!id && t.some((x) => x.id === id && x.groupId === g)

  const left = validFor('left', abg.left) ? abg.left : lastOf('left')
  const right = validFor('right', abg.right) ? abg.right : lastOf('right')
  const nextAbg: Record<GroupId, string | null> = { left, right }

  if (!t.some((x) => x.groupId === fg)) fg = 'left'

  return { tabs: t, focusedGroup: fg, activeByGroup: nextAbg, activeTabId: nextAbg[fg] }
}

export const useQueryStore = create<QueryState>((set, get) => ({
  tabs: [],
  activeTabId: null,
  focusedGroup: 'left',
  activeByGroup: { left: null, right: null },

  openTab: (partial = {}) => {
    const id = crypto.randomUUID()
    const s = get()
    const fg = s.focusedGroup
    const inheritConn = s.tabs.find((t) => t.id === s.activeByGroup[fg])?.connectionId
    const tab: QueryTab = {
      id, title: 'Untitled', sql: '', isRunning: false, logs: [],
      groupId: fg, connectionId: inheritConn, ...partial,
    }
    set((st) => ({
      tabs: [...st.tabs, tab],
      activeByGroup: { ...st.activeByGroup, [fg]: id },
      activeTabId: id,
    }))
    return id
  },

  openResultTab: (sourceTabId) => {
    const source = get().tabs.find((t) => t.id === sourceTabId)
    if (!source?.result) return
    const id = crypto.randomUUID()
    const preview = source.sql.replace(/\s+/g, ' ').trim().slice(0, 28)
    const title = `📌 ${preview}${source.sql.trim().length > 28 ? '…' : ''}`
    const fg = get().focusedGroup
    const tab: QueryTab = {
      id, type: 'result', title, sql: source.sql, connectionId: source.connectionId,
      result: source.result, isRunning: false, logs: [], groupId: fg,
    }
    set((s) => ({
      tabs: [...s.tabs, tab],
      activeByGroup: { ...s.activeByGroup, [fg]: id },
      activeTabId: id,
    }))
  },

  openTableTab: (connectionId, engine, projectId, datasetId, tableId, tableName) => {
    const { tabs } = get()
    const existing = tabs.find(
      (t) =>
        t.type === 'table' &&
        t.connectionId === connectionId &&
        t.tableRef?.engine === engine &&
        t.tableRef?.tableId === tableId &&
        t.tableRef?.datasetId === datasetId
    )
    if (existing) {
      get().setActiveTab(existing.id)
      return
    }
    const id = crypto.randomUUID()
    const fg = get().focusedGroup
    const tab: QueryTab = {
      id, type: 'table', title: tableName, sql: '', connectionId,
      tableRef: { engine, projectId, datasetId, tableId },
      isRunning: false, logs: [], groupId: fg,
    }
    set((s) => ({
      tabs: [...s.tabs, tab],
      activeByGroup: { ...s.activeByGroup, [fg]: id },
      activeTabId: id,
    }))
  },

  closeTab: (id) => {
    set((s) => normalizeGroups(s.tabs.filter((t) => t.id !== id), s.focusedGroup, s.activeByGroup))
  },

  setActiveTab: (id) => {
    set((s) => {
      const tab = s.tabs.find((t) => t.id === id)
      if (!tab) return s
      const fg = (tab.groupId ?? 'left') as GroupId
      return { focusedGroup: fg, activeByGroup: { ...s.activeByGroup, [fg]: id }, activeTabId: id }
    })
  },

  focusGroup: (group) => {
    set((s) => ({ focusedGroup: group, activeTabId: s.activeByGroup[group] }))
  },

  moveTabToGroup: (tabId, target, beforeId) => {
    set((s) => {
      const moving = s.tabs.find((t) => t.id === tabId)
      if (!moving) return s
      let rest = s.tabs.filter((t) => t.id !== tabId)
      const moved: QueryTab = { ...moving, groupId: target }
      if (beforeId) {
        const idx = rest.findIndex((t) => t.id === beforeId)
        rest = idx === -1 ? [...rest, moved] : [...rest.slice(0, idx), moved, ...rest.slice(idx)]
      } else {
        rest = [...rest, moved]
      }
      return normalizeGroups(rest, target, { ...s.activeByGroup, [target]: tabId })
    })
  },

  splitGroup: () => {
    set((s) => {
      const id = crypto.randomUUID()
      const inheritConn = s.tabs.find((t) => t.id === s.activeByGroup[s.focusedGroup])?.connectionId
      const tab: QueryTab = {
        id, title: 'Untitled', sql: '', isRunning: false, logs: [],
        groupId: 'right', connectionId: inheritConn,
      }
      return normalizeGroups([...s.tabs, tab], 'right', { ...s.activeByGroup, right: id })
    })
  },

  setTabConnection: (tabId, connectionId) => {
    set((s) => ({ tabs: s.tabs.map((t) => (t.id === tabId ? { ...t, connectionId } : t)) }))
  },

  updateTabSql: (id, sql) => {
    set((s) => ({ tabs: s.tabs.map((t) => (t.id === id ? { ...t, sql } : t)) }))
  },

  runQuery: async (id) => {
    const tab = get().tabs.find((t) => t.id === id)
    if (!tab || !tab.connectionId || !tab.sql.trim()) return

    set((s) => ({
      tabs: s.tabs.map((t) =>
        t.id === id
          ? { ...t, isRunning: true, cancelled: false, error: undefined, result: undefined, logs: [] }
          : t
      )
    }))

    try {
      const result: QueryResult = await window.api.invoke(CHANNELS.QUERY_EXECUTE, {
        connectionId: tab.connectionId, sql: tab.sql, tabId: id,
      })
      set((s) => ({ tabs: s.tabs.map((t) => (t.id === id ? { ...t, isRunning: false, result } : t)) }))
    } catch (err) {
      set((s) => {
        const currentTab = s.tabs.find((t) => t.id === id)
        return {
          tabs: s.tabs.map((t) =>
            t.id === id
              ? { ...t, isRunning: false, error: currentTab?.cancelled ? undefined : (err as Error).message }
              : t
          )
        }
      })
    }
  },

  cancelQuery: async (id) => {
    set((s) => ({ tabs: s.tabs.map((t) => (t.id === id ? { ...t, cancelled: true } : t)) }))
    await window.api.invoke(CHANNELS.QUERY_CANCEL, id)
  },

  explainQuery: async (id) => {
    const tab = get().tabs.find((t) => t.id === id)
    if (!tab || !tab.connectionId || !tab.sql.trim()) return

    set((s) => ({
      tabs: s.tabs.map((t) => (t.id === id ? { ...t, isExplaining: true, explainResult: undefined } : t))
    }))

    try {
      const result = await window.api.invoke(CHANNELS.QUERY_DRY_RUN, {
        connectionId: tab.connectionId, sql: tab.sql,
      })
      set((s) => ({
        tabs: s.tabs.map((t) => (t.id === id ? { ...t, isExplaining: false, explainResult: result } : t))
      }))
    } catch (err) {
      set((s) => ({
        tabs: s.tabs.map((t) => (t.id === id ? { ...t, isExplaining: false, error: (err as Error).message } : t))
      }))
    }
  },

  clearExplain: (id) => {
    set((s) => ({ tabs: s.tabs.map((t) => (t.id === id ? { ...t, explainResult: undefined } : t)) }))
  },

  toggleGraphView: (id) => {
    set((s) => ({ tabs: s.tabs.map((t) => (t.id === id ? { ...t, viewAsGraph: !t.viewAsGraph } : t)) }))
  },

  setResultView: (id, view) => {
    set((s) => ({ tabs: s.tabs.map((t) => (t.id === id ? { ...t, resultView: view } : t)) }))
  },

  setChartConfig: (id, config) => {
    set((s) => ({ tabs: s.tabs.map((t) => (t.id === id ? { ...t, chartConfig: config } : t)) }))
  },

  fetchPage: async (id) => {
    const tab = get().tabs.find((t) => t.id === id)
    if (!tab?.result?.pageToken) return

    try {
      const page: QueryResult = await window.api.invoke(CHANNELS.QUERY_GET_PAGE, {
        tabId: id, pageToken: tab.result.pageToken,
      })
      set((s) => ({
        tabs: s.tabs.map((t) => {
          if (t.id !== id || !t.result) return t
          return {
            ...t,
            result: {
              ...t.result,
              rows: [...t.result.rows, ...page.rows],
              rowCount: t.result.rows.length + page.rows.length,
              pageToken: page.pageToken,
              hasMore: page.hasMore,
              totalRows: page.totalRows ?? t.result.totalRows,
            }
          }
        })
      }))
    } catch (err) {
      console.error('Failed to fetch page:', err)
    }
  }
}))

// ── Global QUERY_LOG push listener ──────────────────────────────────────────
// Main process sends { tabId, message }; append a timestamped line to the tab.
window.api.on(CHANNELS.QUERY_LOG, (data: unknown) => {
  const { tabId, message } = data as { tabId: string; message: string }
  const now = new Date()
  const ts = `${String(now.getHours()).padStart(2, '0')}:${String(now.getMinutes()).padStart(2, '0')}:${String(now.getSeconds()).padStart(2, '0')}`
  useQueryStore.setState((s) => ({
    tabs: s.tabs.map((t) => (t.id === tabId ? { ...t, logs: [...t.logs, `${ts}  ${message}`] } : t))
  }))
})
```

- [ ] **Step 4: Add `groupId` to the QueryTab type**

In `src/shared/types.ts`, in the `QueryTab` interface, add after the `id: string` line:

```ts
  /** Which editor group this tab belongs to. Defaults to 'left'. */
  groupId?: 'left' | 'right'
```

Also REMOVE the now-dead `QueryPane` interface (lines 170-178) and the `rightPane?: QueryPane` field on `QueryTab` (line 196). Search the repo for other `QueryPane` / `rightPane` references to confirm none remain outside `Editor.tsx` (handled in C3):

Run: `grep -rn "QueryPane\|rightPane" src/ --include=*.ts --include=*.tsx`
Expected after C3: only matches are the ones you're about to fix in `Editor.tsx`. For now (C1) `Editor.tsx` still references them and will not typecheck until C3 — that's expected; do not run `just typecheck` to "pass" until C3.

- [ ] **Step 5: Run the store tests**

Run: `npx vitest run src/__tests__/renderer/store/queryStore.test.ts`
Expected: PASS (all existing non-split tests + the new `editor groups` and `chart view` blocks). Note `just typecheck` will still fail repo-wide because `Editor.tsx` is not yet updated — that is fixed in C3.

- [ ] **Step 6: Commit**

```bash
git add src/renderer/src/store/queryStore.ts src/__tests__/renderer/store/queryStore.test.ts src/shared/types.ts
git commit -m "feat(store): editor-groups model; remove rightPane split"
```

---

### Task C2: Connection picker in QueryEditor toolbar

**Files:**
- Modify: `src/renderer/src/components/editor/QueryEditor.tsx`

UI-only.

- [ ] **Step 1: Add props**

In `QueryEditorProps` (after `engine?: ConnectionEngine`), add:

```ts
  /** Connections for the per-tab connection picker. Omit to hide the picker. */
  connections?: { id: string; name: string; engine: ConnectionEngine }[]
  connectionId?: string
  onConnectionChange?: (id: string) => void
```

Add the three to the destructured params in the function signature:

```ts
function QueryEditor({
  value, onChange, onRun, onCancel, onExplain, onSave, onSplit, isSplit, isRunning, isExplaining, savedQueryId, sqlSchema, cypherSchema, engine,
  connections, connectionId, onConnectionChange,
}: QueryEditorProps) {
```

- [ ] **Step 2: Render the picker**

Replace the toolbar's left side — the line `<span className="app-section-label">SQL</span>` (line 142) — with:

```tsx
        {connections && connections.length > 0 ? (
          <select
            value={connectionId ?? ''}
            onChange={(e) => onConnectionChange?.(e.target.value)}
            title="Connection for this tab"
            className="bg-app-elevated text-app-text text-xs rounded px-1.5 py-0.5 border border-app-border focus:outline-none focus:border-app-accent cursor-pointer max-w-[180px]"
          >
            {connectionId === undefined || connections.every((c) => c.id !== connectionId) ? (
              <option value="">No connection</option>
            ) : null}
            {connections.map((c) => (
              <option key={c.id} value={c.id}>{c.name}</option>
            ))}
          </select>
        ) : (
          <span className="app-section-label">SQL</span>
        )}
```

- [ ] **Step 3: Typecheck**

Run: `just typecheck`
Expected: still fails on `Editor.tsx` only (rightPane). QueryEditor itself compiles. Proceed to C3.

- [ ] **Step 4: Commit**

```bash
git add src/renderer/src/components/editor/QueryEditor.tsx
git commit -m "feat(editor): per-tab connection picker in QueryEditor toolbar"
```

---

### Task C3: EditorPane — derive engine + wire connection picker

**Files:**
- Modify: `src/renderer/src/components/editor/EditorPane.tsx`

UI-only.

- [ ] **Step 1: Replace the file contents**

```tsx
import { memo, useCallback, useMemo, useState } from 'react'
import { useShallow } from 'zustand/react/shallow'
import { useQueryStore } from '../../store/queryStore'
import { useConnectionStore } from '../../store/connectionStore'
import { detectMissingLimit } from '../../lib/detectMissingLimit'
import QueryEditor from './QueryEditor'
import LimitWarningBanner from './LimitWarningBanner'
import type { CypherSchema } from '../../lib/cypherLanguage'

interface EditorPaneProps {
  tabId: string
  sqlSchema?: Record<string, string[]>
  cypherSchema?: CypherSchema
  isSplit: boolean
  onSplit: () => void
  onSave: () => void
}

/**
 * The editor half of a query tab: CodeMirror + toolbar + auto-limit banner.
 * Engine is derived from the tab's own connection so split groups on different
 * engines each get the right language/dialect.
 */
function EditorPane({ tabId, sqlSchema, cypherSchema, isSplit, onSplit, onSave }: EditorPaneProps) {
  const { sql, isRunning, isExplaining, savedQueryId, connectionId } = useQueryStore(
    useShallow((s) => {
      const t = s.tabs.find((x) => x.id === tabId)
      return {
        sql: t?.sql ?? '',
        isRunning: t?.isRunning ?? false,
        isExplaining: t?.isExplaining,
        savedQueryId: t?.savedQueryId,
        connectionId: t?.connectionId,
      }
    }),
  )
  const updateTabSql = useQueryStore((s) => s.updateTabSql)
  const runQuery = useQueryStore((s) => s.runQuery)
  const cancelQuery = useQueryStore((s) => s.cancelQuery)
  const explainQuery = useQueryStore((s) => s.explainQuery)
  const clearExplain = useQueryStore((s) => s.clearExplain)
  const setTabConnection = useQueryStore((s) => s.setTabConnection)

  const connections = useConnectionStore((s) => s.connections)
  const pickerConnections = useMemo(
    () => connections.map((c) => ({ id: c.id, name: c.name, engine: c.engine })),
    [connections],
  )
  const engine = useMemo(
    () => connections.find((c) => c.id === connectionId)?.engine,
    [connections, connectionId],
  )

  const [showLimitWarning, setShowLimitWarning] = useState(false)

  const handleChange = useCallback((next: string) => updateTabSql(tabId, next), [updateTabSql, tabId])
  const handleConnectionChange = useCallback((id: string) => setTabConnection(tabId, id), [setTabConnection, tabId])

  const handleRun = useCallback(() => {
    clearExplain(tabId)
    const current = useQueryStore.getState().tabs.find((t) => t.id === tabId)?.sql ?? ''
    if (detectMissingLimit(current)) setShowLimitWarning(true)
    else runQuery(tabId)
  }, [clearExplain, runQuery, tabId])

  const handleCancel = useCallback(() => cancelQuery(tabId), [cancelQuery, tabId])
  const handleExplain = useCallback(() => explainQuery(tabId), [explainQuery, tabId])

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
        onCancel={handleCancel}
        onExplain={handleExplain}
        onSave={onSave}
        onSplit={onSplit}
        isSplit={isSplit}
        isRunning={isRunning}
        isExplaining={isExplaining}
        savedQueryId={savedQueryId}
        sqlSchema={sqlSchema}
        cypherSchema={cypherSchema}
        engine={engine}
        connections={pickerConnections}
        connectionId={connectionId}
        onConnectionChange={handleConnectionChange}
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

- [ ] **Step 2: Commit (typecheck deferred to C4)**

```bash
git add src/renderer/src/components/editor/EditorPane.tsx
git commit -m "feat(editor): EditorPane derives engine + per-tab connection picker"
```

---

### Task C4: Rewrite Editor.tsx for two editor groups

**Files:**
- Modify: `src/renderer/src/pages/Editor.tsx`

UI-only. This removes all `rightPane` usage and renders one column per group with its own tab strip.

- [ ] **Step 1: Replace the file contents**

```tsx
import { useCallback, useEffect, useMemo, useRef, useState } from 'react'
import { Plus, X, Table2, Pin, Bookmark } from 'lucide-react'
import EditorPane from '../components/editor/EditorPane'
import ResultsTable from '../components/results/ResultsTable'
import ResultsRegion from '../components/results/ResultsRegion'
import TableDetailPanel from '../components/catalog/TableDetailPanel'
import SaveQueryModal from '../components/editor/SaveQueryModal'
import { useQueryStore, type GroupId } from '../store/queryStore'
import { useConnectionStore } from '../store/connectionStore'
import { useCatalogStore } from '../store/catalogStore'
import { useSavedQueryStore } from '../store/savedQueryStore'
import { useSchemaPrefetch } from '../hooks/useSchemaPrefetch'
import type { QueryTab } from '@shared/types'

export default function Editor() {
  const tabs = useQueryStore((s) => s.tabs)
  const focusedGroup = useQueryStore((s) => s.focusedGroup)
  const activeByGroup = useQueryStore((s) => s.activeByGroup)
  const openTab = useQueryStore((s) => s.openTab)
  const closeTab = useQueryStore((s) => s.closeTab)
  const setActiveTab = useQueryStore((s) => s.setActiveTab)
  const focusGroup = useQueryStore((s) => s.focusGroup)
  const moveTabToGroup = useQueryStore((s) => s.moveTabToGroup)
  const splitGroup = useQueryStore((s) => s.splitGroup)

  const dragTabId = useRef<string | null>(null)
  const { connections, activeConnectionId, setActive } = useConnectionStore()
  const { datasetsByConnection, tablesByDataset, schemaCache } = useCatalogStore()
  const { updateQuery } = useSavedQueryStore()

  const [splitPct, setSplitPct] = useState(55)      // editor/results vertical split (shared)
  const [splitHPct, setSplitHPct] = useState(50)    // horizontal split between groups
  const [savingTabId, setSavingTabId] = useState<string | null>(null)
  const [savedFlash, setSavedFlash] = useState(false)
  const isDragging = useRef(false)
  const isHDragging = useRef(false)
  const containerRef = useRef<HTMLDivElement>(null)
  const savedFlashTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null)

  const rightExists = tabs.some((t) => t.groupId === 'right')

  useEffect(() => {
    return () => {
      if (savedFlashTimerRef.current) clearTimeout(savedFlashTimerRef.current)
      isDragging.current = false
      isHDragging.current = false
    }
  }, [])

  useEffect(() => {
    if (tabs.length === 0) openTab({ connectionId: activeConnectionId ?? undefined })
  }, [])

  // The catalog sidebar + title-bar breadcrumb follow the focused group's
  // active tab connection. Never mutates a tab; only points the sidebar.
  const focusedTab = tabs.find((t) => t.id === activeByGroup[focusedGroup])
  useEffect(() => {
    if (focusedTab?.connectionId && focusedTab.connectionId !== activeConnectionId) {
      setActive(focusedTab.connectionId)
    }
  }, [focusedTab?.connectionId, focusedTab?.id])

  // Autocomplete schema for the focused connection (the editor you type in).
  const focusedEngine = connections.find((c) => c.id === activeConnectionId)?.engine
  const sqlSchema = useMemo(() => {
    if (!activeConnectionId) return {}
    const schema: Record<string, string[]> = {}
    const datasets = datasetsByConnection[activeConnectionId] ?? []
    for (const ds of datasets) {
      const dsTables = tablesByDataset[`${activeConnectionId}:${ds.id}`] ?? []
      for (const t of dsTables) {
        const cacheKey = `${activeConnectionId}:${ds.id}:${t.id}`
        const fields = schemaCache[cacheKey]
        const cols = fields ? fields.map((f) => f.name) : []
        schema[`${ds.name}.${t.name}`] = cols
        schema[t.name] = cols
      }
    }
    return schema
  }, [activeConnectionId, datasetsByConnection, tablesByDataset, schemaCache])

  const cypherSchema = useMemo(() => {
    if (!activeConnectionId || focusedEngine !== 'neo4j') return undefined
    const labels: string[] = []
    const relationshipTypes: string[] = []
    const propertyKeys = new Set<string>()
    const datasets = datasetsByConnection[activeConnectionId] ?? []
    for (const ds of datasets) {
      const dsTables = tablesByDataset[`${activeConnectionId}:${ds.id}`] ?? []
      for (const t of dsTables) {
        if (t.type === 'RELATIONSHIP_TYPE') relationshipTypes.push(t.name)
        else labels.push(t.name)
        const fields = schemaCache[`${activeConnectionId}:${ds.id}:${t.id}`]
        if (fields) for (const f of fields) propertyKeys.add(f.name)
      }
    }
    return { labels, relationshipTypes, propertyKeys: Array.from(propertyKeys) }
  }, [activeConnectionId, focusedEngine, datasetsByConnection, tablesByDataset, schemaCache])

  useSchemaPrefetch(focusedTab?.sql ?? '', activeConnectionId ?? undefined)

  const handleSave = useCallback(async () => {
    const { tabs: cur, activeTabId: id } = useQueryStore.getState()
    const tab = cur.find((t) => t.id === id)
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
      setSavingTabId(id)
    }
  }, [updateQuery])

  const handleDividerMouseDown = (e: React.MouseEvent) => {
    e.preventDefault()
    isDragging.current = true
    const onMove = (ev: MouseEvent) => {
      if (!isDragging.current || !containerRef.current) return
      const rect = containerRef.current.getBoundingClientRect()
      const pct = ((ev.clientY - rect.top) / rect.height) * 100
      setSplitPct(Math.min(85, Math.max(15, pct)))
    }
    const onUp = () => {
      isDragging.current = false
      window.removeEventListener('mousemove', onMove)
      window.removeEventListener('mouseup', onUp)
    }
    window.addEventListener('mousemove', onMove)
    window.addEventListener('mouseup', onUp)
  }

  const handleHDividerMouseDown = useCallback((e: React.MouseEvent) => {
    e.preventDefault()
    isHDragging.current = true
    const onMove = (ev: MouseEvent) => {
      if (!isHDragging.current || !containerRef.current) return
      const rect = containerRef.current.getBoundingClientRect()
      const pct = ((ev.clientX - rect.left) / rect.width) * 100
      setSplitHPct(Math.min(80, Math.max(20, pct)))
    }
    const onUp = () => {
      isHDragging.current = false
      window.removeEventListener('mousemove', onMove)
      window.removeEventListener('mouseup', onUp)
    }
    window.addEventListener('mousemove', onMove)
    window.addEventListener('mouseup', onUp)
  }, [])

  // ── Tab strip (one per group) ──────────────────────────────────────────────
  const renderTabStrip = (group: GroupId) => {
    const groupTabs = tabs.filter((t) => t.groupId === (group === 'left' ? 'left' : 'right') || (group === 'left' && !t.groupId))
    const activeId = activeByGroup[group]
    return (
      <div
        className="flex items-center gap-1 px-2 h-10 border-b border-app-border bg-app-bg shrink-0 overflow-x-auto"
        onDragOver={(e) => { e.preventDefault(); e.dataTransfer.dropEffect = 'move' }}
        onDrop={(e) => {
          e.preventDefault()
          if (dragTabId.current) moveTabToGroup(dragTabId.current, group)
          dragTabId.current = null
        }}
      >
        {groupTabs.map((tab) => {
          const isActive = activeId === tab.id
          return (
            <div
              key={tab.id}
              draggable
              onDragStart={(e) => { dragTabId.current = tab.id; e.dataTransfer.effectAllowed = 'move' }}
              onDragOver={(e) => { e.preventDefault(); e.dataTransfer.dropEffect = 'move' }}
              onDrop={(e) => {
                e.preventDefault()
                e.stopPropagation()
                if (dragTabId.current && dragTabId.current !== tab.id) {
                  moveTabToGroup(dragTabId.current, group, tab.id)
                }
                dragTabId.current = null
              }}
              onDragEnd={() => { dragTabId.current = null }}
              onClick={() => setActiveTab(tab.id)}
              className={`flex items-center gap-1.5 px-3 py-1 rounded-md text-ui-sm cursor-grab active:cursor-grabbing transition-all shrink-0 ${
                isActive
                  ? 'bg-app-surface text-app-text shadow-app-pill'
                  : 'text-app-text-2 hover:text-app-text hover:bg-app-elevated/60'
              }`}
            >
              {tab.type === 'table' && <Table2 size={11} className="text-app-cat-green shrink-0" />}
              {tab.type === 'result' && <Pin size={11} className="text-app-accent shrink-0" />}
              {tab.savedQueryId && tab.type !== 'table' && tab.type !== 'result' && (
                <Bookmark size={11} className="text-app-accent shrink-0" />
              )}
              {!tab.type && tab.isRunning && (
                <span className="app-dot shrink-0 animate-pulse" style={{ backgroundColor: 'rgb(var(--c-accent))' }} />
              )}
              <span className="max-w-[140px] truncate">{tab.title}</span>
              <button
                onClick={(e) => { e.stopPropagation(); closeTab(tab.id) }}
                className="text-app-text-3 hover:text-app-text transition-colors ml-0.5"
              >
                <X size={10} />
              </button>
            </div>
          )
        })}
        <button
          onClick={() => { focusGroup(group); openTab({ connectionId: activeConnectionId ?? undefined }) }}
          title="New query tab"
          className="p-1.5 rounded-md text-app-text-3 hover:text-app-text hover:bg-app-elevated transition-colors shrink-0"
        >
          <Plus size={13} />
        </button>
      </div>
    )
  }

  // ── One group's content (tab strip + editor/results for its active tab) ─────
  const renderGroup = (group: GroupId) => {
    const activeTab: QueryTab | undefined = tabs.find((t) => t.id === activeByGroup[group])
    return (
      <div
        className="flex flex-col flex-1 min-w-0 overflow-hidden"
        onMouseDownCapture={() => { if (focusedGroup !== group) focusGroup(group) }}
      >
        {renderTabStrip(group)}
        <div className="flex-1 flex flex-col overflow-hidden min-h-0">
          {!activeTab && (
            <div className="h-full flex items-center justify-center text-app-text-3 text-sm">
              Open a new tab to start querying
            </div>
          )}

          {activeTab?.type === 'table' && activeTab.tableRef && activeTab.connectionId && (
            <TableDetailPanel
              connectionId={activeTab.connectionId}
              projectId={activeTab.tableRef.projectId}
              datasetId={activeTab.tableRef.datasetId}
              tableId={activeTab.tableRef.tableId}
              tableName={activeTab.title}
            />
          )}

          {activeTab?.type === 'result' && (
            <div className="flex-1 overflow-hidden min-h-0">
              <ResultsTable result={activeTab.result} pinned />
            </div>
          )}

          {activeTab && activeTab.type !== 'table' && activeTab.type !== 'result' && (
            <>
              <div style={{ height: `${splitPct}%` }} className="flex flex-col overflow-hidden min-h-0">
                <EditorPane
                  tabId={activeTab.id}
                  sqlSchema={sqlSchema}
                  cypherSchema={cypherSchema}
                  isSplit={rightExists}
                  onSplit={splitGroup}
                  onSave={handleSave}
                />
              </div>
              <div
                onMouseDown={handleDividerMouseDown}
                className="h-1.5 bg-app-border hover:bg-app-accent/60 cursor-row-resize transition-colors shrink-0"
              />
              <div style={{ height: `${100 - splitPct}%` }} className="overflow-hidden min-h-0">
                <div className="flex flex-col h-full overflow-hidden">
                  <ResultsRegion tabId={activeTab.id} />
                </div>
              </div>
            </>
          )}
        </div>
      </div>
    )
  }

  return (
    <div className="flex flex-col h-full">
      <div ref={containerRef} className="flex-1 flex overflow-hidden">
        {renderGroup('left')}
        {rightExists && (
          <>
            <div
              onMouseDown={handleHDividerMouseDown}
              className="w-1.5 bg-app-border hover:bg-app-accent/60 cursor-col-resize transition-colors shrink-0"
            />
            <div style={{ width: `${100 - splitHPct}%` }} className="flex min-w-0">
              {renderGroup('right')}
            </div>
          </>
        )}
      </div>

      {savedFlash && (
        <div className="fixed bottom-4 right-4 z-50 bg-app-elevated border border-app-border text-app-text text-xs px-3 py-2 rounded shadow-lg animate-fade-in">
          ✓ Query updated
        </div>
      )}

      {savingTabId && (
        <SaveQueryModal tabId={savingTabId} onClose={() => setSavingTabId(null)} />
      )}
    </div>
  )
}
```

Note on the left group's width: when `rightExists`, the right column gets an explicit `width: ${100 - splitHPct}%` and the left column flexes to fill the remainder (`flex-1`). The horizontal divider reuses `splitHPct`.

- [ ] **Step 2: Typecheck**

Run: `just typecheck`
Expected: NO errors (rightPane fully removed across the codebase now).

- [ ] **Step 3: Confirm no stale references**

Run: `grep -rn "QueryPane\|rightPane\|toggleSplit\|updateRightPaneSql\|runRightPane\|cancelRightPane" src/`
Expected: no matches.

- [ ] **Step 4: Full test run**

Run: `just test`
Expected: all tests pass.

- [ ] **Step 5: Commit**

```bash
git add src/renderer/src/pages/Editor.tsx
git commit -m "feat(editor): two-group split layout with cross-group tab drag"
```

---

### Task C5: TitleBar — connection picker sets the focused tab's connection

**Files:**
- Modify: `src/renderer/src/components/layout/TitleBar.tsx`

UI-only. Today the breadcrumb dropdown calls `connectionStore.setActive(c.id)`. We additionally point the focused tab at the chosen connection so the breadcrumb stays meaningful as "focused tab's connection."

- [ ] **Step 1: Import the query store**

Add near the other store imports (after line 5):

```ts
import { useQueryStore } from '../../store/queryStore'
```

- [ ] **Step 2: Update the dropdown row click handler**

In the dropdown row `onClick` (around lines 220-225), replace:

```tsx
              onClick={() => {
                if (confirmDeleteId !== c.id) {
                  setActive(c.id)
                  setOpen(false)
                }
              }}
```

with:

```tsx
              onClick={() => {
                if (confirmDeleteId !== c.id) {
                  // Re-point the focused tab at this connection (sidebar follows it).
                  const qs = useQueryStore.getState()
                  const focusedTabId = qs.activeByGroup[qs.focusedGroup]
                  if (focusedTabId) qs.setTabConnection(focusedTabId, c.id)
                  setActive(c.id)
                  setOpen(false)
                }
              }}
```

- [ ] **Step 3: Typecheck and commit**

Run: `just typecheck`
Expected: no errors.

```bash
git add src/renderer/src/components/layout/TitleBar.tsx
git commit -m "feat(titlebar): connection picker repoints the focused tab"
```

---

### Task C6: Full verification + docs

**Files:**
- Modify: `README.md`
- Modify: `CHANGELOG.md`
- Modify: `CLAUDE.md`

- [ ] **Step 1: Full CI locally**

Run: `just ci`
Expected: typecheck + coverage all green (≥70%). If coverage dipped, the cause is almost certainly the removed split-pane store tests — the new `editor groups` block more than replaces them. Investigate any specific uncovered lines in `queryStore.ts` flagged by the report.

- [ ] **Step 2: Manual smoke test**

Run: `just dev`
Verify:
1. Type a query, run it, click **Copy** → paste into a spreadsheet shows tab-separated columns.
2. Click **Chart**, pick X/Y, switch Bar/Line/Scatter, toggle aggregate → chart updates; **Table** returns.
3. Click **Split** → a second group appears on the right with its own tab strip.
4. Change the right group's tab connection via the toolbar picker → its catalog/engine follow when focused.
5. Drag a tab from the left strip onto the right strip → it moves over, keeping its connection.
6. Close the right group's last tab → layout collapses back to a single group.

- [ ] **Step 3: Update README.md**

In `README.md`, under the features/usage section that lists the results panel and editor, add bullets:
- "**Split view across connections** — split the editor into two groups, each with its own connection; drag tabs between groups."
- "**Copy / export results** — copy the current view to the clipboard as TSV, or export CSV/TSV/JSON to a file."
- "**Chart results** — visualize any result as a bar, line, or scatter chart with X/Y axis selection and optional aggregation."

(Match the surrounding README style; keep it concise.)

- [ ] **Step 4: Update CHANGELOG.md**

Add to the `Unreleased` section:

```markdown
### Added
- Multi-connection split view: two editor groups, each with its own connection; drag tabs between groups.
- Copy query results to the clipboard as TSV.
- Chart view for results (bar / line / scatter) with X/Y axis selection and optional aggregation.

### Changed
- The editor split now spans two independent connections (replaces the same-connection two-pane split).
```

- [ ] **Step 5: Append CLAUDE.md change-log entry**

Add a new dated entry at the top of the Change Log section of `CLAUDE.md` following the existing format, summarizing: editor-groups model in `queryStore` (replacing `rightPane`), per-tab connection picker, `ChartView` + `aggregateForChart`, `rowsToTsv` clipboard copy, files affected, and test counts.

- [ ] **Step 6: Commit**

```bash
git add README.md CHANGELOG.md CLAUDE.md
git commit -m "docs: split view, result charts, clipboard copy"
```

---

## Self-Review Notes (verification of this plan against the spec)

- **Spec §1 editor groups** → C1 (store), C3/C4 (UI), C5 (titlebar). 2 groups, replace old: covered (rightPane removed). Per-tab connection changeable: C2/C3 picker + `setTabConnection`. Connection travels on drag: `moveTabToGroup` keeps `connectionId`. Sidebar follows focus: C4 effect. ✓
- **Spec §2 charts** → B1 (recharts), B2 (types), B3 (`aggregateForChart`), B4 (`ChartView`), B5 (store), B6 (toggle). Bar/line/scatter, X/Y/aggregate, client-side over fetched rows, per-tab persistence, Recharts. ✓
- **Spec §3 clipboard** → A1 (`rowsToTsv`), A2 (button). TSV only, filtered/sorted view (`filteredRows`). ✓
- **Spec testing** → store tests reworked (C1), pure helper tests (A1, B3). ✓
- **Spec out-of-scope** respected: max 2 groups; single Y; chart reads fetched rows not table filters; TSV-only clipboard. ✓
- **Type consistency:** `ChartConfig`/`ChartAggregate` defined once in `shared/types.ts`, imported by `aggregateForChart`, `ChartView`, `queryStore`, `ResultsRegion`. `GroupId` exported from `queryStore` and imported by `Editor.tsx`. `moveTabToGroup(tabId, target, beforeId?)`, `splitGroup()`, `focusGroup(group)`, `setTabConnection(tabId, connectionId)` signatures consistent across store + callers. ✓
```
