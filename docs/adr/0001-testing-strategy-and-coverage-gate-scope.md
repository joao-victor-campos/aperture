# Testing strategy: extract pure helpers; gate scoped to logic, not components

We test renderer code by **extracting pure logic into `src/renderer/src/lib/*` helpers and unit-testing those**, rather than by rendering components (no React Testing Library). The coverage gate (70% lines/functions/branches/statements) enforces `src/main/db/**`, `src/main/ipc/**`, and `src/renderer/src/store/**`, and is being **widened to include `src/renderer/src/lib/**`** so future helpers cannot ship untested. `src/renderer/src/components/**` is deliberately **left outside** the gate.

## Why

- A newcomer to a React app would expect component render-tests and ask why there are none. The answer: the codebase has consistently pushed logic *out* of components into pure helpers (`filterSortRows`, `paginate`, `rowsToTsv`, `aggregateForChart`, `buildGraphFromRecords`, `detectMissingLimit`, …) and tested those. This keeps one testing paradigm, fast tests, and no render/jsdom-DOM brittleness.
- Trade-off accepted: render-level behavior (focus management, keyboard nav, portals) is **not** directly covered. We accept that risk in exchange for simplicity and speed. Components must stay thin — if real logic accumulates in a component, extract it to `lib/` rather than reaching for a render-test harness.
- Gating `components/**` would force render-tests (contradicting the above) or block CI on presentational code. Gating `lib/**` institutionalizes the pattern we already follow.

## Consequences

- Embedded logic in fat components is a refactor smell: extract to `lib/` + test (e.g. `ConnectionModal.isValid`/`buildPayload` → `lib/connectionForm.ts`).
- Before `lib/**` can be added to the gate, the two currently-untested helpers (`inlineCompletion.ts`, `sqlCompletion.ts`) must get tests, or the gate goes red.
