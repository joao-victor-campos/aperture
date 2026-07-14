# Catalog search: harden per-session warm-up; no persistent index yet

"Search that never misses" and "completions never missing a column" are delivered by **hardening the existing in-memory, per-session catalog warm-up** — not by building a persistent on-disk index or a live server-side search fallback. `warmCatalog` gains per-dataset failure tracking and retry; the UI gains a visible indexed state (last-indexed time, dataset/table counts, failed-dataset count with a retry affordance) replacing the bare "Indexing catalog…" pulse.

## Why

- The catalog being targeted is **small**: under 50 datasets, under ~1k tables. A full warm-up is a matter of seconds, cheap enough to run on every boot — persistence would optimize a cost nobody pays.
- The catalog **changes daily** (pipeline-created/replaced tables). At this churn rate a persisted index is stale every morning; per-boot re-warm is not a limitation, it is the correct freshness discipline. A persistent index would need exactly the invalidation machinery this decision avoids.
- The actual cause of "columns/tables missing" today is that `warmCatalog` **silently skips datasets that error** (try/catch per dataset worker, by design at the time). Trust requires the opposite: failures must be visible and retryable. More caching would not fix an error path that hides itself.
- Fuzzy matching was considered and not selected as a pain point in the interview; exact/prefix/substring matching over a *complete* index is the bar.

## Consequences

- `catalogStore.warmState` grows beyond `'idle' | 'warming' | 'warmed'` to carry per-dataset failure info; failed datasets are retried (bounded) and surfaced, never silently dropped.
- The sidebar hint becomes a status line (e.g. "Indexed 42 datasets · 730 tables · 2 failed — retry") — the user can always answer "can I trust search right now?".
- Revisit trigger for a persistent index (new ADR at that point): the catalog outgrows in-memory scale (multi-project, 300+ datasets) **or** warm-up time exceeds ~10s on boot. Until then, this decision stands.
