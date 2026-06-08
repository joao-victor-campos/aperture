# Neo4j Support — Design Spec

**Date:** 2026-06-07
**Status:** Approved for planning

## Context

Aperture currently supports three relational/columnar engines — BigQuery, Postgres, Snowflake — all sharing one architectural shape: catalog = projects/databases → datasets → tables, results = paginated rows with typed scalar columns, query language = SQL. A user has requested **Neo4j** support: a graph database queried with **Cypher**, whose native data shapes (nodes, relationships, paths with dynamic properties) don't map onto "rows and columns" the way SQL results do.

This spec covers a **full-depth integration**: a proper adapter, graph-aware catalog browsing, Cypher-aware results handling, and an interactive graph visualization — not just "run Cypher and dump rows."

## Goals

- Add Neo4j as a fourth, first-class engine following the exact `DbAdapter<TConnection>` pattern established by the Snowflake integration
- Represent graph-native concepts (databases, labels, relationship types) in the catalog tree without forcing a relational shape onto them
- Render query results sensibly whether they're scalar-shaped (e.g. `RETURN p.name, count(*)`) or graph-shaped (e.g. `RETURN p, r, f`)
- Offer an **interactive graph visualization** for graph-shaped results, on demand, without adding any new chrome to non-graph-shaped results or to other engines
- Reuse existing infrastructure (auto-limit guard, explain plan viewer, export, history, ⌘K, split panes, pagination/cancellation patterns) wherever the underlying concept transfers, rather than building parallel systems

## Non-goals (out of scope for this iteration)

- Constraints/indexes browsing in the catalog (`SHOW CONSTRAINTS` / `SHOW INDEXES`) — possible future addition, not required for a usable v1
- APOC-procedure-dependent features — the app must work against a vanilla Neo4j install with no plugins
- Cross-engine parameterized-query UI (`$param` forms) — a generally useful idea, but a separate feature orthogonal to "Neo4j support" specifically
- Non-basic auth (Kerberos, custom auth providers) — username/password covers the overwhelming majority of deployments; URI scheme (`neo4j://` vs `neo4j+s://`) handles encryption without extra UI

## Architecture & data model

- **`Neo4jConnection`** type added to `shared/types.ts`: `{ uri: string; username: string; password: string; database?: string }`. `uri` examples: `neo4j://localhost:7687`, `neo4j+s://xxxx.databases.neo4j.io`. `database` optional, defaults to `"neo4j"` (Neo4j 4.0+ multi-database support).
- `'neo4j'` added to the `ConnectionEngine` union; `Neo4jConnection` added to `Connection` / `ConnectionCreate` unions.
- **`src/main/db/neo4j.ts`** (new) implements the full `DbAdapter<Neo4jConnection>` surface:
  - `testConnection` — `driver.verifyConnectivity()`
  - `listDatasets` — `SHOW DATABASES` (each database = one "dataset" in the existing tree shape)
  - `listTables` — `CALL db.labels()` + `CALL db.relationshipTypes()`, results tagged with a `kind: 'label' | 'relationship'` discriminator so the catalog tree can group them
  - `getTableSchema` — samples nodes/relationships (`MATCH (n:Person) RETURN n LIMIT 50`) and infers the union of property keys + value types across the sample (see "Known limitation" below)
  - `runQuery` — Bolt session (`driver.session({ database })`), streamed records, same heartbeat/timeout/cancel pattern as existing adapters (a session's `.close()` mid-stream cancels cleanly)
  - `getQueryPage` — numeric offset-based pagination over a retained result handle (the **Snowflake pattern** — Cypher has no BigQuery-style native page-token concept)
  - `cancelRunningQuery` — closes the active session
  - `dryRunQuery` — `EXPLAIN <query>`, extracting the structured plan tree from the result summary
  - `searchTables` — matches against label and relationship-type names
  - `invalidateClient` — `driver.close()`
- Registered in `adapterRegistry.ts`'s `registry`, following the existing engine-agnostic `getAdapterForConnection` lookup.
- Uses the official **`neo4j-driver`** npm package (Bolt protocol) — added as a production dependency, same role `snowflake-sdk` plays for Snowflake.
- **New accent token**: `cat-teal` (BigQuery/Postgres/Snowflake already occupy `cat-blue`/`cat-purple`/`accent-text`). Applied at the same two points the existing per-engine accents appear: `engineAccent()` in `TitleBar` (breadcrumb + connection-dropdown subtitle) and the catalog tree's label/relationship-type icon colors.

## Connection setup

A fourth tab ("Neo4j") in the existing unified `ConnectionModal`, with a dedicated `Neo4jForm` sub-component mirroring `SnowflakeForm`/`PostgresForm`:

| Field | Notes |
|---|---|
| Connection URI | `neo4j://localhost:7687` placeholder; accepts `neo4j+s://` for encrypted |
| Username | required |
| Password | required, masked |
| Database | optional, placeholder `neo4j` |

Test & Save / edit flows reuse the existing modal machinery unchanged.

## Catalog browsing

Hierarchy: **Connection → Database → {Labels, Relationship Types}**.

```
📁 neo4j  (database)
   LABELS
   ⬤ Person · 1,204        ⬤ Company · 88
   RELATIONSHIP TYPES
   → KNOWS · 3,012          → WORKS_AT · 1,195
```

Two small-caps section headers ("Labels" / "Relationship Types") under each database — both kinds are equally first-class, independently clickable catalog citizens (this was chosen over a single merged list or a "labels-primary, relationships-nested" layout, to keep both concepts equally discoverable and to reuse the existing section-label component verbatim).

- Counts come from `CALL db.labels()` / `CALL db.relationshipTypes()` joined with a lightweight `MATCH (n:X) RETURN count(n)` per item (cached, same caching posture as existing dataset table-counts)
- Clicking a **label** opens a detail tab reusing `TableDetailPanel`'s shape: "Schema" tab shows the sample-inferred property keys (type-colored the same way relational columns are), "Preview" tab shows sample nodes as rows
- Clicking a **relationship type** opens an analogous detail tab for sample relationships
- "Query label" / "Query relationship type" catalog actions generate `MATCH (n:Person) RETURN n LIMIT 100` / `MATCH ()-[r:KNOWS]-() RETURN r LIMIT 100` respectively (the Neo4j equivalent of `buildSelectQuery`)
- `searchTables` (powering ⌘K) matches against label and relationship-type names

**Known limitation (to be stated in-product):** Neo4j is schema-optional — there's no authoritative schema to read, unlike BigQuery/Postgres. The "Schema" tab is explicitly framed as *sample-inferred* ("inferred from 50 sampled nodes"), not authoritative, to set correct expectations.

## Query editor

A lightweight custom CodeMirror `StreamLanguage` for Cypher syntax highlighting (keywords: `MATCH`, `OPTIONAL MATCH`, `WHERE`, `RETURN`, `WITH`, `CREATE`, `MERGE`, `DELETE`, `SET`, `ORDER BY`, `LIMIT`, `SKIP`, etc.) — selected per-connection the same way SQL dialects are today. Schema-aware autocomplete sources suggestions from the catalog cache: label names, relationship types, and sample-inferred property keys.

## Results: scalar vs. graph-shaped

Every Cypher result becomes rows of cells, but a cell's *value* may be a raw scalar **or** a Node/Relationship/Path object — Cypher has no concept of "flatten to columns" the way SQL projections do.

- **Scalar values** (`string`, `number`, `boolean`, temporal/spatial types) render through the existing cell-formatting path, unchanged
- **Node / Relationship / Path values** render as a **compact Cypher-style chip**, e.g. `(:Person {name: "Alice"})`, truncated for long property lists. Clicking a chip opens the same side-inspector component the graph view uses — table view and graph view share one "inspect a graph element" UI rather than two parallel ones. (This was chosen over raw-JSON dumping, which is ugly and leaks driver internals, and over auto-flattening to `p.name`/`p.age` columns, which breaks down when different rows' nodes have different property sets — extremely common in graphs.)

**Graph-shaped detection**: after a query completes, the result's field types are scanned. If **any** field across any record is a Node, Relationship, or Path, a banner appears above the results: *"This result contains graph data (nodes & relationships) → View as graph."* Pure-scalar results get **zero new UI** — byte-for-byte the same experience as every other engine. (This auto-detected-banner approach was chosen over an always-present Table/Graph tab pair or an always-on split view, specifically so that the 3 existing engines' results panels — and any Neo4j query that merely returns scalars — remain completely untouched.)

## Graph view

Clicking "View as graph" swaps the results area for a `GraphView` component (the same swap pattern `ExplainPanel` already uses in place of `ResultsTable`). A "← Back to table" control returns without re-fetching — only re-rendering the already-fetched data.

**Layout** — a two-column flex arrangement: a flexible-width **canvas** and a **fixed-width (≈280px) side inspector column** bordered with `border-l border-app-border`, structurally identical to how `TableDetailPanel` lays out its fixed sections. This was an explicit requirement: the inspector must occupy its own dedicated space and never overlap the canvas as a floating layer. Empty state: "Select a node or relationship to inspect it." Populated state: label/type heading + full property list, styled like the existing schema table rows.

**Canvas rendering** — `react-force-graph-2d` (canvas-based force-directed layout; actively maintained; exposes custom paint callbacks so nodes/edges are drawn with Aperture's own design tokens rather than the library's default look). Nodes are circles colored by label from a small palette seeded off the existing `cat-*` tokens (gracefully cycling beyond ~6 distinct labels); relationships render as labeled directional edges. A **legend** (top-left, `bg-app-surface/90 backdrop-blur` chip list) maps colors to label/relationship-type names.

**Interaction** — pan/zoom (native to the library), click-to-select (drives the inspector + an accent-glow selection ring matching the existing selection treatment), drag-to-reposition, and a "fit to view" reset control in the canvas corner. Hover changes the cursor only — no secondary tooltip system, keeping the persistent inspector as the single source of truth for details.

**Large-graph safeguard** — a force-directed canvas with thousands of nodes is unreadable and can hang the renderer. `buildGraphFromRecords` caps at a configurable threshold (proposed: 500 nodes). Past the cap, the detection banner instead reads: *"This result has 2,400 nodes — too many to visualize. Try adding a `LIMIT`."* The graph view is never silently handed an unusable hairball.

**Building the graph from results** — a pure utility, `buildGraphFromRecords(records)`, walks every Node/Relationship/Path value across all returned fields, de-duplicates nodes and relationships by their internal IDs, and produces `{ nodes, links }` (or `{ truncated: true, nodeCount }` past the cap). It is fully independent of any rendering — unit-testable without mounting a canvas.

## Synergies with existing features

| Feature | How it extends |
|---|---|
| Auto-limit guard | `detectMissingLimit` gains Cypher-awareness (`MATCH`/`RETURN`/`WITH` statements, identical `LIMIT` placement semantics to SQL); the existing banner UX is reused verbatim |
| Explain plan viewer | `EXPLAIN <query>` → structured plan tree maps directly onto the existing `{ bytesProcessed, plan, planFormat }` `QUERY_DRY_RUN` contract (`planFormat: 'json'`, `bytesProcessed: 0` — the same convention Postgres/Snowflake already use for the field that doesn't apply to them); `ExplainPanel` requires no changes |
| Export results | Scalar columns export unchanged. Node/Relationship/Path cells serialize to their compact Cypher-style string in CSV/text exports, and to `{ identity, labels, properties }` in JSON export |
| History, saved queries, ⌘K, pinned tabs, split panes, status dots | All already engine-agnostic — work immediately once the adapter is registered, no changes required |
| Cost/bytes framing | BigQuery-specific; simply doesn't surface for Neo4j, same as Postgres/Snowflake today |

## Testing strategy

Mirrors the project's established Vitest/AAA conventions (70% coverage gate via `vitest run --coverage`):

- **`neo4j.test.ts`** — `testConnection`, `listDatasets`, `listTables`, `getTableSchema`, `runQuery` (success/logs/empty/error/timeout/cancel, mocking `neo4j-driver` driver/session objects the way `bigquery.test.ts` mocks `Job`), `getQueryPage`, `dryRunQuery`, `searchTables`, `invalidateClient`
- **`buildGraphFromRecords.test.ts`** — pure function: node/relationship/path extraction from mixed record shapes, de-duplication by internal ID, the large-graph cap/truncation behavior
- **`detectMissingLimit.test.ts`** — extended with Cypher-flavored cases
- **`adapterRegistry.test.ts`** — extended for the `neo4j` engine
- **`catalog.test.ts`** / **`query.test.ts`** — extended IPC dispatch coverage for Neo4j
- **Component tests** — `Neo4jForm` (validation/payload, mirrors `SnowflakeForm`/`PostgresForm`), `GraphView` (selection→inspector data flow, legend, "back to table"/"fit to view" handlers — interaction-layer testing, not canvas pixels), cell-chip renderer (Node/Relationship/Path formatting + click-to-inspect wiring)

Given how much of this surface is pure-function-testable (`buildGraphFromRecords`, cell formatting, Cypher detection, the adapter's query-shaping logic), the 70% threshold should be comfortably reachable.

## Documentation

Per project convention: `README.md` gets a fourth engine in the architecture/auth sections, and a dated `CLAUDE.md` change-log entry is added once the feature ships.

## Suggested implementation phasing

This is a substantially larger feature than recent single-PR work (e.g. theme import) — it spans a new adapter, a new catalog shape, a new editor language, a new visualization subsystem, and several cross-feature touch points. Rather than one monolithic plan, splitting into two PR-sized phases is recommended:

1. **Phase 1 — Foundation ("Cypher-as-SQL")**: `Neo4jConnection` type + adapter + registry + connection modal + catalog browsing (Labels/Relationship Types, detail tabs, search) + Cypher syntax highlighting/autocomplete + tabular results with compact-chip cell rendering + `cat-teal` accent. This alone makes Neo4j a fully usable, first-class engine — every existing feature (history, saved queries, ⌘K, export, auto-limit guard, explain plan, split panes) works immediately on top of it.
2. **Phase 2 — Graph visualization**: graph-shaped detection banner, `buildGraphFromRecords` + large-graph safeguard, `GraphView` canvas + persistent inspector + legend + controls, `react-force-graph-2d` integration.

Phase 1 ships a complete, valuable engine on its own; Phase 2 layers the novel graph-visualization experience on top without blocking on it. Each phase gets its own implementation plan via the writing-plans skill.
