# TableDetailPanel Logic Extraction Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Extract the three pure, module-level helpers embedded in `TableDetailPanel.tsx` — `flattenFields` (+ `FlatField`), `typeColor`, and a buggy local `formatCell` — into tested `lib/*` modules, and in doing so fix a latent BigQuery preview-rendering bug by consolidating onto the shared `lib/formatCell.ts`.

**Architecture:** Third step of the "harden what exists" campaign (after #37 ConnectionModal extraction and #38 CodeMirror-helper coverage + gate widening). Same idiom: pull pure logic out of a fat component into `lib/*` helpers, unit-test them, keep the component thin. `flattenFields` and `typeColor` move verbatim (pure refactor). The local `formatCell` is **deleted** and replaced by an import of the existing `lib/formatCell.ts` — which unwraps BigQuery's `{ value: "..." }` wrapper that the local copy did not, **fixing** the preview tab (DATE/TIMESTAMP/NUMERIC cells currently render as raw JSON like `{"value":"2024-01-01"}` instead of `2024-01-01`).

**Tech Stack:** TypeScript (strict), React, Vitest. Vite path alias `@shared` → `src/shared`.

## Global Constraints

- **Branch only — never commit to `master`.** Work happens on branch `harden/table-detail-extract` (already created from `origin/master`).
- **TypeScript strict mode; no `any`.**
- **`flattenFields` and `typeColor` are a PURE refactor** — copy their logic byte-for-byte; the component must render identically for those two.
- **The `formatCell` consolidation is a deliberate behavior FIX, not a no-op.** After this change the preview tab unwraps BigQuery `{ value }` wrappers. This is intended. The shared `lib/formatCell.ts` already has tests pinning that behavior (`unwraps BigQuery { value } wrappers`), so no new formatCell test is required — but the change must be called out in the Change Log.
- **`lib/**` is now INSIDE the coverage gate** (widened in #38). The new `lib/*` files are coverage-enforced at the 70% threshold, so they must ship with tests (they do, below). `just ci` must be fully green.
- **Append a Change Log entry to `CLAUDE.md`** per the project rule (Task 3). README needs no update — no user-facing/architecture/auth/command change beyond the internal fix.
- `TableField` shape (from `@shared/types`): `{ name: string; type: string; mode: 'NULLABLE' | 'REQUIRED' | 'REPEATED'; description?: string; fields?: TableField[] }`.

---

### Task 1: `flattenFields` — pure depth-first schema flattener

**Files:**
- Create: `src/renderer/src/lib/flattenFields.ts`
- Test: `src/__tests__/renderer/lib/flattenFields.test.ts`

**Interfaces:**
- Consumes: `TableField` from `@shared/types`.
- Produces:
  - `interface FlatField { field: TableField; depth: number }`
  - `function flattenFields(fields: TableField[], depth?: number): FlatField[]`

- [ ] **Step 1: Write the failing test**

Create `src/__tests__/renderer/lib/flattenFields.test.ts`:

```ts
import { describe, it, expect } from 'vitest'
import { flattenFields, type FlatField } from '../../../renderer/src/lib/flattenFields'
import type { TableField } from '@shared/types'

const f = (name: string, fields?: TableField[]): TableField => ({
  name,
  type: fields ? 'RECORD' : 'STRING',
  mode: 'NULLABLE',
  ...(fields ? { fields } : {}),
})

describe('flattenFields', () => {
  it('returns an empty array for empty input', () => {
    expect(flattenFields([])).toEqual([])
  })

  it('flattens a flat schema at depth 0 preserving order', () => {
    const rows = flattenFields([f('a'), f('b'), f('c')])
    expect(rows.map((r: FlatField) => [r.field.name, r.depth])).toEqual([
      ['a', 0],
      ['b', 0],
      ['c', 0],
    ])
  })

  it('emits nested RECORD children at depth+1 immediately after their parent (depth-first)', () => {
    const rows = flattenFields([f('parent', [f('child1'), f('child2')]), f('sibling')])
    expect(rows.map((r) => [r.field.name, r.depth])).toEqual([
      ['parent', 0],
      ['child1', 1],
      ['child2', 1],
      ['sibling', 0],
    ])
  })

  it('recurses through multiple levels of nesting', () => {
    const rows = flattenFields([f('lvl0', [f('lvl1', [f('lvl2')])])])
    expect(rows.map((r) => [r.field.name, r.depth])).toEqual([
      ['lvl0', 0],
      ['lvl1', 1],
      ['lvl2', 2],
    ])
  })

  it('treats an empty fields array as a leaf (no recursion)', () => {
    const leaf: TableField = { name: 'x', type: 'RECORD', mode: 'NULLABLE', fields: [] }
    expect(flattenFields([leaf])).toEqual([{ field: leaf, depth: 0 }])
  })
})
```

- [ ] **Step 2: Run the test to verify it fails**

Run: `npx vitest run src/__tests__/renderer/lib/flattenFields.test.ts`
Expected: FAIL — module `flattenFields` not found.

- [ ] **Step 3: Write the minimal implementation**

Create `src/renderer/src/lib/flattenFields.ts`:

```ts
import type { TableField } from '@shared/types'

/** A schema field plus its nesting depth, for flat table rendering. */
export interface FlatField {
  field: TableField
  depth: number
}

/**
 * Depth-first flatten of a (possibly nested RECORD/STRUCT) schema into rows.
 * Each field is emitted before its children; children carry depth + 1.
 */
export function flattenFields(fields: TableField[], depth = 0): FlatField[] {
  const result: FlatField[] = []
  for (const f of fields) {
    result.push({ field: f, depth })
    if (f.fields?.length) result.push(...flattenFields(f.fields, depth + 1))
  }
  return result
}
```

- [ ] **Step 4: Run the test to verify it passes**

Run: `npx vitest run src/__tests__/renderer/lib/flattenFields.test.ts`
Expected: PASS — all 5 tests green.

- [ ] **Step 5: Commit**

```bash
git add src/renderer/src/lib/flattenFields.ts src/__tests__/renderer/lib/flattenFields.test.ts
git commit -m "refactor(catalog): extract flattenFields pure helper + tests"
```

---

### Task 2: `typeColor` — pure schema-type → token mapping

**Files:**
- Create: `src/renderer/src/lib/schemaTypeColor.ts`
- Test: `src/__tests__/renderer/lib/schemaTypeColor.test.ts`

**Interfaces:**
- Consumes: nothing.
- Produces: `function typeColor(type: string): string` (returns a Tailwind text-color class).

- [ ] **Step 1: Write the failing test**

Create `src/__tests__/renderer/lib/schemaTypeColor.test.ts`:

```ts
import { describe, it, expect } from 'vitest'
import { typeColor } from '../../../renderer/src/lib/schemaTypeColor'

describe('typeColor', () => {
  it('maps string types to the green token', () => {
    expect(typeColor('STRING')).toBe('text-app-cat-green')
    expect(typeColor('BYTES')).toBe('text-app-cat-green')
  })

  it('maps numeric types to the blue token', () => {
    for (const t of ['INTEGER', 'INT64', 'FLOAT', 'FLOAT64', 'NUMERIC', 'BIGNUMERIC']) {
      expect(typeColor(t)).toBe('text-app-cat-blue')
    }
  })

  it('maps boolean types to the warn token', () => {
    expect(typeColor('BOOLEAN')).toBe('text-app-warn')
    expect(typeColor('BOOL')).toBe('text-app-warn')
  })

  it('maps temporal types to the purple token', () => {
    for (const t of ['TIMESTAMP', 'DATE', 'TIME', 'DATETIME']) {
      expect(typeColor(t)).toBe('text-app-cat-purple')
    }
  })

  it('maps record/struct types to the accent token', () => {
    expect(typeColor('RECORD')).toBe('text-app-accent-text')
    expect(typeColor('STRUCT')).toBe('text-app-accent-text')
  })

  it('falls back to the muted token for unknown types', () => {
    expect(typeColor('GEOGRAPHY')).toBe('text-app-text-2')
    expect(typeColor('')).toBe('text-app-text-2')
  })

  it('is case-insensitive', () => {
    expect(typeColor('string')).toBe('text-app-cat-green')
    expect(typeColor('int64')).toBe('text-app-cat-blue')
  })
})
```

- [ ] **Step 2: Run the test to verify it fails**

Run: `npx vitest run src/__tests__/renderer/lib/schemaTypeColor.test.ts`
Expected: FAIL — module `schemaTypeColor` not found.

- [ ] **Step 3: Write the minimal implementation**

Create `src/renderer/src/lib/schemaTypeColor.ts` (logic copied verbatim from the component):

```ts
/** Map a SQL/BigQuery column type to a semantic categorical text-color token. */
export function typeColor(type: string): string {
  switch (type.toUpperCase()) {
    case 'STRING':
    case 'BYTES':
      return 'text-app-cat-green'
    case 'INTEGER':
    case 'INT64':
    case 'FLOAT':
    case 'FLOAT64':
    case 'NUMERIC':
    case 'BIGNUMERIC':
      return 'text-app-cat-blue'
    case 'BOOLEAN':
    case 'BOOL':
      return 'text-app-warn'
    case 'TIMESTAMP':
    case 'DATE':
    case 'TIME':
    case 'DATETIME':
      return 'text-app-cat-purple'
    case 'RECORD':
    case 'STRUCT':
      return 'text-app-accent-text'
    default:
      return 'text-app-text-2'
  }
}
```

- [ ] **Step 4: Run the test to verify it passes**

Run: `npx vitest run src/__tests__/renderer/lib/schemaTypeColor.test.ts`
Expected: PASS — all 7 tests green.

- [ ] **Step 5: Commit**

```bash
git add src/renderer/src/lib/schemaTypeColor.ts src/__tests__/renderer/lib/schemaTypeColor.test.ts
git commit -m "refactor(catalog): extract typeColor pure helper + tests"
```

---

### Task 3: Wire `TableDetailPanel` to the extracted helpers + fix `formatCell`

**Files:**
- Modify: `src/renderer/src/components/catalog/TableDetailPanel.tsx`
- Modify: `CLAUDE.md` (append Change Log entry)

**Interfaces:**
- Consumes: `flattenFields` + `FlatField` (Task 1), `typeColor` (Task 2), and the existing `formatCell` from `src/renderer/src/lib/formatCell.ts`.
- Produces: nothing new — props and (except the formatCell fix) rendered output unchanged.

- [ ] **Step 1: Add the imports**

In `src/renderer/src/components/catalog/TableDetailPanel.tsx`, add below the existing imports (after the `buildCypherQuery` import on line 8):

```ts
import { flattenFields, type FlatField } from '../../lib/flattenFields'
import { typeColor } from '../../lib/schemaTypeColor'
import { formatCell } from '../../lib/formatCell'
```

- [ ] **Step 2: Delete the four local definitions**

Delete the entire block at the bottom of the file (originally lines 291–319): the `interface FlatField { … }`, `function flattenFields(…) { … }`, `function typeColor(…) { … }`, and `function formatCell(…) { … }`. They are now imported. Leave the trailing newline at end of file.

(Do not change `SchemaSection` or `PreviewSection` bodies — they call `flattenFields(...)`, `typeColor(...)`, and `formatCell(...)` by the same names, now resolved via the new imports.)

- [ ] **Step 3: Typecheck — confirm no unused/missing symbols**

Run: `npm run typecheck`
Expected: PASS. (If `FlatField` is reported unused, confirm it is still referenced — it is, implicitly, only inside `flattenFields`'s return type; the component itself does not name `FlatField`, so if TS/eslint flags the imported `FlatField` as unused, drop it from the import and keep only `flattenFields`. Re-run typecheck.)

> Implementer note: the component maps over `flattenFields(...)` results inline (`visibleRows.map(...)`) without ever writing the type name `FlatField`. If the lint/TS config errors on the unused import, the correct resolution is `import { flattenFields } from '../../lib/flattenFields'` (no `FlatField`). Decide based on what `npm run typecheck` actually reports.

- [ ] **Step 4: Run the full test suite**

Run: `npx vitest run`
Expected: PASS — entire suite green, including the existing `lib/formatCell.test.ts` (which already pins the `{ value }` unwrap that the preview now uses).

- [ ] **Step 5: Append the Change Log entry to `CLAUDE.md`**

Add this as the newest entry, immediately below the `<!-- Entries go below this line, newest first -->` comment (above the current top entry):

```markdown
### [2026-06-23] Refactor: Extract TableDetailPanel schema helpers + fix BigQuery preview formatting

**Type:** Change
**Context:** Third step of the "harden what exists" campaign (after #37 ConnectionModal extraction and #38 CodeMirror-helper coverage + `lib/**` gate widening). `TableDetailPanel.tsx` carried three pure module-level helpers inline and untested: `flattenFields` (recursive nested-RECORD flattening), `typeColor` (type → token mapping), and a local `formatCell` that **duplicated and diverged from** the shared `lib/formatCell.ts`.
**Problem / Change:** The local `formatCell` did not unwrap BigQuery's `{ value: "..." }` wrappers, so the table preview rendered DATE/TIMESTAMP/NUMERIC cells as raw JSON (`{"value":"2024-01-01"}`) instead of their value. The recursive flattener and the type map were also untested.
**Solution / Outcome:**
- **`src/renderer/src/lib/flattenFields.ts`** (new, pure): `FlatField` + `flattenFields(fields, depth?)`, moved verbatim; depth-first, child-after-parent.
- **`src/renderer/src/lib/schemaTypeColor.ts`** (new, pure): `typeColor(type)`, moved verbatim.
- **`TableDetailPanel.tsx`**: imports the two new helpers and the shared `formatCell`; the four local definitions (incl. the buggy `formatCell`) removed. Swapping to the shared `formatCell` **fixes** the preview-rendering bug — DATE/TIMESTAMP/NUMERIC now render their unwrapped value.
- **Tests** (new): `flattenFields.test.ts` (empty, flat, nested, multi-level, empty-fields-leaf) and `schemaTypeColor.test.ts` (each token group + unknown fallback + case-insensitivity). The `formatCell` fix is already pinned by the existing `lib/formatCell.test.ts` `{ value }`-unwrap test. `lib/**` is inside the coverage gate (since #38), so the new helpers are coverage-enforced.

**Files affected:**
- `src/renderer/src/lib/flattenFields.ts` — created
- `src/renderer/src/lib/schemaTypeColor.ts` — created
- `src/__tests__/renderer/lib/flattenFields.test.ts` — created
- `src/__tests__/renderer/lib/schemaTypeColor.test.ts` — created
- `src/renderer/src/components/catalog/TableDetailPanel.tsx` — delegate to helpers; drop the buggy local `formatCell`
```

- [ ] **Step 6: Run the full CI suite locally**

Run: `just ci`
Expected: PASS — typecheck + tests + coverage gate all green. (`lib/flattenFields.ts` and `lib/schemaTypeColor.ts` are fully covered by their tests, satisfying the 70% gate that now includes `lib/**`.)

- [ ] **Step 7: Commit**

```bash
git add src/renderer/src/components/catalog/TableDetailPanel.tsx CLAUDE.md
git commit -m "refactor(catalog): wire TableDetailPanel to extracted helpers; fix BigQuery preview formatting"
```

---

## Done when

- `lib/flattenFields.ts` and `lib/schemaTypeColor.ts` exist with their exports, fully tested.
- `TableDetailPanel.tsx` contains no local `flattenFields` / `typeColor` / `formatCell` / `FlatField` definitions and imports them from `lib/`.
- The preview tab now renders BigQuery `{ value }` cells unwrapped (verified via the shared `formatCell` behavior already under test).
- `just ci` is green (with `lib/**` coverage-enforced).
- The `CLAUDE.md` Change Log has the 2026-06-23 entry.
