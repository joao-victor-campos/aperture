# Catalog alphabetical sorting — design

**Date:** 2026-06-18
**Status:** Approved (pending spec review)

## Goal

Render datasets and tables in the catalog tree in alphabetical order — case-insensitive, locale-aware, with natural numeric ordering — for **all** engines. No changes to adapters, IPC, or stored state; the reordering happens only at display time.

## Motivation

The catalog tree renders datasets and tables in whatever order the adapter's `listTables` / `listDatasets` returns (source order). For Neo4j that is the raw `CALL db.labels()` / `db.relationshipTypes()` order, which is effectively arbitrary. Users want a predictable alphabetical order. The request started with Neo4j but explicitly extends to all engines since the change is engine-agnostic.

## Approach

Sort at display time in `src/renderer/src/components/catalog/CatalogTree.tsx`. Adapters keep returning source order; `catalogStore` keeps storing it verbatim. Only the render reorders.

### Comparator helper (new)

A small pure helper, `src/renderer/src/lib/sortByName.ts`:

```ts
const collator = new Intl.Collator(undefined, { sensitivity: 'base', numeric: true })

export function byName<T extends { name: string }>(a: T, b: T): number {
  return collator.compare(a.name, b.name)
}
```

- `sensitivity: 'base'` → case-insensitive (`apple`, `Banana`, `cherry`).
- `numeric: true` → natural numeric ordering (`t2` before `t10`).
- A single shared `Intl.Collator` instance (cheap, reused across calls).
- Generic over `{ name: string }` so it works for both `Dataset` and `Table`.

### Wiring in `CatalogTree.tsx`

1. **Datasets** — sort `visibleDatasets` with `byName` before the `.map` (currently ~line 113). Use a non-mutating copy (`[...visibleDatasets].sort(byName)`) so upstream arrays/state are not mutated.
2. **Tables** — sort the `tables` array once, after the existing search filter and before rendering (currently ~lines 117–119), again via a non-mutating copy.
   - **Neo4j** — the existing `.filter(t => t.type === 'LABEL')` / `.filter(t => t.type === 'RELATIONSHIP_TYPE')` groups each render in sorted order automatically, because `Array.prototype.filter` preserves relative order.
   - **Other engines** — the flat `tables.map(renderRow)` renders sorted.
3. **Search results** — because the sort is applied *after* the filter, filtered matches are alphabetical too.

## What does NOT change

- DB adapters (`bigquery`, `postgres`, `snowflake`, `neo4j`) and their `listTables` / `listDatasets`.
- `catalogStore` (`tablesByDataset`, `datasetsByConnection` keep source order).
- IPC channels and shared types.
- The Neo4j Labels / Relationship Types grouping and section headers.
- Dataset expansion state, active-row highlighting, table-detail behavior.

## Edge cases

- **Empty names** — sort harmlessly to the front; no crash.
- **Identical names** — stable relative order is acceptable (`id` is unique anyway).
- **Mixed case / numbers** — handled by `sensitivity: 'base'` + `numeric: true` (e.g. `Table2` < `table10`).
- **Non-mutation** — always sort a copy so we never reorder Zustand-held arrays in place.

## Testing

- Unit tests for `byName` in `src/__tests__/renderer/lib/sortByName.test.ts`:
  - case-insensitive ordering (`Banana` between `apple` and `cherry`),
  - natural numeric ordering (`t2` before `t10`),
  - empty-name handling,
  - equal-name returns 0,
  - usable directly as an `Array.prototype.sort` comparator over a `Table[]` / `Dataset[]` shape.
- Render wiring is covered implicitly; no store/adapter/IPC test surface changes. The new `lib/` helper sits outside the coverage `include` set (like the other pure parsers, e.g. `detectMissingLimit`, `paginate`), so the 70% coverage gate is unaffected.

## Files affected

- `src/renderer/src/lib/sortByName.ts` — created (pure comparator).
- `src/renderer/src/components/catalog/CatalogTree.tsx` — sort datasets + tables before render.
- `src/__tests__/renderer/lib/sortByName.test.ts` — created.
- `README.md`, `CHANGELOG.md` — note alphabetical catalog ordering.
- `CLAUDE.md` — change-log entry.
