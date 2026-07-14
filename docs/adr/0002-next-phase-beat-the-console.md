# Next phase: beat the BigQuery console at debugging (depth over distribution)

The next development phase optimizes Aperture as the **daily driver for app/data debugging against BigQuery**, attacking the two reasons the BigQuery web console still wins moments of choice: **completion trust** (nothing missing, identifiers ranked above keywords) and **navigation trust** (search that never misses, a table page that answers freshness/size at a glance). The pending `[Unreleased]` block (E2E suite, credential encryption, animations, QoL) ships **batched with this work as 3.3.0**, not before it.

Explicit non-goals for this phase: distribution work (signing/notarization, auto-update, Homebrew), Neo4j/Cypher depth, new engines, and AI-layer expansion.

## Why

- Interview findings (2026-07-13 grilling session): the incumbent is the BigQuery web console. Aperture is already used frequently, but the console wins whenever navigation or autocomplete falter — "I need it to be easier to navigate than BQ, good autocomplete (always capable, not working perfectly yet)."
- The real workload is **app/data debugging** on **BigQuery + Neo4j**, with Neo4j explicitly rated *secondary* ("current support is fine; BigQuery depth first"). Postgres/Snowflake see no daily use.
- The audience is "me + colleagues", but **no colleague runs Aperture today** — so signing, onboarding, and auto-update polish would currently serve zero users. Distribution becomes a phase of its own the day the depth is worth sharing.
- The named failure modes are specific and fixable: completions missing tables/columns (warm-up gaps), SQL keywords swamping schema identifiers in the ranking, sidebar/⌘K search coverage gaps, and a table page that can't answer "is this table alive and populated?" without running a query.

## Consequences

- Four workstreams, in priority order:
  1. **Warm-up hardening** — no silent failures; per-dataset retry; visible indexed state (see ADR-0003).
  2. **Completion ranking** — schema identifiers (columns of referenced tables first) rank above bare SQL keywords.
  3. **Search coverage guarantee** — sidebar + ⌘K search provably backed by the full warmed catalog.
  4. **Table freshness header** — row count, table size, last-modified shown on the table page without running a query (BigQuery `tables.get` metadata; other engines only where trivially cheap).
- Success metric: **console-free debugging weeks** — two consecutive weeks of daily debugging without opening the BigQuery console closes the phase.
- Trigger to open the distribution phase: the first colleague onboarding request, or the success metric being hit — whichever comes first.
- Neo4j/Cypher parity requests are parked; they re-enter the roadmap only after the phase closes.
