# Catalog Alphabetical Sorting Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Render datasets and tables in the catalog tree in alphabetical order (case-insensitive, locale-aware, natural numeric) for all engines, by sorting only at display time.

**Architecture:** Add one pure comparator helper (`byName`) backed by a shared `Intl.Collator`. Wire it into `CatalogTree.tsx` to sort the dataset list and the per-dataset table list (on non-mutating copies) just before render. No adapter, store, IPC, or type changes — the Neo4j Labels/Relationship-Types grouping keeps working because `filter` preserves order.

**Tech Stack:** TypeScript, React, Zustand, Vitest. `Intl.Collator` (built-in, no new dependency).

---

### Task 1: `byName` comparator helper

**Files:**
- Create: `src/renderer/src/lib/sortByName.ts`
- Test: `src/__tests__/renderer/lib/sortByName.test.ts`

- [ ] **Step 1: Write the failing test**

Create `src/__tests__/renderer/lib/sortByName.test.ts`:

```ts
import { describe, it, expect } from 'vitest'
import { byName } from '../../../renderer/src/lib/sortByName'

describe('byName', () => {
  it('sorts case-insensitively', () => {
    const out = [{ name: 'cherry' }, { name: 'Banana' }, { name: 'apple' }].sort(byName)
    expect(out.map((x) => x.name)).toEqual(['apple', 'Banana', 'cherry'])
  })

  it('sorts numbers naturally (t2 before t10)', () => {
    const out = [{ name: 't10' }, { name: 't2' }, { name: 't1' }].sort(byName)
    expect(out.map((x) => x.name)).toEqual(['t1', 't2', 't10'])
  })

  it('returns 0 for equal names', () => {
    expect(byName({ name: 'X' }, { name: 'x' })).toBe(0)
  })

  it('handles empty names without throwing', () => {
    const out = [{ name: 'b' }, { name: '' }, { name: 'a' }].sort(byName)
    expect(out.map((x) => x.name)).toEqual(['', 'a', 'b'])
  })

  it('works over a Table-shaped array (extra fields ignored)', () => {
    const out = [
      { id: '1', name: 'Zeta', type: 'LABEL' },
      { id: '2', name: 'alpha', type: 'LABEL' },
    ].sort(byName)
    expect(out.map((x) => x.name)).toEqual(['alpha', 'Zeta'])
  })
})
```

- [ ] **Step 2: Run test to verify it fails**

Run: `npx vitest run src/__tests__/renderer/lib/sortByName.test.ts`
Expected: FAIL — cannot resolve module `sortByName` / `byName is not a function`.

- [ ] **Step 3: Write minimal implementation**

Create `src/renderer/src/lib/sortByName.ts`:

```ts
// Shared collator: case-insensitive, locale-aware, natural numeric ordering.
const collator = new Intl.Collator(undefined, { sensitivity: 'base', numeric: true })

/**
 * Comparator for `Array.prototype.sort` over any `{ name: string }` shape
 * (Dataset, Table, …). Sorts alphabetically, case-insensitively, with
 * natural numeric ordering (`t2` before `t10`).
 */
export function byName<T extends { name: string }>(a: T, b: T): number {
  return collator.compare(a.name, b.name)
}
```

- [ ] **Step 4: Run test to verify it passes**

Run: `npx vitest run src/__tests__/renderer/lib/sortByName.test.ts`
Expected: PASS — 5 tests pass.

- [ ] **Step 5: Commit**

```bash
git add src/renderer/src/lib/sortByName.ts src/__tests__/renderer/lib/sortByName.test.ts
git commit -m "✨ feat(catalog): add byName comparator (case-insensitive, numeric)"
```

---

### Task 2: Sort datasets in `CatalogTree`

**Files:**
- Modify: `src/renderer/src/components/catalog/CatalogTree.tsx` (import + `visibleDatasets`, ~lines 7-8 and ~lines 59-65)

- [ ] **Step 1: Add the import**

In `src/renderer/src/components/catalog/CatalogTree.tsx`, after the existing `buildCypherQuery` import (currently line 8):

```ts
import { buildLabelQuery, buildRelationshipTypeQuery } from '../../lib/buildCypherQuery'
import { byName } from '../../lib/sortByName'
```

- [ ] **Step 2: Sort the dataset list**

The current code (~lines 58-65) is:

```ts
  // Filter: show dataset if its name matches OR if any loaded table's name matches
  const visibleDatasets = query
    ? datasets.filter((ds) => {
        if (ds.name.toLowerCase().includes(query)) return true
        const key = `${activeConnectionId}:${ds.id}`
        return (tablesByDataset[key] ?? []).some((t) => t.name.toLowerCase().includes(query))
      })
    : datasets
```

Replace it with a sorted copy (note `[...].sort(byName)` — never mutate the store-held array):

```ts
  // Filter: show dataset if its name matches OR if any loaded table's name matches
  const filteredDatasets = query
    ? datasets.filter((ds) => {
        if (ds.name.toLowerCase().includes(query)) return true
        const key = `${activeConnectionId}:${ds.id}`
        return (tablesByDataset[key] ?? []).some((t) => t.name.toLowerCase().includes(query))
      })
    : datasets
  // Render datasets alphabetically (sort a copy — never mutate store state)
  const visibleDatasets = [...filteredDatasets].sort(byName)
```

- [ ] **Step 3: Verify it typechecks**

Run: `npx tsc -p tsconfig.web.json --noEmit`
Expected: PASS — no type errors. (`visibleDatasets` is still `Dataset[]`; downstream `.map`/`.length` usages are unchanged.)

- [ ] **Step 4: Commit**

```bash
git add src/renderer/src/components/catalog/CatalogTree.tsx
git commit -m "✨ feat(catalog): sort datasets alphabetically"
```

---

### Task 3: Sort tables in `CatalogTree`

**Files:**
- Modify: `src/renderer/src/components/catalog/CatalogTree.tsx` (~lines 116-119, inside the `visibleDatasets.map` callback)

- [ ] **Step 1: Sort the per-dataset table list**

The current code (~lines 116-119) is:

```ts
        const allTables = tablesByDataset[key] ?? []
        const tables = query
          ? allTables.filter((t) => t.name.toLowerCase().includes(query))
          : allTables
```

Replace it with a sorted copy:

```ts
        const allTables = tablesByDataset[key] ?? []
        const filteredTables = query
          ? allTables.filter((t) => t.name.toLowerCase().includes(query))
          : allTables
        // Render tables alphabetically (sort a copy — never mutate store state).
        // For Neo4j the downstream `.filter(type === …)` groups preserve this order.
        const tables = [...filteredTables].sort(byName)
```

- [ ] **Step 2: Verify it typechecks**

Run: `npx tsc -p tsconfig.web.json --noEmit`
Expected: PASS — no type errors. (`tables` is still `Table[]`; the existing `tables.some(...)`, `tables.filter(...)`, `tables.map(renderRow)`, and `tables.length === 0` usages are unchanged.)

- [ ] **Step 3: Run the full renderer test suite + typecheck**

Run: `npx vitest run && npx tsc -p tsconfig.web.json --noEmit`
Expected: PASS — all existing tests plus the 5 new `sortByName` tests pass; no type errors.

- [ ] **Step 4: Commit**

```bash
git add src/renderer/src/components/catalog/CatalogTree.tsx
git commit -m "✨ feat(catalog): sort tables alphabetically (all engines)"
```

---

### Task 4: Documentation

**Files:**
- Modify: `CHANGELOG.md` (Unreleased section)
- Modify: `README.md` (catalog browser description, if it lists catalog behavior)
- Modify: `CLAUDE.md` (append a Change Log entry)

- [ ] **Step 1: Add a CHANGELOG entry**

In `CHANGELOG.md`, under the `## [Unreleased]` heading (create an `### Added` subsection if absent), add:

```markdown
### Added
- Catalog tree now lists datasets and tables alphabetically (case-insensitive, natural numeric ordering) for all engines. Neo4j Labels and Relationship Types are each sorted within their group.
```

- [ ] **Step 2: Update README if it documents catalog ordering**

Open `README.md` and find the catalog-browser feature description. If it describes how datasets/tables are listed, add a sentence: "Datasets and tables are listed alphabetically." If README does not describe ordering, leave it unchanged (no invented sections).

- [ ] **Step 3: Append the CLAUDE.md change-log entry**

In `CLAUDE.md`, directly under the `## Change Log & Error Report` `### Format` block (i.e. as the newest entry, above `[2026-06-14] Feature: Smarter SQL autocomplete`), add:

```markdown
### [2026-06-18] Feature: Alphabetical catalog sorting

**Type:** Change
**Context:** The catalog tree rendered datasets and tables in source order (for Neo4j, raw `CALL db.labels()` / `db.relationshipTypes()` order). Per spec `docs/superpowers/specs/2026-06-18-catalog-alphabetical-sort-design.md` and plan `docs/superpowers/plans/2026-06-18-catalog-alphabetical-sort.md`.
**Problem / Change:** No alphabetical ordering — requested first for Neo4j, applied to all engines since the change is engine-agnostic.
**Solution / Outcome:**
- **`sortByName.ts`** (new, pure) — `byName` comparator over `{ name: string }`, backed by a shared `Intl.Collator` (`sensitivity: 'base'`, `numeric: true`): case-insensitive, locale-aware, natural numeric (`t2` before `t10`). 5 unit tests.
- **`CatalogTree.tsx`** — sorts `visibleDatasets` and the per-dataset `tables` list on non-mutating copies (`[...].sort(byName)`) just before render. Sort runs after the search filter, so filtered matches are alphabetical too. Neo4j's `.filter(type === 'LABEL' / 'RELATIONSHIP_TYPE')` groups stay correct because `filter` preserves order.
- No adapter / store / IPC / type changes. New `lib/` helper sits outside the coverage include set, so the 70% gate is unaffected.

**Files affected:**
- `src/renderer/src/lib/sortByName.ts` — created
- `src/__tests__/renderer/lib/sortByName.test.ts` — created (5 tests)
- `src/renderer/src/components/catalog/CatalogTree.tsx` — sort datasets + tables before render
- `README.md`, `CHANGELOG.md` — docs
```

- [ ] **Step 4: Commit**

```bash
git add CHANGELOG.md README.md CLAUDE.md
git commit -m "📝 docs: alphabetical catalog sorting"
```

---

## Self-Review Notes

- **Spec coverage:** comparator helper (Task 1) ✓; datasets sorted (Task 2) ✓; tables sorted incl. Neo4j grouping preserved (Task 3) ✓; non-mutating copies ✓; search-after-filter ordering ✓; tests for case/numeric/empty/equal/Table-shape ✓ (Task 1); docs incl. CLAUDE.md log + CHANGELOG + README (Task 4) ✓; "no adapter/store/IPC change" honored ✓.
- **Naming consistency:** helper `byName` and module `sortByName` used identically in every task. Intermediate locals `filteredDatasets` / `filteredTables` introduced and consumed within the same task.
- **No placeholders:** every code/command step is concrete.
