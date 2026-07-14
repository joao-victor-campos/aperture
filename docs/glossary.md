# Glossary

Domain vocabulary for Aperture. Terms marked **(phase)** were coined in the 2026-07-13
next-steps grilling session (see ADR-0002/0003) and name concepts of the current phase.

## Core domain

- **Engine** — a database kind Aperture speaks to: `bigquery`, `postgres`, `snowflake`, `neo4j`. Each has a dedicated adapter in `src/main/db/`.
- **Connection** — a saved, credentialed handle to one engine instance (e.g. a GCP project + service account). Owned by the main process; persisted encrypted in `aperture-store.json`.
- **Adapter** — the per-engine implementation of `DbAdapter<TConnection>`; all dispatch goes through `getAdapterForConnection`, never a direct engine import.
- **Catalog** — the navigable tree of what a connection contains: datasets → tables (for Neo4j: labels and relationship types).
- **Dataset** — the middle tier of the catalog (BigQuery dataset, Postgres/Snowflake schema, Neo4j database).
- **Table page** — the detail panel opened by clicking a table (`TableDetailPanel`): schema, preview, and (this phase) a freshness header.
- **Schema cache** — `catalogStore.schemaCache`; per-table column lists feeding autocomplete and the table page.
- **Warm-up** — `warmCatalog`: on connect, fan-out prefetch of every dataset's tables + columns so search and completions cover the full catalog, not just what was manually expanded.
- **Query tab / editor group** — one SQL/Cypher editing surface; tabs live in a left/right group for the multi-connection split view. Connection is per-tab.
- **Saved query / history** — persisted named queries (with params) vs the automatic log of past runs.
- **Query params** — `{{name}}` placeholders with typed values (text/number/boolean/raw), substituted client-side before execution.
- **Limit guard** — the warning interstitial before running a `SELECT`/`WITH` without `LIMIT`; toggleable in Settings → Editor.
- **⌘K palette** — the global command/search entry point in the title bar (tables, saved queries, history, connections, actions).
- **Ghost text** — the inline AI completion (Haiku-backed) rendered ahead of the cursor; Tab accepts, Esc dismisses. Distinct from schema-aware autocomplete.

## Phase vocabulary

- **Incumbent (phase)** — the tool Aperture must beat in the moment of choice: the BigQuery web console.
- **Completion trust (phase)** — the property that autocomplete never lacks a table/column the catalog contains, and ranks schema identifiers above bare SQL keywords. One of the two pillars.
- **Navigation trust (phase)** — the property that finding and understanding a table is faster in Aperture than in the console: search that never misses + a table page that answers freshness/size at a glance. The other pillar.
- **Search that never misses (phase)** — sidebar/⌘K search provably backed by the full warmed catalog, with failures visible instead of silently narrowing coverage.
- **Indexed state (phase)** — the user-visible answer to "can I trust search right now?": last-indexed time, dataset/table counts, failed-dataset count with retry (ADR-0003).
- **Freshness header (phase)** — row count, table size, and last-modified shown on the table page without running a query; the first debugging question ("is this table alive and populated?") answered at a glance.
- **Console-free week (phase)** — the success metric: a week of daily debugging without opening the BigQuery console; two consecutive closes the phase (ADR-0002).
- **Distribution trigger (phase)** — the event that opens the (currently parked) distribution phase: a colleague asks to use Aperture, or the success metric is hit.
