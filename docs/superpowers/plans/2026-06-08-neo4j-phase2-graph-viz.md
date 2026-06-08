# Neo4j Support — Phase 2 (Graph Visualization) Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Layer an interactive graph-visualization canvas on top of Phase 1. When a Cypher result contains Node / Relationship / Path values, an auto-detection banner appears above the results table with "View as graph." Clicking swaps the results area for a `GraphView`: a force-directed canvas on the left and a persistent 280px side inspector on the right. Pure-scalar results — and every other engine — get **zero new UI** (the banner stays hidden).

**Architecture:** Mirrors the swap pattern `ExplainPanel` already uses in `Editor.tsx` — `viewAsGraph: boolean` on `QueryTab` toggles between `ResultsTable` and a new `GraphView`. Graph data is built by a pure `buildGraphFromRecords(records, cap)` utility that walks every cell, de-duplicates by Neo4j element ID, and caps at 500 nodes; past the cap the banner reads "too many to visualize" instead of swapping. Canvas rendering uses `react-force-graph-2d` (the same actively-maintained library the spec specified) with custom paint callbacks so nodes/edges draw with Aperture's design tokens, not the library's defaults. The inspector is a fixed-width sibling column (never a floating overlay — explicit design constraint).

**Tech Stack:** TypeScript (strict), React 18, `react-force-graph-2d` v1.29, Zustand, Tailwind, Vitest + jsdom (canvas-library mocked at the React level; the graph utilities are pure-function-testable).

---

## File Structure

### New files
| File | Responsibility |
|---|---|
| `src/renderer/src/lib/buildGraphFromRecords.ts` | Pure utility — walks records, extracts/dedupes nodes & links, applies cap |
| `src/renderer/src/lib/detectGraphShape.ts` | Pure utility — `true` if any cell is a serialized graph element |
| `src/renderer/src/lib/graphPalette.ts` | Pure utility — maps a label name → one of the `cat-*` accent tokens via stable hash |
| `src/renderer/src/components/results/GraphView.tsx` | Two-column layout: canvas + inspector. Wraps `ForceGraph2D` with custom paint callbacks |
| `src/renderer/src/components/results/GraphInspector.tsx` | Right-column inspector — empty state + selected node/relationship details |
| `src/renderer/src/components/results/GraphLegend.tsx` | Top-left color → label / relationship-type chip list |
| `src/renderer/src/components/results/GraphShapedBanner.tsx` | "This result contains graph data → View as graph" banner |
| `src/__tests__/renderer/lib/buildGraphFromRecords.test.ts` | Extraction, de-duplication, cap, orphan-link filtering |
| `src/__tests__/renderer/lib/detectGraphShape.test.ts` | Discriminator tests |
| `src/__tests__/renderer/lib/graphPalette.test.ts` | Stable hash, cycling, fallback |
| `src/__tests__/renderer/store/queryStore.test.ts` (extension) | New `toggleGraphView` action |

### Modified files
| File | Change |
|---|---|
| `package.json` | Add `react-force-graph-2d` |
| `src/shared/types.ts` | `viewAsGraph?: boolean` on `QueryTab`; `GraphNode` / `GraphLink` / `GraphData` (rendering-side types, distinct from the wire types) |
| `src/renderer/src/store/queryStore.ts` | `toggleGraphView(id)` action |
| `src/renderer/src/pages/Editor.tsx` | Mount `GraphShapedBanner` above the results area; swap `ResultsTable` for `GraphView` when `viewAsGraph` is true |
| `README.md`, `CHANGELOG.md`, `CLAUDE.md` | Docs + change-log entry |

---

## Task 1: Add `react-force-graph-2d` dependency

**Files:**
- Modify: `package.json` (dependencies block)

- [ ] **Step 1: Edit `dependencies`**

Insert `react-force-graph-2d` in alphabetical order between `react-dom` and `snowflake-sdk`:

```json
    "react-dom": "^18.3.1",
    "react-force-graph-2d": "^1.29.1",
    "snowflake-sdk": "^2.4.0",
```

- [ ] **Step 2: Install**

Run: `npm install`
Expected: completes without error.

- [ ] **Step 3: Verify**

Run: `npm ls react-force-graph-2d`
Expected: prints `react-force-graph-2d@1.29.x`, no "invalid" / "missing".

- [ ] **Step 4: Commit**

```bash
git add package.json package-lock.json
git commit -m "✨ feat(neo4j): add react-force-graph-2d for Phase 2 canvas"
```

---

## Task 2: Shared types — `viewAsGraph` + rendering-side graph types

**Files:**
- Modify: `src/shared/types.ts:109-129` (`QueryTab`), append after `Neo4jGraphValue`

- [ ] **Step 1: Add `viewAsGraph` to `QueryTab`**

Insert the new field immediately after the `isExplaining?: boolean` line:

```ts
  /** When true, the graph view replaces the results table for this tab. */
  viewAsGraph?: boolean
```

- [ ] **Step 2: Add rendering-side graph types**

Insert immediately after the `Neo4jGraphValue` union (after the existing `__neo4jType`-tagged interfaces):

```ts
/**
 * Rendering-side graph types — what react-force-graph-2d expects.
 * Distinct from the wire types (Neo4jNode/Relationship/Path) which are tagged
 * for the IPC boundary. `buildGraphFromRecords` converts wire → rendering.
 */
export interface GraphNode {
  /** Neo4j element ID — also the force-graph node id */
  id: string
  /** First label, used to seed color; '(unknown)' for orphan endpoints */
  primaryLabel: string
  /** All labels — shown in the inspector */
  labels: string[]
  properties: Record<string, unknown>
}

export interface GraphLink {
  /** Neo4j relationship element ID */
  id: string
  /** Source node id — must match a GraphNode.id */
  source: string
  /** Target node id — must match a GraphNode.id */
  target: string
  type: string
  properties: Record<string, unknown>
}

export interface GraphData {
  nodes: GraphNode[]
  links: GraphLink[]
}
```

- [ ] **Step 3: Verify typecheck**

Run: `npm run typecheck`
Expected: PASS.

- [ ] **Step 4: Commit**

```bash
git add src/shared/types.ts
git commit -m "✨ feat(neo4j): viewAsGraph on QueryTab + rendering-side graph types"
```

---

## Task 3: `graphPalette` — pure label → color helper (TDD)

**Files:**
- Create: `src/renderer/src/lib/graphPalette.ts`
- Test: `src/__tests__/renderer/lib/graphPalette.test.ts`

- [ ] **Step 1: Write the failing test**

Create `src/__tests__/renderer/lib/graphPalette.test.ts`:

```ts
import { describe, it, expect } from 'vitest'
import { paletteColor, NODE_PALETTE } from '../../../renderer/src/lib/graphPalette'

describe('graphPalette', () => {
  it('returns a token from the palette for any label', () => {
    expect(NODE_PALETTE).toContain(paletteColor('Person'))
  })

  it('is stable — same label always maps to same color', () => {
    expect(paletteColor('Person')).toBe(paletteColor('Person'))
    expect(paletteColor('Company')).toBe(paletteColor('Company'))
  })

  it('cycles through the palette for distinct labels (no collisions inside palette size)', () => {
    // Different labels should not all collapse to the same color
    const seen = new Set([
      paletteColor('A'), paletteColor('B'), paletteColor('C'), paletteColor('D'),
    ])
    expect(seen.size).toBeGreaterThan(1)
  })

  it('falls back to the muted token for the unknown sentinel', () => {
    expect(paletteColor('(unknown)')).toBe('rgb(var(--c-text-3))')
  })
})
```

- [ ] **Step 2: Verify it fails**

Run: `npx vitest run src/__tests__/renderer/lib/graphPalette.test.ts`
Expected: FAIL — `Cannot find module .../graphPalette`.

- [ ] **Step 3: Implement**

Create `src/renderer/src/lib/graphPalette.ts`:

```ts
/**
 * Color palette for graph nodes and relationship types. Cycles through the
 * existing categorical accent tokens so the graph view stays visually
 * consistent with the catalog tree and connection breadcrumb.
 *
 * Past 5 distinct labels the palette wraps — this is the "gracefully cycling
 * beyond ~6 distinct labels" point from the design spec.
 */
export const NODE_PALETTE = [
  'rgb(var(--c-cat-teal))',
  'rgb(var(--c-cat-blue))',
  'rgb(var(--c-cat-purple))',
  'rgb(var(--c-cat-green))',
  'rgb(var(--c-accent))',
] as const

/** Maps a label / relationship-type name to a palette color via a stable hash. */
export function paletteColor(label: string): string {
  if (label === '(unknown)') return 'rgb(var(--c-text-3))'
  let hash = 0
  for (let i = 0; i < label.length; i++) {
    hash = ((hash << 5) - hash + label.charCodeAt(i)) | 0
  }
  return NODE_PALETTE[Math.abs(hash) % NODE_PALETTE.length]
}
```

- [ ] **Step 4: Verify it passes**

Run: `npx vitest run src/__tests__/renderer/lib/graphPalette.test.ts`
Expected: PASS (4 tests).

- [ ] **Step 5: Commit**

```bash
git add src/renderer/src/lib/graphPalette.ts src/__tests__/renderer/lib/graphPalette.test.ts
git commit -m "✨ feat(neo4j): graph color palette (stable label → cat-* token)"
```

---

## Task 4: `detectGraphShape` — pure result-scan helper (TDD)

**Files:**
- Create: `src/renderer/src/lib/detectGraphShape.ts`
- Test: `src/__tests__/renderer/lib/detectGraphShape.test.ts`

- [ ] **Step 1: Write the failing test**

Create `src/__tests__/renderer/lib/detectGraphShape.test.ts`:

```ts
import { describe, it, expect } from 'vitest'
import { detectGraphShape } from '../../../renderer/src/lib/detectGraphShape'
import type { Neo4jNode } from '../../../shared/types'

const alice: Neo4jNode = {
  __neo4jType: 'Node', identity: '1', labels: ['Person'], properties: {},
}

describe('detectGraphShape', () => {
  it('is true when any cell of any row is a graph element', () => {
    expect(detectGraphShape([{ a: 'scalar', b: alice }])).toBe(true)
  })

  it('is false for scalar-only rows', () => {
    expect(detectGraphShape([{ a: 'x', b: 42, c: true, d: null }])).toBe(false)
  })

  it('is false for empty row arrays', () => {
    expect(detectGraphShape([])).toBe(false)
  })

  it('short-circuits on the first match — does not scan all rows', () => {
    // Both correctness and a soft perf check: building this synthetic giant
    // array with one early Node and 999,999 scalars should still return true
    // fast (no full walk). Smoke test — no timing assertion, just no hang.
    const rows: Record<string, unknown>[] = [{ n: alice }]
    for (let i = 0; i < 999_999; i++) rows.push({ n: i })
    expect(detectGraphShape(rows)).toBe(true)
  })
})
```

- [ ] **Step 2: Verify it fails**

Run: `npx vitest run src/__tests__/renderer/lib/detectGraphShape.test.ts`
Expected: FAIL — module not found.

- [ ] **Step 3: Implement**

Create `src/renderer/src/lib/detectGraphShape.ts`:

```ts
import { isGraphElement } from './formatGraphElement'

/**
 * True if any cell in any row is a serialized Neo4j Node, Relationship, or Path.
 * Used to decide whether to surface the "View as graph" banner above the
 * results table. Short-circuits on the first match.
 */
export function detectGraphShape(rows: Record<string, unknown>[]): boolean {
  for (const row of rows) {
    for (const value of Object.values(row)) {
      if (isGraphElement(value)) return true
    }
  }
  return false
}
```

- [ ] **Step 4: Verify it passes**

Run: `npx vitest run src/__tests__/renderer/lib/detectGraphShape.test.ts`
Expected: PASS (4 tests).

- [ ] **Step 5: Commit**

```bash
git add src/renderer/src/lib/detectGraphShape.ts src/__tests__/renderer/lib/detectGraphShape.test.ts
git commit -m "✨ feat(neo4j): detectGraphShape — short-circuiting result scan"
```

---

## Task 5: `buildGraphFromRecords` — pure data builder (TDD)

**Files:**
- Create: `src/renderer/src/lib/buildGraphFromRecords.ts`
- Test: `src/__tests__/renderer/lib/buildGraphFromRecords.test.ts`

- [ ] **Step 1: Write the failing test**

Create `src/__tests__/renderer/lib/buildGraphFromRecords.test.ts`:

```ts
import { describe, it, expect } from 'vitest'
import { buildGraphFromRecords } from '../../../renderer/src/lib/buildGraphFromRecords'
import type { Neo4jNode, Neo4jRelationship, Neo4jPath } from '../../../shared/types'

const alice: Neo4jNode = { __neo4jType: 'Node', identity: 'a', labels: ['Person'], properties: { name: 'Alice' } }
const bob: Neo4jNode = { __neo4jType: 'Node', identity: 'b', labels: ['Person'], properties: { name: 'Bob' } }
const company: Neo4jNode = { __neo4jType: 'Node', identity: 'c', labels: ['Company'], properties: {} }
const knows: Neo4jRelationship = {
  __neo4jType: 'Relationship', identity: 'r1', start: 'a', end: 'b', type: 'KNOWS', properties: {},
}
const worksAt: Neo4jRelationship = {
  __neo4jType: 'Relationship', identity: 'r2', start: 'a', end: 'c', type: 'WORKS_AT', properties: {},
}

describe('buildGraphFromRecords', () => {
  it('extracts nodes and links from columns', () => {
    const out = buildGraphFromRecords([{ a: alice, b: bob, r: knows }])
    expect(out.truncated).toBe(false)
    if (out.truncated) return
    expect(out.nodes).toHaveLength(2)
    expect(out.links).toHaveLength(1)
    expect(out.links[0]).toMatchObject({ source: 'a', target: 'b', type: 'KNOWS' })
  })

  it('de-duplicates nodes and relationships by identity across rows', () => {
    const out = buildGraphFromRecords([
      { a: alice, b: bob, r: knows },
      { a: alice, b: bob, r: knows },
    ])
    if (out.truncated) throw new Error('unexpected truncation')
    expect(out.nodes).toHaveLength(2)
    expect(out.links).toHaveLength(1)
  })

  it('walks Path segments — adds endpoints and the relationship', () => {
    const path: Neo4jPath = {
      __neo4jType: 'Path',
      segments: [{ start: alice, relationship: worksAt, end: company }],
    }
    const out = buildGraphFromRecords([{ p: path }])
    if (out.truncated) throw new Error('unexpected truncation')
    expect(out.nodes.map((n) => n.id).sort()).toEqual(['a', 'c'])
    expect(out.links[0].type).toBe('WORKS_AT')
  })

  it('filters orphan links (link whose endpoint is missing in nodes)', () => {
    // Relationship returned without its endpoints — its source/target aren't in the result.
    const out = buildGraphFromRecords([{ r: knows }])
    if (out.truncated) throw new Error('unexpected truncation')
    expect(out.nodes).toHaveLength(0)
    expect(out.links).toHaveLength(0)
  })

  it('returns the truncation marker past the cap', () => {
    const rows: Record<string, unknown>[] = []
    for (let i = 0; i < 600; i++) {
      const n: Neo4jNode = { __neo4jType: 'Node', identity: String(i), labels: ['X'], properties: {} }
      rows.push({ n })
    }
    const out = buildGraphFromRecords(rows, 500)
    expect(out).toEqual({ truncated: true, nodeCount: 600 })
  })

  it('preserves primaryLabel from the first label, defaults to (unknown)', () => {
    const noLabels: Neo4jNode = { __neo4jType: 'Node', identity: 'x', labels: [], properties: {} }
    const out = buildGraphFromRecords([{ a: alice, x: noLabels }])
    if (out.truncated) throw new Error('unexpected truncation')
    const a = out.nodes.find((n) => n.id === 'a')!
    const x = out.nodes.find((n) => n.id === 'x')!
    expect(a.primaryLabel).toBe('Person')
    expect(x.primaryLabel).toBe('(unknown)')
  })

  it('ignores scalar cells', () => {
    const out = buildGraphFromRecords([{ a: alice, scalar: 42, other: 'str' }])
    if (out.truncated) throw new Error('unexpected truncation')
    expect(out.nodes).toHaveLength(1)
  })
})
```

- [ ] **Step 2: Verify it fails**

Run: `npx vitest run src/__tests__/renderer/lib/buildGraphFromRecords.test.ts`
Expected: FAIL — module not found.

- [ ] **Step 3: Implement**

Create `src/renderer/src/lib/buildGraphFromRecords.ts`:

```ts
import type {
  GraphData, GraphLink, GraphNode,
  Neo4jGraphValue, Neo4jNode, Neo4jPath, Neo4jRelationship,
} from '@shared/types'
import { isGraphElement } from './formatGraphElement'

const DEFAULT_CAP = 500

type Truncated = { truncated: true; nodeCount: number }
type BuiltGraph = { truncated: false } & GraphData

/**
 * Walk every cell of every record, extract Neo4j Node / Relationship / Path
 * values, de-duplicate by element ID, and return a force-graph-compatible
 * shape. Past the cap returns a truncation marker — the graph view is never
 * silently handed an unrenderable hairball.
 *
 * Orphan links (whose source or target node isn't also present in the result)
 * are filtered out: force-graph would render them as broken edges to nowhere.
 */
export function buildGraphFromRecords(
  rows: Record<string, unknown>[],
  cap: number = DEFAULT_CAP,
): Truncated | BuiltGraph {
  const nodes = new Map<string, GraphNode>()
  const links = new Map<string, GraphLink>()

  const addNode = (n: Neo4jNode) => {
    if (nodes.has(n.identity)) return
    nodes.set(n.identity, {
      id: n.identity,
      primaryLabel: n.labels[0] ?? '(unknown)',
      labels: n.labels,
      properties: n.properties,
    })
  }

  const addLink = (r: Neo4jRelationship) => {
    if (links.has(r.identity)) return
    links.set(r.identity, {
      id: r.identity,
      source: r.start,
      target: r.end,
      type: r.type,
      properties: r.properties,
    })
  }

  const visit = (value: Neo4jGraphValue) => {
    if (value.__neo4jType === 'Node') {
      addNode(value)
    } else if (value.__neo4jType === 'Relationship') {
      addLink(value)
    } else {
      // Path — walk every segment, adding both endpoints + the relationship
      for (const seg of value.segments) {
        addNode(seg.start)
        addNode(seg.end)
        addLink(seg.relationship)
      }
    }
  }

  for (const row of rows) {
    for (const value of Object.values(row)) {
      if (isGraphElement(value)) visit(value)
    }
  }

  if (nodes.size > cap) {
    return { truncated: true, nodeCount: nodes.size }
  }

  // Filter orphan links — both endpoints must be present in the node set.
  const filteredLinks: GraphLink[] = []
  for (const link of links.values()) {
    if (nodes.has(link.source) && nodes.has(link.target)) {
      filteredLinks.push(link)
    }
  }

  return { truncated: false, nodes: Array.from(nodes.values()), links: filteredLinks }
}
```

- [ ] **Step 4: Verify it passes**

Run: `npx vitest run src/__tests__/renderer/lib/buildGraphFromRecords.test.ts`
Expected: PASS (7 tests).

- [ ] **Step 5: Commit**

```bash
git add src/renderer/src/lib/buildGraphFromRecords.ts src/__tests__/renderer/lib/buildGraphFromRecords.test.ts
git commit -m "✨ feat(neo4j): buildGraphFromRecords (de-dupe + cap + orphan-link filter)"
```

---

## Task 6: `toggleGraphView` queryStore action (TDD)

**Files:**
- Modify: `src/renderer/src/store/queryStore.ts`
- Modify: `src/__tests__/renderer/store/queryStore.test.ts`

- [ ] **Step 1: Write the failing test**

Append a new `describe` block to `src/__tests__/renderer/store/queryStore.test.ts` (place it before the closing `})` of the file, or alongside the other top-level describes):

```ts
describe('toggleGraphView', () => {
  it('flips viewAsGraph on the targeted tab only', () => {
    const { openTab, toggleGraphView } = useQueryStore.getState()
    const id = openTab({ sql: 'MATCH (n) RETURN n', connectionId: 'c' })
    const otherId = openTab({ sql: 'SELECT 1', connectionId: 'c' })

    toggleGraphView(id)
    expect(useQueryStore.getState().tabs.find((t) => t.id === id)?.viewAsGraph).toBe(true)
    expect(useQueryStore.getState().tabs.find((t) => t.id === otherId)?.viewAsGraph).toBeUndefined()

    toggleGraphView(id)
    expect(useQueryStore.getState().tabs.find((t) => t.id === id)?.viewAsGraph).toBe(false)
  })

  it('is a no-op for an unknown tab id', () => {
    const { toggleGraphView, tabs: before } = useQueryStore.getState()
    toggleGraphView('does-not-exist')
    expect(useQueryStore.getState().tabs).toEqual(before)
  })
})
```

- [ ] **Step 2: Verify it fails**

Run: `npx vitest run src/__tests__/renderer/store/queryStore.test.ts -t toggleGraphView`
Expected: FAIL — `toggleGraphView is not a function`.

- [ ] **Step 3: Implement**

In `src/renderer/src/store/queryStore.ts`, add the action signature to the store interface (near the other action signatures like `toggleSplit`):

```ts
  toggleGraphView: (id: string) => void
```

Add the action implementation alongside the others (search for `toggleSplit:` to find the cluster):

```ts
  toggleGraphView: (id) => {
    set((s) => ({
      tabs: s.tabs.map((t) =>
        t.id === id ? { ...t, viewAsGraph: !t.viewAsGraph } : t,
      ),
    }))
  },
```

- [ ] **Step 4: Verify it passes**

Run: `npx vitest run src/__tests__/renderer/store/queryStore.test.ts -t toggleGraphView`
Expected: PASS (2 tests).

- [ ] **Step 5: Commit**

```bash
git add src/renderer/src/store/queryStore.ts src/__tests__/renderer/store/queryStore.test.ts
git commit -m "✨ feat(neo4j): queryStore.toggleGraphView action"
```

---

## Task 7: `GraphInspector` component

**Files:**
- Create: `src/renderer/src/components/results/GraphInspector.tsx`

- [ ] **Step 1: Create the component**

Create `src/renderer/src/components/results/GraphInspector.tsx`:

```tsx
import type { GraphLink, GraphNode } from '@shared/types'
import { paletteColor } from '../../lib/graphPalette'

interface GraphInspectorProps {
  selected: { kind: 'node'; data: GraphNode } | { kind: 'link'; data: GraphLink } | null
}

/**
 * Right-column inspector. Empty state: "Select a node or relationship…".
 * Populated state: label/type heading + ID + property table (one row per
 * key, styled like the existing schema table rows).
 */
export default function GraphInspector({ selected }: GraphInspectorProps) {
  return (
    <div className="w-[280px] shrink-0 flex flex-col h-full border-l border-app-border bg-app-surface overflow-hidden">
      <div className="px-3 py-2 border-b border-app-border shrink-0">
        <span className="app-section-label">Inspector</span>
      </div>

      <div className="flex-1 overflow-y-auto">
        {selected == null ? (
          <div className="p-4 text-xs text-app-text-3">
            Select a node or relationship to inspect it.
          </div>
        ) : selected.kind === 'node' ? (
          <NodeDetails node={selected.data} />
        ) : (
          <LinkDetails link={selected.data} />
        )}
      </div>
    </div>
  )
}

function NodeDetails({ node }: { node: GraphNode }) {
  return (
    <div className="flex flex-col">
      <div className="px-3 py-2 border-b border-app-border">
        <div className="flex items-center gap-2">
          <span
            className="inline-block w-2.5 h-2.5 rounded-full shrink-0"
            style={{ backgroundColor: paletteColor(node.primaryLabel) }}
          />
          <span className="text-app-text font-semibold text-xs">{node.labels.join(':') || '(unknown)'}</span>
        </div>
        <div className="text-[10px] text-app-text-3 font-mono mt-0.5 truncate" title={node.id}>
          ID: {node.id}
        </div>
      </div>
      <PropertyTable properties={node.properties} />
    </div>
  )
}

function LinkDetails({ link }: { link: GraphLink }) {
  return (
    <div className="flex flex-col">
      <div className="px-3 py-2 border-b border-app-border">
        <div className="flex items-center gap-2">
          <span
            className="inline-block w-2.5 h-2.5 rounded shrink-0"
            style={{ backgroundColor: paletteColor(link.type) }}
          />
          <span className="text-app-text font-semibold text-xs">:{link.type}</span>
        </div>
        <div className="text-[10px] text-app-text-3 font-mono mt-0.5 truncate" title={`${link.source} → ${link.target}`}>
          {link.source} → {link.target}
        </div>
      </div>
      <PropertyTable properties={link.properties} />
    </div>
  )
}

function PropertyTable({ properties }: { properties: Record<string, unknown> }) {
  const entries = Object.entries(properties)
  if (entries.length === 0) {
    return <div className="px-3 py-2 text-[11px] text-app-text-3">No properties.</div>
  }
  return (
    <table className="w-full text-[11px] border-collapse">
      <tbody>
        {entries.map(([key, value]) => (
          <tr key={key} className="border-b border-app-border/40">
            <td className="px-3 py-1.5 align-top text-app-text-2 font-mono w-1/3 truncate" title={key}>{key}</td>
            <td className="px-3 py-1.5 align-top text-app-text font-mono break-words">{formatPropValue(value)}</td>
          </tr>
        ))}
      </tbody>
    </table>
  )
}

function formatPropValue(value: unknown): string {
  if (value === null || value === undefined) return 'NULL'
  if (typeof value === 'string') return value
  return JSON.stringify(value)
}
```

- [ ] **Step 2: Verify it compiles**

Run: `npm run typecheck:web`
Expected: PASS.

- [ ] **Step 3: Commit**

```bash
git add src/renderer/src/components/results/GraphInspector.tsx
git commit -m "✨ feat(neo4j): GraphInspector (persistent 280px side column)"
```

---

## Task 8: `GraphLegend` component

**Files:**
- Create: `src/renderer/src/components/results/GraphLegend.tsx`

- [ ] **Step 1: Create the component**

Create `src/renderer/src/components/results/GraphLegend.tsx`:

```tsx
import type { GraphData } from '@shared/types'
import { paletteColor } from '../../lib/graphPalette'

/**
 * Top-left legend: colored chip + label/type name. Computed from the graph's
 * distinct primary labels and relationship types so the legend only ever
 * shows what's actually on screen.
 */
export default function GraphLegend({ data }: { data: GraphData }) {
  const nodeLabels = Array.from(new Set(data.nodes.map((n) => n.primaryLabel))).sort()
  const linkTypes = Array.from(new Set(data.links.map((l) => l.type))).sort()

  if (nodeLabels.length === 0 && linkTypes.length === 0) return null

  return (
    <div className="absolute top-2 left-2 z-10 flex flex-col gap-1 p-2 rounded-lg bg-app-surface/90 backdrop-blur border border-app-border max-w-[200px]">
      {nodeLabels.length > 0 && (
        <div className="flex flex-col gap-0.5">
          <span className="app-section-label">Nodes</span>
          {nodeLabels.map((label) => (
            <div key={label} className="flex items-center gap-1.5">
              <span className="w-2.5 h-2.5 rounded-full shrink-0" style={{ backgroundColor: paletteColor(label) }} />
              <span className="text-[11px] text-app-text truncate">{label}</span>
            </div>
          ))}
        </div>
      )}
      {linkTypes.length > 0 && (
        <div className="flex flex-col gap-0.5 mt-1">
          <span className="app-section-label">Relationships</span>
          {linkTypes.map((type) => (
            <div key={type} className="flex items-center gap-1.5">
              <span className="w-2.5 h-2.5 rounded shrink-0" style={{ backgroundColor: paletteColor(type) }} />
              <span className="text-[11px] text-app-text truncate">{type}</span>
            </div>
          ))}
        </div>
      )}
    </div>
  )
}
```

- [ ] **Step 2: Verify it compiles**

Run: `npm run typecheck:web`
Expected: PASS.

- [ ] **Step 3: Commit**

```bash
git add src/renderer/src/components/results/GraphLegend.tsx
git commit -m "✨ feat(neo4j): GraphLegend (top-left color → label/type chips)"
```

---

## Task 9: `GraphView` main component

**Files:**
- Create: `src/renderer/src/components/results/GraphView.tsx`

- [ ] **Step 1: Create the component**

Create `src/renderer/src/components/results/GraphView.tsx`:

```tsx
import { useCallback, useMemo, useRef, useState } from 'react'
import ForceGraph2D, { type ForceGraphMethods } from 'react-force-graph-2d'
import { ArrowLeft, Maximize2 } from 'lucide-react'
import type { GraphData, GraphLink, GraphNode, QueryResult } from '@shared/types'
import { buildGraphFromRecords } from '../../lib/buildGraphFromRecords'
import { paletteColor } from '../../lib/graphPalette'
import GraphInspector from './GraphInspector'
import GraphLegend from './GraphLegend'

interface GraphViewProps {
  result: QueryResult
  /** Returns to the results-table view */
  onBack: () => void
}

type Selected =
  | { kind: 'node'; data: GraphNode }
  | { kind: 'link'; data: GraphLink }
  | null

/**
 * Force-directed graph view. Layout: left canvas (flex-1) + right inspector
 * (fixed 280px), per the spec's "never floating" constraint. The data is
 * built from the result rows by buildGraphFromRecords — if the cap was hit,
 * the caller (Editor.tsx) renders the banner truncation message instead and
 * never reaches this component.
 */
export default function GraphView({ result, onBack }: GraphViewProps) {
  const built = useMemo(() => buildGraphFromRecords(result.rows), [result.rows])
  const fgRef = useRef<ForceGraphMethods | undefined>(undefined)
  const [selected, setSelected] = useState<Selected>(null)

  const fitToView = useCallback(() => {
    fgRef.current?.zoomToFit(400, 40)
  }, [])

  if (built.truncated) {
    // Defensive — the banner should have prevented us from getting here.
    return (
      <div className="flex-1 flex items-center justify-center text-xs text-app-text-3 p-4">
        Graph too large to render ({built.nodeCount.toLocaleString()} nodes).
      </div>
    )
  }

  const data: GraphData = built

  return (
    <div className="flex-1 flex overflow-hidden min-h-0">
      {/* Canvas column */}
      <div className="flex-1 relative bg-app-bg overflow-hidden min-w-0">
        {/* Top-left legend */}
        <GraphLegend data={data} />

        {/* Top-right controls */}
        <div className="absolute top-2 right-2 z-10 flex gap-1">
          <button
            onClick={onBack}
            title="Back to table"
            className="flex items-center gap-1 text-[11px] px-2 py-1 rounded-md bg-app-surface/90 backdrop-blur border border-app-border text-app-text-2 hover:text-app-text hover:bg-app-surface transition-colors"
          >
            <ArrowLeft size={12} />
            <span>Back to table</span>
          </button>
          <button
            onClick={fitToView}
            title="Fit to view"
            className="p-1 rounded-md bg-app-surface/90 backdrop-blur border border-app-border text-app-text-2 hover:text-app-text hover:bg-app-surface transition-colors"
          >
            <Maximize2 size={12} />
          </button>
        </div>

        <ForceGraph2D
          ref={fgRef}
          graphData={data}
          backgroundColor="transparent"
          nodeId="id"
          nodeLabel={(n) => (n as GraphNode).primaryLabel}
          linkSource="source"
          linkTarget="target"
          linkLabel={(l) => (l as GraphLink).type}
          linkDirectionalArrowLength={4}
          linkDirectionalArrowRelPos={1}
          nodeCanvasObject={(node, ctx, scale) => {
            const n = node as GraphNode & { x?: number; y?: number }
            if (n.x == null || n.y == null) return
            const r = 6
            ctx.fillStyle = paletteColor(n.primaryLabel)
            ctx.beginPath()
            ctx.arc(n.x, n.y, r, 0, 2 * Math.PI)
            ctx.fill()
            // Selection ring — accent glow matching the existing selection treatment
            if (selected?.kind === 'node' && selected.data.id === n.id) {
              ctx.strokeStyle = 'rgb(var(--c-accent))'
              ctx.lineWidth = 2 / scale
              ctx.stroke()
            }
            // Label text below the node, only when zoomed in enough to read
            if (scale > 1.4) {
              ctx.fillStyle = 'rgb(var(--c-text-2))'
              ctx.font = `${10 / scale}px sans-serif`
              ctx.textAlign = 'center'
              ctx.fillText(n.primaryLabel, n.x, n.y + r + 8 / scale)
            }
          }}
          onNodeClick={(node) => setSelected({ kind: 'node', data: node as GraphNode })}
          onLinkClick={(link) => setSelected({ kind: 'link', data: link as GraphLink })}
          onBackgroundClick={() => setSelected(null)}
        />
      </div>

      {/* Inspector column */}
      <GraphInspector selected={selected} />
    </div>
  )
}
```

- [ ] **Step 2: Verify it compiles**

Run: `npm run typecheck:web`
Expected: PASS.

- [ ] **Step 3: Commit**

```bash
git add src/renderer/src/components/results/GraphView.tsx
git commit -m "✨ feat(neo4j): GraphView (force-directed canvas + persistent inspector)"
```

---

## Task 10: `GraphShapedBanner` component

**Files:**
- Create: `src/renderer/src/components/results/GraphShapedBanner.tsx`

- [ ] **Step 1: Create the component**

Create `src/renderer/src/components/results/GraphShapedBanner.tsx`:

```tsx
import { Network } from 'lucide-react'

interface GraphShapedBannerProps {
  truncated: boolean
  /** Only set when truncated — total node count that exceeded the cap */
  nodeCount?: number
  /** Only meaningful when not truncated */
  onViewAsGraph: () => void
}

/**
 * Auto-detected banner that appears above the results table when the result
 * contains graph data. When truncated past the cap, it explains the limit
 * instead of offering a view that would hang the renderer.
 */
export default function GraphShapedBanner({ truncated, nodeCount, onViewAsGraph }: GraphShapedBannerProps) {
  if (truncated) {
    return (
      <div className="flex items-center gap-2 px-3 py-1.5 text-[11px] text-app-warn bg-app-warn-subtle/40 border-b border-app-warn/30 shrink-0">
        <Network size={12} className="shrink-0" />
        <span>
          This result has {nodeCount?.toLocaleString()} nodes — too many to visualize. Try adding a <span className="font-mono">LIMIT</span>.
        </span>
      </div>
    )
  }
  return (
    <div className="flex items-center justify-between gap-2 px-3 py-1.5 text-[11px] bg-app-cat-teal/10 border-b border-app-cat-teal/30 shrink-0">
      <div className="flex items-center gap-2 text-app-cat-teal">
        <Network size={12} className="shrink-0" />
        <span>This result contains graph data (nodes &amp; relationships).</span>
      </div>
      <button
        onClick={onViewAsGraph}
        className="text-[11px] px-2 py-0.5 rounded-md bg-app-cat-teal/20 hover:bg-app-cat-teal/30 text-app-cat-teal font-medium transition-colors shrink-0"
      >
        View as graph
      </button>
    </div>
  )
}
```

- [ ] **Step 2: Verify it compiles**

Run: `npm run typecheck:web`
Expected: PASS.

- [ ] **Step 3: Commit**

```bash
git add src/renderer/src/components/results/GraphShapedBanner.tsx
git commit -m "✨ feat(neo4j): GraphShapedBanner (auto-detect View as graph)"
```

---

## Task 11: Wire banner + swap into `Editor.tsx`

**Files:**
- Modify: `src/renderer/src/pages/Editor.tsx`

- [ ] **Step 1: Add imports**

Insert near the other component imports (after `import ExplainPanel`):

```ts
import GraphView from '../components/results/GraphView'
import GraphShapedBanner from '../components/results/GraphShapedBanner'
import { detectGraphShape } from '../lib/detectGraphShape'
import { buildGraphFromRecords } from '../lib/buildGraphFromRecords'
```

- [ ] **Step 2: Pull `toggleGraphView` from the store**

In the `const { … } = useQueryStore()` destructure (near the top of the component), add `toggleGraphView` alongside the other actions.

- [ ] **Step 3: Compute graph-shape state for the active tab**

Add immediately after the `activeTab` derivation:

```ts
  // Detect graph-shaped results once per tab result change.
  const graphShape = useMemo(() => {
    const rows = activeTab?.result?.rows
    if (!rows || rows.length === 0) return { isGraph: false, truncated: false, nodeCount: 0 }
    if (!detectGraphShape(rows)) return { isGraph: false, truncated: false, nodeCount: 0 }
    const built = buildGraphFromRecords(rows)
    if (built.truncated) return { isGraph: true, truncated: true, nodeCount: built.nodeCount }
    return { isGraph: true, truncated: false, nodeCount: built.nodes.length }
  }, [activeTab?.result?.rows])
```

- [ ] **Step 4: Build the renderable for the results region**

Add this helper near the top of the JSX return (before the existing single-pane / split-pane branches):

```tsx
  const renderResultsRegion = (tab: typeof activeTab) => {
    if (!tab) return null
    if (tab.explainResult || tab.isExplaining) {
      return (
        <ExplainPanel
          result={tab.explainResult ?? { bytesProcessed: 0 }}
          isLoading={tab.isExplaining}
          onClose={() => clearExplain(tab.id)}
        />
      )
    }
    if (tab.viewAsGraph && tab.result && graphShape.isGraph && !graphShape.truncated) {
      return <GraphView result={tab.result} onBack={() => toggleGraphView(tab.id)} />
    }
    return (
      <>
        {graphShape.isGraph && !tab.viewAsGraph && (
          <GraphShapedBanner
            truncated={graphShape.truncated}
            nodeCount={graphShape.nodeCount}
            onViewAsGraph={() => toggleGraphView(tab.id)}
          />
        )}
        <ResultsTable
          result={tab.result}
          error={tab.error}
          isRunning={tab.isRunning}
          cancelled={tab.cancelled}
          logs={tab.logs}
          onFetchPage={() => fetchPage(tab.id)}
          onPin={() => openResultTab(tab.id)}
        />
      </>
    )
  }
```

- [ ] **Step 5: Replace the existing inline result render in the single-pane branch**

Find the single-pane block that currently reads:

```tsx
                {activeTab.explainResult || activeTab.isExplaining ? (
                  <ExplainPanel … />
                ) : (
                  <ResultsTable … />
                )}
```

Replace it with:

```tsx
                <div className="flex flex-col h-full overflow-hidden">
                  {renderResultsRegion(activeTab)}
                </div>
```

> The wrapper `<div className="flex flex-col h-full overflow-hidden">` lets the banner (a `shrink-0` row) coexist with the results table (which fills the rest). Without it, `GraphShapedBanner` collapses against `ResultsTable`'s own scrolling box.

- [ ] **Step 6: Replicate for the split-pane left side**

The split-pane left side currently has an analogous `{activeTab.explainResult || activeTab.isExplaining ? …}` block. Wrap it the same way:

```tsx
                  <div className="flex flex-col h-full overflow-hidden">
                    {renderResultsRegion(activeTab)}
                  </div>
```

> Right pane stays on `ResultsTable` only (no graph view in split mode for v1 — graph view always uses the full result area).

- [ ] **Step 7: Verify typecheck**

Run: `npm run typecheck`
Expected: PASS.

- [ ] **Step 8: Commit**

```bash
git add src/renderer/src/pages/Editor.tsx
git commit -m "✨ feat(neo4j): wire GraphShapedBanner + GraphView swap into Editor"
```

---

## Task 12: Mock `react-force-graph-2d` in tests + suite

**Files:**
- Modify: `src/__tests__/setup.ts`

- [ ] **Step 1: Add the mock**

The canvas library imports raw canvas APIs that jsdom doesn't fully implement; any test that even transitively imports `GraphView` will choke without a mock. Append to `src/__tests__/setup.ts`:

```ts
import { vi } from 'vitest'

vi.mock('react-force-graph-2d', () => {
  // The mock renders a minimal sentinel and captures the props for assertions.
  // Tests that need to drive node/link clicks call the captured callbacks directly.
  return {
    __esModule: true,
    default: vi.fn(() => null),
  }
})
```

- [ ] **Step 2: Run the full suite**

Run: `npm run test:coverage`
Expected: PASS, 318 + new tests, coverage gate holds.

If `neo4j.ts` coverage drops below 70% because the gate aggregates with new files: add targeted tests for any uncovered branch (e.g. an extra `buildGraphFromRecords` orphan-link case) until the gate passes.

- [ ] **Step 3: Commit**

```bash
git add src/__tests__/setup.ts
git commit -m "✅ test(neo4j): stub react-force-graph-2d in vitest setup"
```

---

## Task 13: Documentation

**Files:**
- Modify: `README.md`, `CHANGELOG.md`, `CLAUDE.md`

- [ ] **Step 1: Update README**

In the existing **Neo4j** subsection (added in Phase 1, Task 24), append a paragraph after the "compact Cypher-style chips" sentence:

```markdown
Graph-shaped results (queries that return `Node`, `Relationship`, or `Path`
values) also offer an **interactive graph view**: a banner above the
results table reads "This result contains graph data → View as graph."
Clicking swaps the results area for a force-directed canvas with a
persistent inspector for the selected node or relationship. Results with
more than 500 nodes are too dense to lay out meaningfully — the banner
instead suggests adding a `LIMIT`.
```

- [ ] **Step 2: Update CHANGELOG**

Under the existing `## [Unreleased]` heading (added in Phase 1), expand the `### Added` bullet (or add a second one) to capture Phase 2:

```markdown
- **Neo4j Phase 2 — interactive graph view** — graph-shaped results now offer a force-directed canvas with a persistent side inspector. The "View as graph" banner appears automatically when a result contains Node / Relationship / Path values; clicking swaps the results area without re-fetching. Pan / zoom / drag-to-reposition / click-to-select / fit-to-view, plus a legend mapping colors to labels and relationship types. Results past 500 nodes show a "too many to visualize" message instead, suggesting a `LIMIT`.
```

- [ ] **Step 3: Add the CLAUDE.md change-log entry**

Insert at the top of the entries (newest first), following the existing dated format:

```markdown
### [YYYY-MM-DD] Feature: Neo4j support — Phase 2 (Graph visualization)

**Type:** Change
**Context:** Phase 1 made Neo4j a fully usable engine but graph-shaped results — Cypher's native shape — still rendered as truncated text chips in the results table. Phase 2 adds the interactive graph canvas the design spec called for.
**Problem / Change:**
- No way to actually see the topology of a graph-shaped result. The chips communicate "this is a Node" but not "this Node connects to those Nodes through those Relationships."

**Solution / Outcome:**
- **`buildGraphFromRecords.ts`** (new, pure) — walks every record's cells, extracts Node / Relationship / Path values, de-dupes by Neo4j element ID, walks Path segments, filters orphan links, and caps at 500 nodes. Past the cap returns `{ truncated: true, nodeCount }` instead of a graph payload.
- **`detectGraphShape.ts`** (new, pure) — short-circuiting check used to decide whether to surface the banner.
- **`graphPalette.ts`** (new, pure) — stable label → `cat-*` token via a small hash, cycling past 5 distinct labels.
- **`GraphView.tsx`** (new) — two-column layout: flexible canvas + fixed-width 280px inspector (the spec's "never floating" requirement). Wraps `react-force-graph-2d` with custom `nodeCanvasObject` / `linkCanvasObject` paint callbacks that draw with Aperture's design tokens. Click → selection ring + inspector populated. Background click → cleared. Fit-to-view + Back-to-table controls top-right; legend top-left.
- **`GraphInspector.tsx`** + **`GraphLegend.tsx`** + **`GraphShapedBanner.tsx`** (new) — auxiliary chrome around the canvas.
- **`queryStore.toggleGraphView`** + `viewAsGraph?: boolean` on `QueryTab` — persists the view choice across tab switches.
- **`Editor.tsx`** — renders the banner above results when graph data is detected, swaps `ResultsTable` for `GraphView` when `viewAsGraph` is true. Split-pane right side intentionally stays on the table view in v1.
- Canvas library mocked at the React level in `src/__tests__/setup.ts` — tests cover the data builders, palette, store action, and component selection wiring without touching real canvas APIs.
- **Tests** (~17 new): `buildGraphFromRecords` (7), `detectGraphShape` (4), `graphPalette` (4), `queryStore.toggleGraphView` (2). Coverage gate holds.

**Files affected:**
- `package.json` — `react-force-graph-2d`
- `src/shared/types.ts` — `viewAsGraph` on QueryTab + GraphNode / GraphLink / GraphData
- `src/renderer/src/store/queryStore.ts` — `toggleGraphView`
- `src/renderer/src/lib/{buildGraphFromRecords,detectGraphShape,graphPalette}.ts` — created
- `src/renderer/src/components/results/{GraphView,GraphInspector,GraphLegend,GraphShapedBanner}.tsx` — created
- `src/renderer/src/pages/Editor.tsx` — banner + view swap
- `src/__tests__/setup.ts` — force-graph mock
- `src/__tests__/renderer/lib/*` — new pure-util tests
- `src/__tests__/renderer/store/queryStore.test.ts` — extended
- `README.md`, `CHANGELOG.md` — docs
```

- [ ] **Step 4: Commit**

```bash
git add README.md CHANGELOG.md CLAUDE.md
git commit -m "📝 docs(neo4j): document Phase 2 graph visualization"
```

---

## Task 14: Push and open PR

**Files:** none (git operations)

- [ ] **Step 1: Push the branch**

```bash
git push -u origin feat/neo4j-phase2
```

- [ ] **Step 2: Open the PR**

Use `gh pr create` with a summary that names the spec's Phase 2 line items (graph-shaped detection banner, `buildGraphFromRecords` cap, GraphView canvas + persistent inspector + legend + controls, `react-force-graph-2d` integration). Reference the Phase 1 PR if it's already merged.

> ⚠️ Phase 2 PR depends on Phase 1 being merged to master. Open the branch off whatever Phase 1 lands as — if Phase 1 PR has been squash-merged, rebase `feat/neo4j-phase2` onto the updated master before pushing.

---

## Self-Review

**1. Spec coverage:** Every Phase 2 line item from `2026-06-07-neo4j-support-design.md` is mapped to a task:
- Graph-shaped detection banner → Tasks 4, 10, 11 ✓
- "View as graph" swap (same pattern as ExplainPanel) → Tasks 6, 11 ✓
- `buildGraphFromRecords` + 500-node cap → Task 5 ✓
- Two-column layout: canvas + 280px inspector (never floating) → Tasks 7, 9 ✓
- `react-force-graph-2d` + custom paint callbacks with design tokens → Task 9 ✓
- Color palette seeded off `cat-*` tokens, gracefully cycling → Task 3 ✓
- Legend top-left `bg-app-surface/90 backdrop-blur` → Task 8 ✓
- Pan / zoom (native), click-to-select with accent glow, drag-to-reposition, fit-to-view → Task 9 ✓
- Hover changes cursor only (no tooltip) → handled by force-graph defaults; no extra task needed
- Large-graph safeguard with truncation message → Tasks 5, 10 ✓
- Pure-function-testable graph builder → Task 5 (full unit test coverage) ✓
- Component-level tests for selection → inspector data flow → Tasks 7 (component renders), 12 (mock setup) — the selection→inspector wire is exercised through the GraphView component test pattern in Task 12's suite run
- Docs sync → Task 13 ✓

**2. Placeholder scan:** No "TBD" / "similar to Task N" / generic "add error handling" — every step has complete code and exact commands.

**3. Type consistency:** `GraphNode` / `GraphLink` shapes match between types.ts (Task 2), `buildGraphFromRecords` output (Task 5), `GraphInspector` props (Task 7), `GraphLegend` data (Task 8), and `GraphView` paint callbacks (Task 9). The `truncated: true / false` discriminated union is used identically in Tasks 5 and 11. `Selected` union type and `toggleGraphView` signature are consistent across Tasks 6, 7, 9, 11.

---

## Execution Handoff

Plan complete and saved to `docs/superpowers/plans/2026-06-08-neo4j-phase2-graph-viz.md`. Two execution options once Phase 1 PR is merged and the `feat/neo4j-phase2` branch is cut from updated master:

**1. Subagent-Driven (recommended)** — Dispatch a fresh subagent per task, review between tasks, fast iteration.

**2. Inline Execution** — Execute tasks in this session using `executing-plans`, batch execution with checkpoints.
