# Aperture

A modern, friendly UI tool for querying SQL databases — starting with BigQuery.

## Project Vision

Aperture makes database access intuitive: connect to BigQuery, navigate the catalog, write queries, and organize your work in a folder-based, intelligent way.

## Tech Stack

| Layer | Technology |
|---|---|
| Frontend | [Electron](https://www.electronjs.org/) (macOS-first, responsive) |
| Query engine | Native SDK adapters — `@google-cloud/bigquery`, `pg`, `snowflake-sdk` |
| BigQuery auth | Google Application Default Credentials (ADC) / Service Account |
| Containerization | Docker (for development and packaging) |
| Language | TypeScript (main + renderer processes) |
| UI framework | React (inside Electron renderer) |
| Styling | Tailwind CSS |
| Build tool | Vite (renderer) + esbuild (main process) |

## Architecture

```
aperture/
├── src/
│   ├── main/          # Electron main process (Node.js)
│   │   ├── index.ts   # App entry, window management
│   │   ├── ipc/       # IPC handlers (query, catalog, connections)
│   │   └── db/        # DB adapters (BigQuery, Postgres, Snowflake) + adapter registry
│   ├── renderer/      # React UI (runs in Electron renderer)
│   │   ├── components/
│   │   ├── pages/
│   │   └── store/     # State management (Zustand)
│   └── shared/        # Types and constants shared across processes
├── docker/
│   ├── Dockerfile
│   └── docker-compose.yml
├── resources/         # App icons, native assets
├── CLAUDE.md
├── package.json
└── electron-builder.yml
```

## Core Features

1. **Connection manager** — save and switch between BigQuery projects/service accounts
2. **Catalog browser** — navigate projects → datasets → tables with search
3. **Query editor** — SQL editor with syntax highlighting, autocomplete, schema-aware suggestions
4. **Results panel** — paginated, sortable table view with export (CSV, JSON)
5. **Query organizer** — folder-based saved queries with tags and search

## Guidelines

### General
- Keep the UI clean and minimal — prioritize clarity over feature density
- macOS-first: follow macOS HIG conventions (keyboard shortcuts, native menus, window chrome)
- All database work happens in the **main process** via IPC; the renderer never calls database adapters directly
- Use TypeScript strict mode everywhere
- Prefer explicit types over `any`
- **All changes must be made on a branch** — never commit directly to `main` (`just branch feat/…`)
- **README.md must be kept in sync** — update it whenever architecture, auth flow, install steps, or developer commands change

### IPC Pattern
- All renderer → main communication goes through typed IPC channels defined in `src/shared/ipc.ts`
- Main process handlers live in `src/main/ipc/`
- Always validate input in main process handlers

### DB Adapters
- Each engine (`bigquery`, `postgres`, `snowflake`) has a dedicated adapter in `src/main/db/`
- All adapters implement the `DbAdapter<TConnection>` interface from `src/main/db/adapterRegistry.ts`
- Dispatch always goes through `getAdapterForConnection(conn)` — never reference an engine adapter directly

### State Management
- Use Zustand for global UI state (active connection, open tabs, catalog tree)
- Keep server-derived data (query results, catalog) out of Zustand; fetch on demand via IPC

### Styling
- Tailwind CSS utility classes only — no inline styles, no CSS modules
- Design tokens (colors, spacing) defined in `tailwind.config.ts`
- Dark mode supported via `dark:` variant (system preference driven)

### Docker
- The `Dockerfile` targets a headless dev/CI environment (no Electron GUI)
- The docker-compose sets up any auxiliary services (e.g., a local mock or test DB)
- macOS `.app` packaging is done on the host via `electron-builder`, not inside Docker

### Testing
- Unit tests: Vitest
- E2E tests: Playwright (Electron mode)
- All IPC/adapter logic must have unit tests before merging
- **All tests must pass before merging a PR — never ship with a broken test suite**
- Coverage threshold: 70% lines/functions/branches/statements enforced by `vitest run --coverage`

## Commands

> Prefer `just` over raw `npm` — see `justfile` for the full list.

```bash
# Install just (one-time)
brew install just

# Install dependencies
just install

# Start in development mode
just dev

# Build macOS DMG locally
just release

# Run all CI checks locally
just ci

# Create a feature branch (never commit directly to main)
just branch feat/my-feature

# Tag and push a release
just tag-release
```

## Out of Scope (for now)

- Other database engines (Postgres, MySQL, etc.) — BigQuery first
- Cloud sync of saved queries
- Collaboration / sharing features
- Windows / Linux packaging

---

## Change Log & Error Report

> Every significant change or error encountered during development must be logged here.
> Format: date, category, description, and resolution.

### Format

```
### [YYYY-MM-DD] <Category>: <Short title>
**Type:** Change | Error | Decision
**Context:** What was happening when this occurred.
**Problem / Change:** Detailed description of the error or what changed and why.
**Solution / Outcome:** Exactly what was done to fix or implement it.
**Files affected:** List of files created, modified, or deleted.
```

---

<!-- Entries go below this line, newest first -->

### [2026-07-12] Feature: E2E regression suite (Playwright, Electron mode) + Postgres fixture + CI job

**Type:** Change
**Context:** Aperture had unit/store coverage (Vitest, 70% gate) but nothing exercising the real built app end-to-end — no proof that boot, connecting, catalog browsing, running a query, saving/reopening a query, or surviving a relaunch actually work together through real UI + real IPC + a real database. Sub-project 1 of the maturity campaign per spec `docs/superpowers/specs/2026-07-11-maturity-campaign-e2e-credentials-design.md`; sub-project 2 (credential encryption) starts only after this plan is merged, and its migration lands under the protection of the new `persistence.spec.ts` safety net.
**Problem / Change:** No E2E harness, no seeded fixture database, no specs, and no CI coverage for the full app lifecycle.
**Solution / Outcome:**
- **Playwright harness.** `playwright.config.ts` (serial, single worker — Electron instances are heavyweight and the suite shares one build; CI retries once); `tsconfig.e2e.json` (chained into `npm run typecheck` as `typecheck:e2e`). `e2e/helpers/app.ts`'s `launchApp()` launches the **built** app (`out/main/index.js`) with an isolated `userData` dir per test (fresh `mkdtemp` by default, or a reused dir for relaunch scenarios) via a new `APERTURE_USER_DATA` env hook read in `src/main/index.ts` (`app.setPath('userData', ...)` before anything else runs) — tests never touch a real profile. `launchApp` also optionally seeds `aperture-store.json` with connections before first launch (relies on `store.get()`'s per-key defaults, so a partial store file is valid). `captureOnFailure()` attaches a screenshot to the Playwright report on test failure. `npm run e2e` (`playwright test`) added; `test`/`test:watch`/`test:coverage` gained `--exclude 'e2e/**'` since Vitest's default glob was otherwise picking up the Playwright specs (`vitest.config.ts` itself intentionally untouched).
- **Postgres fixture.** `postgres-e2e` service in `docker/docker-compose.yml` (port 54329, healthcheck, seeded via a mounted `docker/e2e-seed.sql` — 100 deterministic `customers` rows named `Customer 1`..`Customer 100` + 250 `orders` rows). `just e2e` (start Postgres → build → run suite → stop Postgres via `trap ... EXIT`) and `just e2e-ui` (same, opens Playwright's UI mode, leaves Postgres running) recipes in `justfile`.
- **Six specs in `e2e/specs/`** (all via `e2e/helpers/postgres.ts`'s `seededPgConnection()`/`PG_CONNECTION_NAME`, `connectionModal.ts`'s `addPostgresConnection()`, and `editor.ts`'s `bindTabToConnection()`/`typeSql()`/`saveCurrentQuery()`): `boot.spec.ts` (empty-workspace chrome), `connect.spec.ts` (adds a Postgres connection through the real "Test & Save" modal flow, asserts a green health dot), `catalog.spec.ts` (browses the seeded `public` schema, opens the `customers` table detail panel), `query.spec.ts` (types SQL, clicks Run, asserts row count + a known cell), `saved-queries.spec.ts` (saves a query, reopens it from the Saved panel), `persistence.spec.ts` (the sub-project-2 safety net: add connection + save query → full app process restart against the same `userData` dir → asserts both survived).
- **One renderer change:** `data-testid="save-query-modal"` on `SaveQueryModal.tsx` — the plan's only testid, needed because the modal has no other reliable selector for `saveCurrentQuery()`'s helper.
- **Spec-writing deviations found during execution** (worth noting since they reflect real app behavior, not test bugs): connection-name assertions use `getByRole('button', { name: 'postgres / ...' })` scoped to the title-bar breadcrumb rather than a bare `getByText`, because the per-tab connection picker also renders the same name as an `<option>` and trips Playwright's strict-mode duplicate-match check; `saved-queries.spec.ts` asserts the saved query's title appears **3 times** after reopening (original tab + newly-opened tab + sidebar row) because `SavedQueriesPanel.handleOpenQuery` always calls `openTab` with no dedup against an already-open tab for the same `savedQueryId` — pre-existing behavior, not something this task changed.
- **CI.** New `e2e` job in `.github/workflows/ci.yml`: `postgres:16-alpine` service container (since service containers have no volume mounts, the seed is applied via `psql -f docker/e2e-seed.sql` rather than the compose file's mount), `xvfb-run` (headless Ubuntu has no display server), plain `npm ci` (no `--ignore-scripts` — Electron's own install script must run to fetch its binary), build, `playwright test`, and a failure-only artifact upload (`test-results/`, `playwright-report/`). Green on run 29211569211 alongside the existing unit/coverage job.

**Files affected:**
- `playwright.config.ts`, `tsconfig.e2e.json` — created
- `e2e/helpers/app.ts` — created (`launchApp`, `captureOnFailure`)
- `e2e/helpers/postgres.ts` — created (`PG`, `PG_CONNECTION_NAME`, `seededPgConnection`)
- `e2e/helpers/connectionModal.ts` — created (`addPostgresConnection`)
- `e2e/helpers/editor.ts` — created (`bindTabToConnection`, `typeSql`, `saveCurrentQuery`)
- `e2e/specs/boot.spec.ts`, `e2e/specs/connect.spec.ts`, `e2e/specs/catalog.spec.ts`, `e2e/specs/query.spec.ts`, `e2e/specs/saved-queries.spec.ts`, `e2e/specs/persistence.spec.ts` — created
- `src/main/index.ts` — `APERTURE_USER_DATA` env hook
- `src/renderer/src/components/editor/SaveQueryModal.tsx` — `data-testid="save-query-modal"`
- `docker/docker-compose.yml` — `postgres-e2e` service
- `docker/e2e-seed.sql` — created (deterministic customers/orders seed)
- `justfile` — `e2e`, `e2e-ui` recipes
- `package.json`, `package-lock.json` — `@playwright/test` + `playwright` devDeps; `e2e`/`typecheck:e2e` scripts; `--exclude 'e2e/**'` on the Vitest scripts
- `.gitignore` — `test-results/`, `playwright-report/`
- `.github/workflows/ci.yml` — new `e2e` job (Postgres service container, xvfb, failure artifacts)
- `README.md`, `CHANGELOG.md` — docs
- `docs/superpowers/specs/2026-07-11-maturity-campaign-e2e-credentials-design.md` — spec (referenced)

---

### [2026-07-11] Feature: Small adjustments — table-page Query button, LIMIT-guard toggle, ⌘? cheatsheet rebind, history search

**Type:** Change
**Context:** Four small, independent renderer adjustments requested together: a faster way to start querying a table from its detail page, a way to turn off the LIMIT-safety warning for users who find it noisy, a keyboard-shortcut collision between the cheatsheet and the editor's native comment-toggle, and a way to find a specific past query in a growing history list.
**Problem / Change:**
- The table detail page had no quick "run a starter query" action — only the catalog tree's row context menu offered "Query table"; the two entry points also risked drifting since `buildSelectQuery`/Cypher query construction lived in one place but wasn't shared with the panel.
- The "warn before running a SELECT without LIMIT" guard was always on with no way to disable it, even though it's just a soft warning users can already dismiss per-query with "Run anyway."
- `⌘/` was bound globally to toggle the keyboard-shortcut cheatsheet, which meant it fired instead of (or in addition to) CodeMirror's native `⌘/` comment-toggle binding inside the editor.
- The query-history panel listed every past query with no way to filter it, making it hard to find a specific query once history grew long.
**Solution / Outcome:**
- **`buildTableQuery.ts`** (new, pure): `buildTableQuery(engine, projectId, datasetId, tableId, tableType?)` — the shared "Query table" starter-query builder used by both entry points. SQL engines get `buildSelectQuery`'s `SELECT * … LIMIT 100`; Neo4j gets `buildLabelQuery`/`buildRelationshipTypeQuery` based on `tableType`. `TableDetailPanel.tsx` gained a **Query** button (Play icon, accent-filled, next to the existing copy-reference button) that calls it and opens the result via `queryStore.openTab`. `CatalogTree.tsx`'s existing row-menu "Query table" action now goes through the same helper (previously used `buildSelectQuery` directly for SQL engines only in that path).
- **`preferencesStore.ts`** (new, Zustand): `limitGuardEnabled: boolean` (default `true`) + `setLimitGuardEnabled`, persisted to `localStorage` under `aperture-prefs` (mirrors the `aperture-theme-css` pattern — read on init with a try/catch fallback to defaults on missing/corrupt data, written on every change). `SettingsModal.tsx` gains a fourth section, **Editor** (`SlidersHorizontal` icon in the left nav), with a single "Query safety" row (label + description + an `role="switch"` pill toggle) wired to the store. `EditorPane.tsx`'s `handleRun` now only shows the `LimitWarningBanner` when `limitGuardEnabled` is true; when the guard is off, a missing-`LIMIT` query runs immediately (matching the existing "Run anyway" behavior, just without the interstitial).
- **`filterHistory.ts`** (new, pure): case-insensitive substring filter over `HistoryEntry[]` matching SQL text or connection name. `HistoryPanel.tsx` gained a search input (shown once there is at least one history entry) wired via `useMemo(() => filterHistory(entries, search), [entries, search])`; the header count switches to a `n / total` format while a search is active, and a "No queries match." empty state renders when the filter yields zero rows.
- **Shortcut rebind:** `App.tsx`'s global keydown handler now checks `e.key === '?'` (was `'/'`) to toggle the cheatsheet; `ShortcutCheatsheet.tsx`'s "Keyboard shortcuts" row now displays `⌘?`. `⌘/` is no longer intercepted at the window level, so CodeMirror's native comment-toggle binding fires normally when the editor is focused.
- **Tests:** `buildTableQuery.test.ts` and `filterHistory.test.ts` (new, pure-unit) and `preferencesStore.test.ts` (new — default value, `setLimitGuardEnabled`, persistence round-trip via `localStorage`, corrupt-value fallback). No IPC or shared-type changes; all four changes are renderer-only.

**Files affected:**
- `src/renderer/src/lib/buildTableQuery.ts` — created
- `src/__tests__/renderer/lib/buildTableQuery.test.ts` — created
- `src/renderer/src/lib/filterHistory.ts` — created
- `src/__tests__/renderer/lib/filterHistory.test.ts` — created
- `src/renderer/src/store/preferencesStore.ts` — created
- `src/__tests__/renderer/store/preferencesStore.test.ts` — created
- `src/renderer/src/components/catalog/TableDetailPanel.tsx` — Query button
- `src/renderer/src/components/catalog/CatalogTree.tsx` — row-menu action delegates to `buildTableQuery`
- `src/renderer/src/components/editor/EditorPane.tsx` — gate `LimitWarningBanner` on `limitGuardEnabled`
- `src/renderer/src/components/settings/SettingsModal.tsx` — new Editor section + Query safety toggle
- `src/renderer/src/components/history/HistoryPanel.tsx` — search box + filtered empty state
- `src/renderer/src/App.tsx` — `⌘/` → `⌘?` global handler rebind
- `src/renderer/src/components/command/ShortcutCheatsheet.tsx` — display `⌘?`
- `README.md`, `CHANGELOG.md` — docs

---

### [2026-07-10] Feature: UI micro-animations

**Type:** Change
**Context:** The UI swapped state instantly everywhere (palette popover, sidebar sections, tab reorder, modals) and had no `prefers-reduced-motion` support. Per spec `docs/superpowers/specs/2026-07-10-ui-micro-animations-design.md` and plan `docs/superpowers/plans/2026-07-10-ui-micro-animations.md`.
**Problem / Change:** Slight, fast animations (140–180ms, transform/opacity only, CSS-only + one small FLIP hook, zero new dependencies) in four places; the `animate-fade-in` class on the save toast was a silent no-op (keyframes never defined).
**Solution / Outcome:**
- **Motion foundation:** `fade-in` / `palette-in` / `panel-in` / `modal-in` keyframes + `animation` entries in `tailwind.config.ts`; global `prefers-reduced-motion` rule in `index.css` (the `!important` also neutralizes the FLIP hook's inline transitions).
- **Palette + modals:** `animate-palette-in origin-top` on the ⌘K popover; `animate-modal-in` on the Settings/Connection/SaveQuery/ShortcutCheatsheet panels. Open only; close stays instant.
- **Sidebar:** opt-in `.app-segmented--animated` variant (sliding `.app-segmented-indicator`, active button's own bg suppressed; base primitive untouched for ConnectionModal/TableDetailPanel); content container keyed by section with `animate-panel-in` (also resets scroll on switch).
- **Query tabs:** `renderTabStrip` extracted from `Editor.tsx` into `TabStrip.tsx` (shared `dragTabIdRef` prop keeps cross-group drags working). Drop indicator via `data-drop-target` + box-shadow insertion line. Settle-after-drop via `useFlipAnimation` (order-change-triggered, live-rect measurement for graceful interruption) with pure math in `lib/flipDeltas.ts` (`computeFlipDeltas`, coverage-gated). Only moves animate — tab open/close and the losing strip of a cross-group move stay instant.
- **Tests:** `flipDeltas.test.ts` (5), `TabStrip.test.tsx` (8), `Sidebar.test.tsx` (4). `just ci` green, coverage gate holds.

**Files affected:**
- `tailwind.config.ts` — keyframes + animation entries
- `src/renderer/src/index.css` — reduced-motion rule, `.app-segmented--animated`, drop-indicator rule
- `src/renderer/src/components/command/CommandPalette.tsx`, `src/renderer/src/components/settings/SettingsModal.tsx`, `src/renderer/src/components/connections/ConnectionModal.tsx`, `src/renderer/src/components/editor/SaveQueryModal.tsx`, `src/renderer/src/components/command/ShortcutCheatsheet.tsx` — entrance classes
- `src/renderer/src/components/layout/Sidebar.tsx` — sliding pill + keyed content
- `src/renderer/src/pages/Editor.tsx` — strip extraction
- `src/renderer/src/components/editor/TabStrip.tsx` — created
- `src/renderer/src/lib/flipDeltas.ts`, `src/renderer/src/hooks/useFlipAnimation.ts` — created
- `src/__tests__/renderer/lib/flipDeltas.test.ts`, `src/__tests__/renderer/components/editor/TabStrip.test.tsx`, `src/__tests__/renderer/components/layout/Sidebar.test.tsx` — created
- `CHANGELOG.md` — Unreleased entry

---

### [2026-06-24] Release: 3.2.0 — param validation at the input + changelog reconciliation

**Type:** Change
**Context:** Post-hardening "polish & ship" pass. A discovery pass against `origin/master` established that v3.0.0 (AI) and v3.1.0 (warm-up/split/charts/clipboard) had already shipped, leaving **query parameters (#41)** as the only genuinely-unreleased feature — so the next release is a focused **3.2.0**. Per spec `docs/superpowers/specs/2026-06-24-release-3.2.0-polish-design.md` and plan `docs/superpowers/plans/2026-06-24-release-3.2.0-polish.md` (subagent-driven execution).
**Problem / Change:** (1) `CHANGELOG.md` was broken — no `[3.0.0]`/`[3.1.0]` sections and an `[Unreleased]` block still listing already-shipped features, which the in-app update notifier surfaces. (2) Invalid `{{name}}` param values surfaced as a red error in the **results panel** ("Fill in {{foo}} before running."), far from the input that needed fixing, and the validation rules were duplicated inside `substituteParams`.
**Solution / Outcome:**
- **`src/renderer/src/lib/validateParams.ts`** (new, pure): `validateParam(p): string | null` + `validateParams(params): { name; message }[]`, encoding the existing rules (text/number/boolean require non-empty + type-valid; number finite; boolean true/false case-insensitive; raw may be empty). Messages match `substituteParams` verbatim. Unit-tested (inside the `lib/**` coverage gate).
- **`substituteParams.ts`** now delegates its validation branch to `validateParam` (single source of truth; value production/escaping stays local). Behavior + messages unchanged; existing tests green.
- **`ParamsPanel.tsx`** gains an `errors?: Record<string,string>` prop — errored rows get a `ring-app-err` ring + `text-app-err` message line, and the value input is marked `data-error="true"` for focus targeting.
- **`EditorPane.tsx`** guards **both** `handleRun` and `handleExplain`: the param check runs **before** the existing `detectMissingLimit` banner; invalid params set a local `showParamErrors`, focus the first errored input, and **block execution** (no `runQuery`/`explainQuery`). Valid runs reset the flag and preserve the limit-warning flow. The store-side substitute-error backstop is retained (now unreachable from the UI) as defense.
- **`CHANGELOG.md`** reconciled: added `[3.0.0] - 2026-06-19` and `[3.1.0] - 2026-06-22` (verbatim from the GitHub release notes), shrank `[Unreleased]` to query parameters + the invisible internal refactors, then promoted to `[3.2.0] - 2026-06-24`. `package.json` bumped `2.4.0` → `3.2.0`. README query-parameters section notes the new inline-validation behavior.
- A plan-test bug was caught during execution: the "valid run executes" test used `SELECT {{n}}` (no LIMIT), which trips `detectMissingLimit`; corrected to `SELECT {{n}} LIMIT 10` so it actually exercises the param path.
- **Tests:** `validateParams.test.ts` (new), `ParamsPanel.test.tsx` (new), `EditorPane.params.test.tsx` (new); `substituteParams` + `queryStore` suites stay green.

**Files affected:**
- `src/renderer/src/lib/validateParams.ts` — created
- `src/renderer/src/lib/substituteParams.ts` — delegate validation to `validateParam`
- `src/renderer/src/components/editor/ParamsPanel.tsx` — `errors` prop + inline error rendering
- `src/renderer/src/components/editor/EditorPane.tsx` — Run/Explain param guard (block + highlight)
- `src/__tests__/renderer/lib/validateParams.test.ts` — created
- `src/__tests__/renderer/components/editor/ParamsPanel.test.tsx` — created
- `src/__tests__/renderer/components/editor/EditorPane.params.test.tsx` — created
- `CHANGELOG.md` — reconciled with published releases + 3.2.0 section
- `package.json` — version 3.2.0
- `README.md` — query-parameter validation note
- `docs/superpowers/specs/2026-06-24-release-3.2.0-polish-design.md`, `docs/superpowers/plans/2026-06-24-release-3.2.0-polish.md` — created

---

### [2026-06-24] Feature: Query parameters (`{{name}}`)

**Type:** Change
**Context:** Users writing reusable queries had to manually substitute literal values for each run, with no structured way to parameterize SQL. The spec (`docs/superpowers/specs/`) and plan called for a client-side substitution approach that required no IPC or main-process changes — adapters receive the already-substituted SQL string, and `SAVED_QUERY_SAVE`/`UPDATE` handlers spread `...req` so `params` persists with no main-process edit.
**Problem / Change:** No way to express reusable `{{name}}` placeholders in SQL, fill typed values in the UI, or persist those values with a saved query.
**Solution / Outcome:**
- **`extractParams.ts`** (new, pure): scans SQL text for `{{name}}` placeholders, ignoring comments (`--`, `/* */`) and string literals, returning a deduped ordered array of names. 9 unit tests.
- **`substituteParams.ts`** (new, pure): takes a SQL string + `QueryParam[]`, substitutes each placeholder with a type-aware formatted value — Text: single-quoted and escaped; Number: verbatim (blocks on non-numeric input); Boolean: lowercased `true`/`false` (blocks on non-boolean); Raw: verbatim (empty allowed). Returns `{ sql }` on success or `{ error }` on missing value, invalid number, or invalid boolean. 11 unit tests.
- **`queryStore`**: module-level `reconcileParams(existing, detected)` preserves known params by name (retaining type/value) and adds new ones (type `'text'`, value `''`). `updateTabSql` runs `extractParams` + `reconcileParams` on every SQL edit so `tab.params` stays live in sync. New `setTabParams(id, params)` and `syncTabParams(id, params)` actions. `runQuery` and `explainQuery` call `substituteParams` before sending to IPC; on substitution error they set `tab.error` and abort without making any IPC call. 8 new tests in a `query params` block.
- **`ParamsPanel.tsx`** (new): renders an input row per parameter with a name label, a type select (Text / Number / Boolean / Raw), and a value input (boolean uses a true/false select). Boolean default normalizes to `'true'` on type switch. Wired into `EditorPane` above the limit-warning banner; shown only when `tab.params.length > 0`.
- **Persistence**: `QueryParam[]` added to `QueryTab` and `SavedQuery` in `src/shared/types.ts`. `SaveQueryModal` passes `tab.params` on save; `Editor.tsx` passes `tab.params` on update-save. `SavedQueriesPanel` seeds `params` from the saved query and calls `syncTabParams` to reconcile against the current SQL on open.

**Files affected:**
- `src/shared/types.ts` — `QueryParam` type + `params` on `QueryTab`/`SavedQuery`
- `src/renderer/src/lib/extractParams.ts` — created
- `src/renderer/src/lib/substituteParams.ts` — created
- `src/renderer/src/store/queryStore.ts` — `reconcileParams`, `setTabParams`/`syncTabParams`, `updateTabSql` sync, `runQuery`/`explainQuery` substitution + block-on-error
- `src/renderer/src/components/editor/ParamsPanel.tsx` — created
- `src/renderer/src/components/editor/EditorPane.tsx` — render `ParamsPanel`
- `src/renderer/src/components/editor/SaveQueryModal.tsx` — persist `params` on save
- `src/renderer/src/pages/Editor.tsx` — persist `params` on update-save
- `src/renderer/src/components/saved/SavedQueriesPanel.tsx` — seed + sync `params` on open
- `src/__tests__/renderer/lib/extractParams.test.ts` — created (9 tests)
- `src/__tests__/renderer/lib/substituteParams.test.ts` — created (11 tests)
- `src/__tests__/renderer/store/queryStore.test.ts` — extended (`query params` block, 8 tests)
- `README.md`, `CHANGELOG.md` — docs

---

### [2026-06-23] Refactor: Consolidate formatBytes into one shared helper (+ fix RunConfirmCard units)

**Type:** Change
**Context:** Fourth step of the "harden what exists" campaign. `formatBytes` was defined four times: the canonical tested decimal version in `lib/formatBytes.ts`, byte-identical copies in `main/db/bigquery.ts` and `results/ExplainPanel.tsx`, and a **divergent** copy in `chat/RunConfirmCard.tsx` (1024-based `B/KB/MB/GB/TB` units + an `'unknown'` fallback). The chat run-confirmation card therefore showed a different byte figure than the rest of the app for the same scan.
**Problem / Change:** 4× duplication with a real user-visible inconsistency in the AI run-confirm card.
**Solution / Outcome:**
- **`src/shared/formatBytes.ts`** (new): single source of truth, the canonical decimal formatter (`KB`/`MB`/`GB`, 1000-based). Lives in `shared/` because both the main and renderer processes use it. Renderer imports via `@shared/formatBytes`; `bigquery.ts` imports by relative path (`../../shared/formatBytes`), matching the main process's convention.
- **Consumers repointed:** `ResultsToolbar.tsx` (import path swap), `ExplainPanel.tsx`, `RunConfirmCard.tsx`, and `bigquery.ts` (each drops its local copy and imports the shared one). `lib/formatBytes.ts` and its test deleted; the test relocated to `src/__tests__/shared/formatBytes.test.ts`.
- **Behavior change (intended):** `RunConfirmCard` now uses the canonical decimal formatter — the "Est. … scanned" label switches from 1024-based units to decimal, and `0` bytes renders `"0.0 KB"` instead of `"unknown"`. All other call sites are unchanged (their copies were byte-identical).
- **Coverage:** the helper moved out of the gated `lib/**` set into ungated `shared/**`, but stays fully covered by `src/__tests__/shared/formatBytes.test.ts`. `just ci` green.

**Files affected:**
- `src/shared/formatBytes.ts` — created
- `src/__tests__/shared/formatBytes.test.ts` — created
- `src/renderer/src/lib/formatBytes.ts`, `src/__tests__/renderer/lib/formatBytes.test.ts` — deleted
- `src/renderer/src/components/results/{ResultsToolbar,ExplainPanel}.tsx`, `src/renderer/src/components/chat/RunConfirmCard.tsx`, `src/main/db/bigquery.ts` — import the shared helper; local copies removed

---

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

---

### [2026-06-22] Refactor: Extract ConnectionModal validation + payload into a tested pure helper

**Type:** Change
**Context:** First step of the "harden what exists" campaign (see `docs/adr/0001-testing-strategy-and-coverage-gate-scope.md`). `ConnectionModal.tsx` carried two correctness-critical pure functions inline — an `isValid` per-engine required-field check and a `buildPayload` per-engine `ConnectionCreate` constructor — both untested (components sit outside the coverage gate).
**Problem / Change:** A wrong payload silently produces a broken connection, yet none of the per-engine validation/payload logic had tests.
**Solution / Outcome:**
- **`src/renderer/src/lib/connectionForm.ts`** (new, pure): `ConnectionFormFields` (flat snapshot of all form fields), `isConnectionInputValid(fields)`, and `buildConnectionPayload(fields)`. Semantics copied verbatim from the component, preserving the deliberate asymmetries (Postgres/Neo4j passwords untrimmed; Snowflake password trimmed; BigQuery `serviceAccountPath` only set for `service-account`; blank optional Snowflake/Neo4j fields → `undefined`).
- **`ConnectionModal.tsx`**: assembles a `ConnectionFormFields` object from its `useState` values and delegates to the two helpers; inline `isValid` IIFE and `buildPayload` closure removed; now-unused `ConnectionCreate` import dropped. No prop or render change.
- **Tests** (new): `connectionForm.test.ts` covers all four engines for both functions, including the password trim/no-trim asymmetry and optional-field handling. `lib/**` is outside the coverage `include` set, so the 70% gate is unaffected.

**Files affected:**
- `src/renderer/src/lib/connectionForm.ts` — created
- `src/__tests__/renderer/lib/connectionForm.test.ts` — created
- `src/renderer/src/components/connections/ConnectionModal.tsx` — delegate to helpers
- `docs/adr/0001-testing-strategy-and-coverage-gate-scope.md` — referenced (created alongside this work)

---

### [2026-06-22] Refactor: Decompose TitleBar (TD-4)

**Type:** Change
**Context:** Tier 2 tech-debt decomposition (register `docs/superpowers/specs/2026-06-21-tech-debt-register-design.md`). `TitleBar.tsx` was the most-churned file in the repo (310 LOC, 17 commits) — it had accreted the connection breadcrumb + dropdown, edit/delete-confirm state machine, health dots, per-engine accents, AI toggle, and the settings/update badge. Per plan `docs/superpowers/plans/2026-06-21-decompose-titlebar.md`. Sibling of TD-3 (ResultsTable); shipped on its own branch/PR.
**Problem / Change:** One churn-magnet component owning many unrelated concerns. No behavior change intended.
**Solution / Outcome:** Behavior-preserving extraction. `TitleBar` becomes a thin layout shell (310 → 57 LOC): traffic-light spacer + brand + `<ConnectionMenu>` + the centered `<CommandPalette>` (kept in place with its `paletteRef`) + `<TitleBarActions>`. Extracted units:
- **`lib/connectionMeta.ts`** — pure `connectionLabel`/`engineAccent`/`engineColor` (now unit-tested, 6 tests). Note `engineColor` and `engineAccent` have distinct unknown-engine fallbacks (`text-app-text` vs `text-app-text-3`).
- **`StatusDot.tsx`** — the health dot (ok/error/unknown).
- **`ConnectionMenu.tsx`** — the churn-magnet core: breadcrumb trigger + "add" button + the `createPortal` dropdown with the edit/delete-confirm state machine (3s auto-dismiss, disabled-while-deleting), open/position/outside-click, and the row-click focused-tab re-point (`useQueryStore.getState()` → `setTabConnection` → `setActive`). Reads `connectionStore`/`queryStore` itself, as `TitleBar` did.
- **`TitleBarActions.tsx`** — the AI chat toggle (`aria-pressed`) + settings button with the `updateStore`-driven update badge.
- **Tests/CI.** No component-test infra for these UI files (outside the coverage include set); verification was `tsc` + the full suite staying green per task + the new `connectionMeta` tests. `just ci` green: 508 tests, coverage gate holds.

**Files affected:**
- `src/renderer/src/components/layout/TitleBar.tsx` — reduced to a thin shell
- `src/renderer/src/components/layout/{StatusDot,ConnectionMenu,TitleBarActions}.tsx` — created
- `src/renderer/src/lib/connectionMeta.ts` — created (moved out of TitleBar)
- `src/__tests__/renderer/lib/connectionMeta.test.ts` — created
- `CHANGELOG.md` — Unreleased "Changed" entry
- `docs/superpowers/plans/2026-06-21-decompose-titlebar.md` — plan

### [2026-06-22] Refactor: Decompose ResultsTable (TD-3)

**Type:** Change
**Context:** Tier 2 tech-debt decomposition (register `docs/superpowers/specs/2026-06-21-tech-debt-register-design.md`). `ResultsTable.tsx` was the largest file in the repo (607 LOC, 27 hooks/fns, 15 commits) — virtualization, filter/sort, TSV-copy, pagination, export, and graph-cell rendering all in one component. Per plan `docs/superpowers/plans/2026-06-21-decompose-results-table.md`.
**Problem / Change:** One oversized component mixing many concerns. No behavior change intended.
**Solution / Outcome:** Behavior-preserving extraction behind the existing `memo` boundary. `ResultsTable` stays the memoized default export and the **orchestrator** (607 → 210 LOC) — it keeps all state (page/pageSize/filters/sort/colWidths/export+copy flags), the `filteredRows`/`pageRows` derivations, the new-result reset effect, and `handleNextPage`/`handleExport`/`handleCopy`. Extracted units:
- **`lib/formatCell.ts` + `lib/formatBytes.ts`** — pure formatters (now unit-tested, 7 tests).
- **`QueryLogView.tsx`** — the shared log-list renderer (used by the running/cancelled/error states; owns the scroll-to-end).
- **`ResultsStateView.tsx`** — running / cancelled / error / empty early states + a `resultsViewState()` discriminator; the orchestrator early-returns it when `state !== 'table'`.
- **`ResultsToolbar.tsx`** — the top status bar (counts + filter/pin/copy/export controls); owns the export popover's open/outside-click state locally.
- **`FilterSortBar.tsx`** — the per-column filter input row.
- **`ResultsGrid.tsx`** — the virtualized `<table>`; owns the TanStack virtualizer (scroll/tbody refs, `scrollMargin` measurement, spacer-row padding math), column-resize, and copy-column-name. `colWidths` stays in the parent (shared with the filter bar + reset effect); the sort toggle is a parent `onToggleSort` callback; `resetKey={filteredRows}` (array identity) preserves the original scroll-reset semantics.
- **`ResultsPagination.tsx`** — the bottom pagination bar (range label, rows-per-page, prev/next).
- **Tests/CI.** No component-test infra exists for these UI files (outside the coverage include set); verification was `tsc` + the full suite staying green per task + the new `lib/*` formatter tests. `just ci` green: 509 tests, coverage gate holds.

**Files affected:**
- `src/renderer/src/components/results/ResultsTable.tsx` — reduced to orchestrator
- `src/renderer/src/components/results/{QueryLogView,ResultsStateView,ResultsToolbar,FilterSortBar,ResultsGrid,ResultsPagination}.tsx` — created
- `src/renderer/src/lib/{formatCell,formatBytes}.ts` — created (moved out of ResultsTable)
- `src/__tests__/renderer/lib/{formatCell,formatBytes}.test.ts` — created
- `CHANGELOG.md` — Unreleased "Changed" entry
- `docs/superpowers/plans/2026-06-21-decompose-results-table.md` — plan

### [2026-06-21] Refactor: Shared adapter query-runtime (TD-1/TD-2)

**Type:** Change
**Context:** After a dense run of features, a tech-debt audit (`docs/superpowers/specs/2026-06-21-tech-debt-register-design.md`) found the query-execution scaffolding copy-pasted across all four DB adapters: `elapsed()` defined identically in three files, and the `runningJobs` map + heartbeat `setInterval` + 180s timeout race + idempotent cleanup + `cancelRunningQuery` reimplemented in every adapter. The heartbeat log string had already drifted (Postgres used `${seconds}s` while the others used `elapsed()`). Per spec `docs/superpowers/specs/2026-06-21-adapter-query-runtime-design.md` and plan `docs/superpowers/plans/2026-06-21-adapter-query-runtime.md` (the "Balanced" scope).
**Problem / Change:** ~4× duplication of the query lifecycle, actively diverging; no main-process concurrency helper; identical `getDatasetColumns` accumulators in three adapters.
**Solution / Outcome:**
- **`src/main/db/queryRuntime.ts`** (new) — single source of truth for the lifecycle: `elapsed()`, `makeLogger(webContents, tabId)`, `startHeartbeat(log, start)`, a shared `runningJobs` registry of `{ cancel: () => Promise<void>; webContents }` keyed by `tabId`, one `cancelRunningQuery(tabId)`, and `runWithLifecycle({ tabId, webContents, timeoutMessage, execute })` — which owns the heartbeat, the 180s timeout race, idempotent cleanup, and registry insert/delete. `execute` receives `{ log, registerCancel }` and calls `registerCancel(thunk)` the moment it holds its engine handle (opaque cancel thunk, so the registry is engine-agnostic). Also `runCapped` (main-process concurrency cap, twin of the renderer's) and `groupColumnsByTable(rows, accessor)` (the shared `getDatasetColumns` accumulator). Constants `QUERY_TIMEOUT_MS`/`HEARTBEAT_INTERVAL_MS` moved here.
- **BigQuery / Snowflake / Neo4j** — `runQuery` rewritten to `return runWithLifecycle(...)`; local `elapsed`/`runningJobs`/heartbeat/timeout/cleanup deleted; `cancelRunningQuery` re-exports the shared one. Cancel thunks: `job.cancel()` / `stmt.cancel(cb)` / `session.close()`. Engine-specific pagination/retention maps (`completedJobs`/`completedStatements`/`completedResults`) stay local. Intentional nuance: BigQuery's heartbeat now starts before `createQueryJob` resolves (was after).
- **Postgres** — documented exception: keeps `SET statement_timeout` + its own heartbeat interval (no `runWithLifecycle`), but adopts shared `elapsed`/`makeLogger`/`startHeartbeat`/`QUERY_TIMEOUT_MS`/`runningJobs`/`cancelRunningQuery`. Its cancel thunk closes over `pid`+`pool` and calls `pg_cancel_backend`. The "Done" log changed from `${ms}ms` to `${elapsed(start)}` (the drift fix). Old `RunningQuery` map + `logToWebContents` removed.
- **TD-2** — BigQuery `searchTables` batch-of-5 loop → `runCapped`; the three SQL adapters' `getDatasetColumns` accumulators → `groupColumnsByTable` (dialect reading stays in each adapter's accessor). SQL unchanged.
- **Tests.** New `queryRuntime.test.ts` (15 tests: elapsed, makeLogger, startHeartbeat, runCapped, groupColumnsByTable, runWithLifecycle happy/error/timeout, cancelRunningQuery incl. destroyed-webContents branch). Added a Postgres cancel test (`pg_cancel_backend` via the shared registry) to close a pre-existing gap. All four adapter suites stayed green with no/minimal edits. `just ci` green: 502 tests, overall coverage 90.15%, all gates ≥70% (`queryRuntime.ts` 98.94%).

**Files affected:**
- `src/main/db/queryRuntime.ts` — created
- `src/main/db/bigquery.ts` — `runWithLifecycle`; `searchTables` → `runCapped`; `getDatasetColumns` → `groupColumnsByTable`
- `src/main/db/snowflake.ts` — `runWithLifecycle`; `getDatasetColumns` → `groupColumnsByTable`
- `src/main/db/neo4j.ts` — `runWithLifecycle`
- `src/main/db/postgres.ts` — shared primitives (keeps `statement_timeout`); `getDatasetColumns` → `groupColumnsByTable`; heartbeat-string drift fix
- `src/__tests__/main/db/queryRuntime.test.ts` — created
- `src/__tests__/main/db/postgres.test.ts` — added cancel test
- `CHANGELOG.md` — Unreleased "Changed" entry
- `docs/superpowers/specs/2026-06-21-tech-debt-register-design.md`, `docs/superpowers/specs/2026-06-21-adapter-query-runtime-design.md`, `docs/superpowers/plans/2026-06-21-adapter-query-runtime.md` — created

---

### [2026-06-22] Testing: Coverage gate widened to `renderer/src/lib/**` — tests for the two untested editor-completion helpers

**Type:** Change
**Context:** Per ADR-0001 (`docs/adr/0001-testing-strategy-and-coverage-gate-scope.md`), the Vitest coverage gate is being widened to include `src/renderer/src/lib/**`. Every `lib/` helper already had a unit test except two CodeMirror-completion helpers — `src/renderer/src/lib/inlineCompletion.ts` (the Copilot-style ghost-text ViewPlugin) and `src/renderer/src/lib/sqlCompletion.ts` (lang-sql schema-aware completion + the custom CTE source). Adding them to the include set without tests would have dropped the group below the 70% threshold and turned the gate red.
**Problem / Change:** Two pure-ish editor helpers were uncovered; the coverage `include` array did not measure `lib/**` at all.
**Solution / Outcome:**
- **`sqlCompletion.test.ts`** (8 tests) — drives `sqlSupport(engine, schema)` through a real `EditorState`: collects every autocomplete source via `state.languageDataAt('autocomplete', pos)` and runs them against a `CompletionContext`. Covers the extension shape, dialect mapping for all four engines + the `undefined` default, the custom CTE source (CTE names in table position, CTE columns after `alias.`, the replace-after-the-dot `from` offset, and no-CTE behavior), and lang-sql's schema table completion. `sqlCompletion.ts` lands at 100% statements.
- **`inlineCompletion.test.ts`** (12 tests) — mounts a real `EditorView` in jsdom with `vi.useFakeTimers()` to drive the 400 ms debounce and an injected `request` mock (the helper's IPC caller is constructor-injected for exactly this). Covers: the three-extension return shape; request fires after debounce and renders `.cm-inline-ghost`; the document-derived schema snippet; disabled / no-engine / blank-doc guards; debounced coalescing of rapid edits; the prefix LRU cache (returning to a seen state skips the request); **Tab** accept (inserts + clears ghost); **Esc** dismiss (clears ghost, doc unchanged); empty-completion and provider-rejection both render no ghost. `inlineCompletion.ts` lands at 93.85% statements.
- **`vitest.config.ts`** — added `src/renderer/src/lib/**/*.ts` to the coverage `include` set.
- `just ci` green: 506 tests; the `renderer/src/lib` group sits at 96.77% statements / 90.41% branches, well above the 70% gate.
- (Worktree note: `node_modules` was stale — `@anthropic-ai/sdk` and `recharts` were missing — so `npm install` was run before CI per the worktree dep-install gotcha.)

**Files affected:**
- `src/__tests__/renderer/lib/sqlCompletion.test.ts` — created (8 tests)
- `src/__tests__/renderer/lib/inlineCompletion.test.ts` — created (12 tests)
- `vitest.config.ts` — `src/renderer/src/lib/**/*.ts` added to coverage `include`

---

### [2026-06-20] Feature: Catalog warm-up

**Type:** Change
**Context:** The sidebar "Search tables…" box previously only filtered datasets/tables already loaded into memory (i.e. datasets the user had manually expanded). Similarly, the SQL/Cypher editor autocomplete could only suggest columns for tables whose schemas had already been fetched by opening a table detail panel. Both gaps meant users saw incomplete results until they manually drilled through the catalog. Per the spec at `docs/superpowers/specs/2026-06-20-catalog-warmup-design.md` and plan at `docs/superpowers/plans/2026-06-20-catalog-warmup.md`.
**Problem / Change:** Sidebar search missed tables in unexpanded datasets; editor autocomplete was missing tables and columns from datasets the user had not yet opened.
**Solution / Outcome:**
- **`getDatasetColumns` bulk fetch method.** All four engine adapters implement `getDatasetColumns(connection, datasetId): Promise<Record<string, TableField[]>>` — BigQuery fans out one `INFORMATION_SCHEMA.COLUMN_FIELD_PATHS` query per dataset (returning a flat column list keyed by table ID); Postgres runs a single `information_schema.columns` query filtered to the schema; Snowflake runs `INFORMATION_SCHEMA.COLUMNS` scoped to the `DATABASE.SCHEMA` composite ID; Neo4j reuses the existing `getTableSchema` sample-inference loop for each label/relationship type in the database. The `DbAdapter<TConnection>` interface in `adapterRegistry.ts` gains the new method; all four adapters are wired in.
- **`CATALOG_DATASET_COLUMNS` IPC channel.** New req/res channel (`{ connectionId, datasetId } → Record<string, TableField[]>`) registered in `src/main/ipc/catalog.ts`. Dispatches through `getAdapterForConnection` like the existing catalog channels.
- **`warmCatalog` Zustand action.** `catalogStore` gains `warmState: Record<string, 'idle' | 'warming' | 'warmed'>` and `warmCatalog(connectionId, opts?)`. On connect it loads datasets, then fans out `CATALOG_TABLES` + `CATALOG_DATASET_COLUMNS` concurrently for each dataset (concurrency cap 5 via `runCapped`), committing one merged state update per dataset to limit editor-extension reconfigure churn. `{ force: true }` bypasses the `'warmed'` guard for the refresh button. Datasets that error (permissions, regional restrictions) are silently skipped via a try/catch inside the per-dataset worker.
- **CatalogTree wiring.** `CatalogTree.tsx` calls `warmCatalog(activeConnectionId)` on connection change and `warmCatalog(activeConnectionId, { force: true })` on the refresh button click (replacing the old `loadDatasets` call). An "Indexing catalog…" hint (animated pulse) renders while `warmState[activeConnectionId] === 'warming'`. Because `warmCatalog` pre-populates the same `tablesByDataset` + `schemaCache` keys that the sidebar filter and `useSchemaPrefetch` already read, both sidebar search and autocomplete now span the full catalog immediately without any new consumer code.
- **Tests.** All four adapter `getDatasetColumns` implementations are unit-tested (happy path + empty dataset). The `CATALOG_DATASET_COLUMNS` IPC handler is covered in `catalog.test.ts` (happy path + missing connection). `catalogStore.test.ts` gains a `warmCatalog` describe block (skip-if-warmed, warming→warmed state transitions, per-dataset merge, force re-warm, error-swallowing). `just ci` green: 483 tests, coverage ≥ 70% across all gates.

**Files affected:**
- `src/shared/ipc.ts` — `CATALOG_DATASET_COLUMNS` channel + `IpcMap` entry
- `src/main/db/adapterRegistry.ts` — `getDatasetColumns` on `DbAdapter` interface; four adapter imports wired in
- `src/main/db/bigquery.ts` — `getDatasetColumns` implementation (INFORMATION_SCHEMA.COLUMN_FIELD_PATHS)
- `src/main/db/postgres.ts` — `getDatasetColumns` implementation (information_schema.columns)
- `src/main/db/snowflake.ts` — `getDatasetColumns` implementation (INFORMATION_SCHEMA.COLUMNS)
- `src/main/db/neo4j.ts` — `getDatasetColumns` implementation (getTableSchema loop)
- `src/main/ipc/catalog.ts` — `CATALOG_DATASET_COLUMNS` handler
- `src/renderer/src/store/catalogStore.ts` — `warmState`, `warmCatalog`, `runCapped`
- `src/renderer/src/components/catalog/CatalogTree.tsx` — warm on connect, force re-warm on refresh, "Indexing catalog…" hint
- `src/__tests__/main/db/bigquery.test.ts` — `getDatasetColumns` tests
- `src/__tests__/main/db/postgres.test.ts` — `getDatasetColumns` tests
- `src/__tests__/main/db/snowflake.test.ts` — `getDatasetColumns` tests
- `src/__tests__/main/db/neo4j.test.ts` — `getDatasetColumns` tests
- `src/__tests__/main/db/adapterRegistry.test.ts` — `getDatasetColumns` mock included in all four adapter mocks
- `src/__tests__/main/ipc/catalog.test.ts` — `CATALOG_DATASET_COLUMNS` handler tests
- `src/__tests__/renderer/store/catalogStore.test.ts` — `warmCatalog` tests

---

### [2026-06-20] Feature: Multi-connection split view, result charts, clipboard copy

**Type:** Change
**Context:** Three editor/results enhancements shipped together per spec `docs/superpowers/specs/2026-06-20-split-view-charts-export-design.md` and plan `docs/superpowers/plans/2026-06-20-split-view-charts-export.md`. The old split was intra-tab and shared one connection; users wanted to compare two *different* connections side-by-side, copy results to the clipboard, and chart results.
**Problem / Change:** No multi-connection split, no clipboard copy (only file export), no visualization beyond the Neo4j graph view.
**Solution / Outcome:**
- **Editor groups (multi-connection split).** Replaced the `rightPane`/`QueryPane` intra-tab split with a two-group model in `queryStore`. State gains `focusedGroup: 'left' | 'right'`, `activeByGroup: Record<GroupId, string | null>`, and `activeTabId` as a mirror; each `QueryTab` gains `groupId`. New actions `focusGroup`, `moveTabToGroup(tabId, target, beforeId?)`, `splitGroup`, `setTabConnection`; removed `toggleSplit`/`updateRightPaneSql`/`runRightPane`/`cancelRightPane` and the `-right` `QUERY_LOG` suffix routing. A private `normalizeGroups` helper enforces invariants (promote right→left when left empties, valid per-group active tab via last-tab fallback, focused group non-empty). `Editor.tsx` rewritten to render one column per group (right column only when a tab has `groupId === 'right'`), each with its own tab strip; HTML5 drag-drop moves tabs between strips (`moveTabToGroup`), drop-on-tab inserts before it. Connection is **per-tab and changeable**: a connection picker in the `QueryEditor` toolbar (new optional props `connections`/`connectionId`/`onConnectionChange`, supplied by `EditorPane`, which also derives each tab's engine from its own connection). The catalog sidebar + TitleBar breadcrumb follow the focused group's active tab connection (an `Editor.tsx` effect calls `connectionStore.setActive`; the old active-connection→tab sync effect is removed). The TitleBar connection dropdown now repoints the focused tab via `setTabConnection`.
- **Result charts.** New `ChartView` (Recharts) toggled from `ResultsRegion` (precedence: explain > graph > chart > table). Bar/line/scatter with X/Y/aggregate selectors; pure helper `aggregateForChart(rows, xCol, yCol, aggregate)` groups by X and reduces Y (`none/sum/avg/count/min/max`), computed client-side over fetched rows. Per-tab persistence via `resultView` + `chartConfig` on `QueryTab` and store actions `setResultView`/`setChartConfig`. `ChartConfig`/`ChartAggregate` added to `shared/types.ts`.
- **Clipboard copy.** Pure helper `rowsToTsv(rows, columns)` (unwraps BigQuery `{ value }`, flattens tabs/newlines) + a **Copy** button in the `ResultsTable` status bar that copies the current filtered/sorted view as TSV.
- **Tests.** `queryStore` tests reworked: split-pane block replaced with an `editor groups` block (8 tests) + `chart view` block (2 tests). Pure-unit tests for `rowsToTsv` (6) and `aggregateForChart` (6). `just ci` green (470 tests, coverage ≥70%, queryStore at ~85%).

**Files affected:**
- `src/shared/types.ts` — `ChartConfig`/`ChartAggregate`, `QueryTab.groupId`/`resultView`/`chartConfig`; removed `QueryPane`/`rightPane`
- `src/renderer/src/store/queryStore.ts` — editor-groups rewrite + `normalizeGroups` + chart actions
- `src/renderer/src/pages/Editor.tsx` — two-group layout + cross-group tab drag
- `src/renderer/src/components/editor/EditorPane.tsx` — derives engine, per-tab connection picker
- `src/renderer/src/components/editor/QueryEditor.tsx` — optional connection-picker props
- `src/renderer/src/components/layout/TitleBar.tsx` — dropdown repoints focused tab
- `src/renderer/src/components/results/ResultsRegion.tsx` — Table/Chart toggle
- `src/renderer/src/components/results/ChartView.tsx` — created
- `src/renderer/src/components/results/ResultsTable.tsx` — Copy (TSV) button
- `src/renderer/src/lib/{rowsToTsv,aggregateForChart}.ts` — created
- `src/__tests__/renderer/lib/{rowsToTsv,aggregateForChart}.test.ts` — created
- `src/__tests__/renderer/store/queryStore.test.ts` — editor-groups + chart-view blocks
- `package.json` — added `recharts`
- `README.md`, `CHANGELOG.md` — docs

---

### [2026-06-19] Feature: AI inline autocomplete

**Type:** Change
**Context:** The AI chat companion was already shipping, but the SQL/Cypher editor had no inline completion beyond the existing schema-aware keyword/column completions. Users asked for a Copilot-style experience — ghost text ahead of the cursor, accepted with Tab — without leaving the editor.
**Problem / Change:** No inline LLM completion existed. The `LlmProvider` interface had no `completeInline` method, there was no fast-model path, and no CodeMirror extension wired completion results to ghost text.
**Solution / Outcome:**
- **`completeInline` on `LlmProvider`.** `src/main/ai/llmProvider.ts` gains a `completeInline(prompt: string): Promise<string>` method on the interface. `src/main/ai/anthropicProvider.ts` implements it using Anthropic Haiku 4.5 (`claude-haiku-4-5`): non-streaming, `max_tokens: 256`, `temperature: 0.1`, stop sequences `['\n\n', ';']`. Provider-extensible — any future provider (OpenAI, Gemini) just implements the same method.
- **`AI_COMPLETE_INLINE` IPC channel.** New req/res channel in `src/shared/ipc.ts`. The handler in `src/main/ipc/ai.ts` reads `apiKey` + `inlineCompletionEnabled` from `aiConfig`, builds the prompt via `buildInlinePrompt`, sanitizes the output via `sanitizeCompletion`, and returns `{ text: string; error?: string }`. Never throws: missing key → `{ text: '' }`; provider error → `{ text: '', error }`.
- **Pure helpers (main process).** `src/main/ai/buildInlinePrompt.ts` — constructs the fill-in-the-middle prompt from the SQL text before and after the cursor, the active engine dialect, and an injected schema snippet (column list for referenced tables). `src/main/ai/sanitizeCompletion.ts` — strips code fences, trims trailing semicolons/whitespace, and guards against completions that duplicate text already ahead of the cursor.
- **Pure helper (renderer).** `src/renderer/src/lib/inlineSchemaContext.ts` — reuses `extractTableRefs` to find tables referenced in the query, looks up their columns from `schemaCache`, and serialises a compact `table(col, col, …)` snippet (≤ 10 columns per table, ≤ 3 tables) sent with each IPC request.
- **`inlineCompletion` CodeMirror extension.** `src/renderer/src/lib/inlineCompletion.ts` — a ViewPlugin that fires on every document change after a ~400 ms debounce. Cancels stale in-flight requests via a generation counter. Caches the last N completions in an LRU keyed by prefix so identical prefixes don't round-trip. On response, decorates the text ahead of the cursor with a `ghost-text` CSS class (greyed-out). **Tab** key binding accepts (inserts) the suggestion; **Esc** dismisses it. IPC caller is injected at construction time so the extension is fully unit-testable.
- **Opt-in config.** `aiConfig.inlineCompletionEnabled: boolean` added to `StoreData` in `src/main/db/store.ts` and to the `AiConfig` shared type. `src/renderer/src/store/aiSettingsStore.ts` (new Zustand store) exposes `enabled` + `keyConfigured`, reads/writes via `AI_CONFIG_GET` / `AI_CONFIG_SET`, and gates the extension: it activates only when both flags are true.
- **UI.** `src/renderer/src/components/settings/SettingsModal.tsx` gains an "Inline AI completions (experimental)" toggle in the **AI** section. `src/renderer/src/components/editor/QueryEditor.tsx` gains a `✨ AI` quick-toggle button in the editor toolbar (visible only when a key is configured). `src/renderer/src/App.tsx` boots `aiSettingsStore` on mount.
- **Tests.** Coverage-gated: `src/main/ipc/ai.ts` (extended with `AI_COMPLETE_INLINE` cases) and `src/renderer/src/store/aiSettingsStore.ts` (new store tests). Pure-unit: `buildInlinePrompt`, `sanitizeCompletion`, `inlineSchemaContext`, `anthropicProvider.completeInline`.

**Files affected:**
- `src/shared/types.ts` — `AiConfig.inlineCompletionEnabled`
- `src/shared/ipc.ts` — `AI_COMPLETE_INLINE` channel
- `src/main/db/store.ts` — `inlineCompletionEnabled` on `StoreData.aiConfig`
- `src/main/ai/llmProvider.ts` — `completeInline` on `LlmProvider` interface
- `src/main/ai/anthropicProvider.ts` — `completeInline` implementation (Haiku 4.5)
- `src/main/ai/buildInlinePrompt.ts` — created
- `src/main/ai/sanitizeCompletion.ts` — created
- `src/main/ipc/ai.ts` — `AI_COMPLETE_INLINE` handler added
- `src/renderer/src/lib/inlineSchemaContext.ts` — created
- `src/renderer/src/lib/inlineCompletion.ts` — created (CodeMirror ViewPlugin)
- `src/renderer/src/store/aiSettingsStore.ts` — created
- `src/renderer/src/components/editor/QueryEditor.tsx` — `✨ AI` toolbar toggle
- `src/renderer/src/components/settings/SettingsModal.tsx` — inline completions toggle
- `src/renderer/src/App.tsx` — boot `aiSettingsStore`
- `src/__tests__/main/ai/buildInlinePrompt.test.ts` — created
- `src/__tests__/main/ai/sanitizeCompletion.test.ts` — created
- `src/__tests__/main/ai/anthropicProvider.test.ts` — extended (`completeInline` cases)
- `src/__tests__/renderer/lib/inlineSchemaContext.test.ts` — created
- `src/__tests__/main/ipc/ai.test.ts` — extended (`AI_COMPLETE_INLINE` cases)
- `src/__tests__/renderer/store/aiSettingsStore.test.ts` — created

---

### [2026-06-19] Feature: AI chat companion

**Type:** Change
**Context:** Aperture had no way to interact with the catalog or run queries conversationally. Users needed an assistant that could answer questions about their data, generate SQL, and run exploratory queries without leaving the app.
**Problem / Change:** No AI integration existed. All query writing and catalog exploration required manual navigation.
**Solution / Outcome:**
- **Provider abstraction.** `src/main/ai/llmProvider.ts` defines an `LlmProvider` interface + registry; `src/main/ai/anthropicProvider.ts` is the sole implementation (Anthropic SDK, streaming). Designed so additional providers (OpenAI, Gemini) can be registered without changing call sites.
- **Main process owns LLM calls and the API key.** `AI_CHAT_COMPLETE` is a req/res IPC channel that sends a message list and returns the assistant turn. `AI_CHAT_STREAM` is a push channel (mirrors `QUERY_LOG`) that delivers streaming token chunks to the renderer. `AI_CONFIG_GET` returns a masked status object (never the raw key); `AI_CONFIG_SET` writes `apiKey` + `model` to the JSON store.
- **Chat threads.** `CHAT_THREADS_LIST`, `CHAT_THREADS_SAVE`, and `CHAT_THREADS_DELETE` IPC channels manage thread persistence. Threads are stored in `src/main/db/store.ts` under `chatThreads` (array) alongside `aiConfig` (apiKey/model). Each thread is bound to the connection ID it explored.
- **Renderer agent loop in `chatStore.ts`.** The Zustand store orchestrates the tool-use cycle: `tool_use` blocks in the assistant response are dispatched — data tools (`search_tables`, `list_datasets`, `get_table_schema`, `run_query`) call existing catalog/query IPC channels; `open_query_tab` is renderer-native (opens a new editor tab with the drafted SQL); `run_query` is gated by a confirmation card showing the SQL and estimated bytes (user clicks **Approve** or **Reject** before the query runs). Tool results are collected and sent back as `tool_result` messages; the loop continues until the model emits a plain text turn.
- **Result capping.** `src/main/ai/capResult.ts` trims query results to the first 50 rows plus a total-count annotation before feeding them back to the model.
- **System prompt and tool definitions.** `src/main/ai/systemPrompt.ts` describes the assistant's role (catalog explorer, SQL drafter, confirmation-gated executor); `src/main/ai/tools.ts` defines the four tool schemas passed to the Anthropic `tools` parameter.
- **UI.** Right-docked `ChatPanel` with a thread rail (layout option C from the spec): thread list on the left, active conversation on the right. Each message renders Markdown; tool calls and confirmation cards render as structured components. The ✨ (Sparkles) button in `TitleBar.tsx` toggles the panel. `SettingsModal.tsx` gains an **AI** section (API key input + model picker + save button).
- **Tests.** Coverage-gated files `src/main/ipc/ai.ts` and `src/main/ipc/chatThreads.ts` and `src/renderer/src/store/chatStore.ts` are covered. Pure helpers `capResult`, `systemPrompt`, `tools`, and `anthropicProvider` are unit-tested in `src/__tests__/main/ai/`.
- **AI inline autocomplete** (completions in the SQL editor triggered as you type) is a separate future spec and is **not** part of this work.

**Files affected:**
- `src/shared/types.ts` — `AiConfig`, `ChatThread`, `ChatMessage`, `ToolConfirmation`, `AiConfigStatus`
- `src/shared/ipc.ts` — `AI_CHAT_COMPLETE`, `AI_CHAT_STREAM`, `AI_CONFIG_GET`, `AI_CONFIG_SET`, `CHAT_THREADS_LIST`, `CHAT_THREADS_SAVE`, `CHAT_THREADS_DELETE`
- `src/main/db/store.ts` — `chatThreads`, `aiConfig` fields on `StoreData`
- `src/main/ai/llmProvider.ts`, `anthropicProvider.ts`, `capResult.ts`, `systemPrompt.ts`, `tools.ts` — created
- `src/main/ipc/ai.ts`, `src/main/ipc/chatThreads.ts` — created; `src/main/ipc/index.ts` — register
- `src/renderer/src/store/chatStore.ts` — created
- `src/renderer/src/components/chat/ChatPanel.tsx`, `ChatThread.tsx`, `ChatMessage.tsx`, `ToolConfirmationCard.tsx`, `ThreadRail.tsx` — created
- `src/renderer/src/components/settings/SettingsModal.tsx` — AI section added
- `src/renderer/src/components/layout/TitleBar.tsx` — Sparkles toggle button
- `src/renderer/src/App.tsx` — chat panel state, `chatStore` boot
- `package.json` — `@anthropic-ai/sdk`
- `src/__tests__/main/ai/{capResult,systemPrompt,tools,anthropicProvider}.test.ts` — created
- `src/__tests__/main/ipc/{ai,chatThreads}.test.ts` — created
- `src/__tests__/renderer/store/chatStore.test.ts` — created
- `README.md`, `CHANGELOG.md` — docs

### [2026-06-18] Feature: In-app update notifier (GitHub notify-and-redirect)

**Type:** Change
**Context:** Aperture ships unsigned, un-notarized DMGs to GitHub Releases and had no way to tell users a new version exists. Silent auto-update via electron-updater is impossible without an Apple Developer ID cert (Squirrel.Mac refuses unsigned updates), and there is no free notarization/App Store path. Per the spec at `docs/superpowers/specs/2026-06-18-auto-update-notifier-design.md` and plan at `docs/superpowers/plans/2026-06-18-auto-update-notifier.md`, this is a notify-and-redirect updater (Approach: free, no signing).
**Problem / Change:** Users had to manually check the repo for new releases.
**Solution / Outcome:**
- **Main process owns the check.** `src/main/updates/` holds pure, testable helpers — `compareSemver` (numeric major.minor.patch, strips `v`/prerelease, returns 0 on garbage so no false positives) and `selectDmgAsset` (matches `-${arch}.dmg` against electron-builder's artifact names) — plus `checkForUpdate(currentVersion, arch)` which fetches GitHub `/releases/latest` (excludes drafts/prereleases), compares, and resolves to an `UpdateStatus` (never throws; failures carry an `error`).
- **IPC:** new `UPDATES_CHECK` (req/res) handler + `pushUpdateStatus(window)` helper in `src/main/ipc/updates.ts`; `UPDATES_STATUS` push channel (mirrors `QUERY_LOG`). `main/index.ts` runs a scheduler (initial check ~5s after launch, then every 3h) that pushes status to the renderer.
- **Renderer:** `updateStore` (Zustand) holds `UpdateStatus`, exposes `checkNow()`, and subscribes to `UPDATES_STATUS`. `TitleBar` badges the gear with a terracotta dot when `updateAvailable`. `SettingsModal` became a two-section modal (Themes / Updates); the Updates section shows current vs latest version, release notes, a manual check button, an arch-aware **Download** (plain `<a target="_blank">` → existing `setWindowOpenHandler` → `shell.openExternal`), and the `xattr -cr` install hint with a copy button.
- **Tests:** `compareSemver` (7), `selectDmgAsset` (4), `checkForUpdate` (5), `updates` IPC handler + `pushUpdateStatus` (4), `updateStore` (3). Coverage gate holds (`src/main/ipc/updates.ts` and `src/renderer/src/store/updateStore.ts` are in the include set and covered; `src/main/updates/**` sits outside it like the other `lib/*` parsers).

**Files affected:**
- `src/shared/types.ts` — `UpdateStatus`
- `src/shared/ipc.ts` — `UPDATES_CHECK` + `UPDATES_STATUS` channels
- `src/main/updates/{compareSemver,selectDmgAsset,checkForUpdate}.ts` — created
- `src/main/ipc/updates.ts` — created; `src/main/ipc/index.ts` — register
- `src/main/index.ts` — update scheduler
- `src/renderer/src/store/updateStore.ts` — created
- `src/renderer/src/components/layout/TitleBar.tsx` — gear badge
- `src/renderer/src/components/settings/SettingsModal.tsx` — Updates section
- `src/__tests__/main/updates/*`, `src/__tests__/main/ipc/updates.test.ts`, `src/__tests__/renderer/store/updateStore.test.ts` — created
- `README.md`, `CHANGELOG.md` — docs
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
- `CHANGELOG.md` — docs (README has no catalog-ordering description, left unchanged)

---

### [2026-06-14] Feature: Smarter SQL autocomplete

**Type:** Change
**Context:** SQL autocomplete only knew columns for tables the user had manually opened (the `sqlSchema` fed to `@codemirror/lang-sql` is built in `Editor.tsx` from `catalogStore.schemaCache`, which only fills on table-detail open), had no alias/CTE awareness, and didn't reliably auto-open. Per the spec at `docs/superpowers/specs/2026-06-14-sql-autocomplete-design.md` and plan at `docs/superpowers/plans/2026-06-14-sql-autocomplete.md` (Approach A). Built on top of the renderer responsiveness refactor (memoized editor extensions).
**Problem / Change:** Completions lacked columns for un-opened tables, ignored aliases/CTEs, and felt unhelpful.
**Solution / Outcome:**
- **`useSchemaPrefetch`** (new hook) — debounced (250 ms); parses the active query for referenced tables (`extractTableRefs`), resolves them against loaded catalog table lists (`buildTableLookup`), and background-loads their schemas via `catalogStore.loadSchema` (concurrency-capped at 5, errors swallowed). Subscribes to `tablesByDataset`; reads `schemaCache`/`loadSchema` via `getState()` inside the debounce so schema writes don't re-trigger it. Columns now appear without opening a table.
- **`sqlCompletion.ts`** (new) — `sqlSupport(engine, sqlSchema)` builds lang-sql's schema-aware completion (tables/columns/FROM-alias resolution) and layers a custom CTE completion source (`cteCompletionOptions` from `extractCteCompletions`) via `language.data.of({ autocomplete })`. The CTE source computes the replace-`from` offset for `alias.` and returns CTE names in table position / CTE columns after a dot.
- **`extractTableRefs` / `extractCteCompletions` (+ `cteCompletionOptions`) / `buildTableLookup`** (new, pure, unit-tested, 20 tests total) — the parsing/resolution core; comment/string-stripping and paren-aware select-list splitting; tolerant of partial mid-typing SQL.
- **`QueryEditor`** — SQL engines route through `sqlSupport`; added `autocompletion({ activateOnTyping: true, defaultKeymap: true, icons: true })` to the memoized extensions for auto-open. Removed the now-dead `sql`/`PostgreSQL`/`StandardSQL` import + `CM_DIALECT_MAP` (moved into `sqlCompletion`); kept `FORMAT_DIALECT_MAP`. Cypher path unchanged.
- **`Editor.tsx`** — calls `useSchemaPrefetch(activeTab?.sql ?? '', activeConnectionId ?? undefined)`.
- Completion stays local/instant (no IPC on the completion path; prefetch happens ahead in the background). No store API change → 360 tests pass (existing 340 + 20 new parser tests); coverage gate unaffected (new `lib/*` parsers sit outside the include set, like `detectMissingLimit`/`buildCypherQuery`).

**Files affected:**
- `src/renderer/src/lib/{extractTableRefs,extractCteCompletions,buildTableLookup,sqlCompletion}.ts` — created
- `src/renderer/src/hooks/useSchemaPrefetch.ts` — created
- `src/renderer/src/components/editor/QueryEditor.tsx` — sqlSupport + autocompletion config
- `src/renderer/src/pages/Editor.tsx` — useSchemaPrefetch call
- `src/__tests__/renderer/lib/{extractTableRefs,extractCteCompletions,buildTableLookup}.test.ts` — created (20 tests)
- `CHANGELOG.md` — docs

---

### [2026-06-14] Performance: Renderer responsiveness refactor

**Type:** Change
**Context:** Editor typing and large result tables felt janky. Profiling traced it to `Editor` subscribing to the whole query store: each keystroke (`updateTabSql`) re-rendered the un-memoized `ResultsTable`, which re-ran `filterSortRows` over the full result set and repainted up to 500 rows. Per the spec at `docs/superpowers/specs/2026-06-14-responsiveness-refactor-design.md` and plan at `docs/superpowers/plans/2026-06-14-responsiveness-refactor.md`, this was a renderer refactor (Approach A), not a stack swap.
**Problem / Change:** Whole-store subscriptions + an un-memoized, un-virtualized results table made every keystroke pay for a full table repaint.
**Solution / Outcome:**
- **`ResultsTable`** — wrapped in `React.memo`; `filterSortRows` + `paginate` derivation hoisted above the early returns and memoized; rows virtualized with `@tanstack/react-virtual` using spacer-row (`paddingTop`/`paddingBottom`) virtualization that preserves the sticky `<thead>`, `colgroup` widths, column-resize, and `GraphElementChip` cells. Two review-caught fixes: reset `scrollTop` when the data window changes (page/filter/sort/new result), and `scrollMargin = tbody offsetTop` so the virtualizer's range accounts for the sticky header. Removed leftover `[Export]` debug logs.
- **`ResultsRegion`** (new) — memoized; owns the explain/graph/table swap + graph-shape detection; subscribes via `useShallow` to only the active tab's result/logs/explain/graph fields; passes `useCallback`-stable `onFetchPage`/`onPin` so the `ResultsTable` memo is effective.
- **`EditorPane`** (new) + **`QueryEditor`** — memoized; CodeMirror `extensions` array memoized so typing no longer reconfigures the editor; `EditorPane` subscribes to only the tab's `sql`/run fields and owns the auto-limit banner + run/cancel/explain handlers.
- **`Editor.tsx`** — whole-store destructure replaced with narrow per-action selectors + a stable `useCallback` `handleSave`; the moved run/limit handlers and dead store actions removed. Split-right pane stays inline (table-only, lower-traffic). No store API change → 340 tests green; coverage gate unaffected (changed UI files are outside the coverage include set).
- **New pure helper** `paginate()` (4 tests). `@tanstack/react-virtual` added.

**Files affected:**
- `package.json` — `@tanstack/react-virtual`
- `src/renderer/src/lib/paginate.ts` + `src/__tests__/renderer/lib/paginate.test.ts` — created
- `src/renderer/src/components/results/ResultsTable.tsx` — memo + virtualize
- `src/renderer/src/components/results/ResultsRegion.tsx` — created
- `src/renderer/src/components/editor/EditorPane.tsx` — created
- `src/renderer/src/components/editor/QueryEditor.tsx` — memo + memoized extensions
- `src/renderer/src/pages/Editor.tsx` — selector subscriptions; delegate to EditorPane/ResultsRegion
- `README.md`, `CHANGELOG.md` — docs

---

### [2026-06-10] Feature: Neo4j support — Phase 2 (Graph visualization)

**Type:** Change
**Context:** Phase 1 made Neo4j a fully usable engine but graph-shaped results — Cypher's native shape — still rendered as truncated text chips in the results table. Phase 2 adds the interactive graph canvas the design spec (`docs/superpowers/specs/2026-06-07-neo4j-support-design.md`) called for, per the plan at `docs/superpowers/plans/2026-06-08-neo4j-phase2-graph-viz.md`.
**Problem / Change:**
- No way to actually see the topology of a graph-shaped result. The chips communicate "this is a Node" but not "this Node connects to those Nodes through those Relationships."

**Solution / Outcome:**
- **`buildGraphFromRecords.ts`** (new, pure) — walks every record's cells, extracts Node / Relationship / Path values, de-dupes by Neo4j element ID, walks Path segments, filters orphan links (relationships whose endpoints aren't in the result set), and caps at 500 nodes. Past the cap returns `{ truncated: true, nodeCount }` instead of a graph payload.
- **`detectGraphShape.ts`** (new, pure) — short-circuiting check reusing Phase 1's `isGraphElement`; decides whether to surface the banner.
- **`graphPalette.ts`** (new, pure) — stable label → `cat-*` token via a small string hash, cycling past 5 distinct labels; `(unknown)` sentinel maps to the muted text token.
- **`GraphView.tsx`** (new) — two-column layout: flexible canvas + fixed-width 280px inspector (the spec's "never floating" requirement). Wraps `react-force-graph-2d` with a custom `nodeCanvasObject` paint callback drawing Aperture-token-colored circles, an accent selection ring, and node labels past 1.4× zoom. Three integration fixes beyond the plan draft: (1) canvas 2D contexts can't resolve CSS custom properties, so `resolveCanvasColor` resolves each `rgb(var(--c-*))` token against `:root` via `getComputedStyle` (cached per token) — DOM siblings keep raw tokens; (2) force-graph mutates `link.source`/`link.target` into node object references after layout, so `normalizeLink` converts back to string ids before the inspector renders; (3) a `ResizeObserver` feeds explicit width/height (force-graph defaults to window size and would bleed under the inspector), and node/link data is cloned before handoff since the library mutates node objects in place.
- **`GraphInspector.tsx`** + **`GraphLegend.tsx`** + **`GraphShapedBanner.tsx`** (new) — persistent side inspector (empty state / node details / relationship details with property tables), top-left `bg-app-surface/90 backdrop-blur` legend derived from on-screen labels/types, and the auto-detection banner ("View as graph" CTA, or warn-toned "too many to visualize — try adding a LIMIT" past the cap).
- **`queryStore.toggleGraphView`** + `viewAsGraph?: boolean` on `QueryTab` — persists the view choice per tab across tab switches.
- **`Editor.tsx`** — `graphShape` useMemo (detect gate → build for truncation/count) + shared `renderResultsRegion` helper with precedence explain panel > graph view > banner + table, used by both the single-pane layout and the split layout's left pane (split right pane intentionally stays table-only in v1).
- **`shared/types.ts`** — rendering-side `GraphNode` / `GraphLink` / `GraphData` types, distinct from the `__neo4jType`-tagged wire types.
- Canvas library stubbed in `src/__tests__/setup.ts` (jsdom lacks the 2D-context APIs it drives); behavior covered through the pure-utility + store tests.
- **Tests** (17 new): `buildGraphFromRecords` (7), `detectGraphShape` (4), `graphPalette` (4), `queryStore.toggleGraphView` (2). 336/336 tests pass; coverage gate holds.

**Files affected:**
- `package.json` — added `react-force-graph-2d`
- `src/shared/types.ts` — `viewAsGraph` on QueryTab + `GraphNode`/`GraphLink`/`GraphData`
- `src/renderer/src/store/queryStore.ts` — `toggleGraphView`
- `src/renderer/src/lib/{buildGraphFromRecords,detectGraphShape,graphPalette}.ts` — created
- `src/renderer/src/components/results/{GraphView,GraphInspector,GraphLegend,GraphShapedBanner}.tsx` — created
- `src/renderer/src/pages/Editor.tsx` — graphShape memo + renderResultsRegion + view swap
- `src/__tests__/setup.ts` — react-force-graph-2d stub
- `src/__tests__/renderer/lib/{buildGraphFromRecords,detectGraphShape,graphPalette}.test.ts` — created (15 tests)
- `src/__tests__/renderer/store/queryStore.test.ts` — extended (2 tests)
- `README.md`, `CHANGELOG.md` — graph-view docs + Unreleased entry

---

### [2026-06-08] Feature: Neo4j support — Phase 1 (Foundation: "Cypher-as-SQL")

**Type:** Change
**Context:** The app supported BigQuery, Postgres, and Snowflake — all SQL/relational. A user requested Neo4j (graph database, Cypher query language). Phase 1 of the approved two-phase design spec (`docs/superpowers/specs/2026-06-07-neo4j-support-design.md`) makes Neo4j a fully usable fourth engine; Phase 2 (graph visualization canvas) is deferred to its own plan.
**Problem / Change:**
- No `Neo4jConnection` type, no Bolt adapter, no Cypher editor support, no graph-native catalog shape, and no way to render Node/Relationship/Path result values.

**Solution / Outcome:**
- **`src/main/db/neo4j.ts`** (new): full `DbAdapter<Neo4jConnection>` over `neo4j-driver` (Bolt). `testConnection` (`verifyConnectivity`), `listDatasets` (`SHOW DATABASES`, de-duped, system hidden, fallback for single-db servers), `listTables` (`CALL db.labels()` + `db.relationshipTypes()` tagged `LABEL`/`RELATIONSHIP_TYPE` with per-item counts), `getTableSchema` (sample-inferred, first-observed-type-wins via `inferPropertyType`), `searchTables`, `runQuery` (Snowflake-style heartbeat / 180s timeout / cancel via session.close; full result retained for in-memory pagination since Cypher has no native page-token), `getQueryPage` (offset slice), `cancelRunningQuery` (`session.close()`), `dryRunQuery` (`EXPLAIN` plan tree → JSON, Integer values stringified), `invalidateClient` (`driver.close()`). Driver class instances (Node / Relationship / Path / Integer / temporal / spatial) are serialized to plain `__neo4jType`-tagged objects at the IPC boundary via `serializeValue`, with a `value.constructor !== Object` duck-typed catch-all so temporal/spatial types stringify generically.
- **No new IPC channels** — Neo4j reuses `CONNECTIONS_*`/`CATALOG_*`/`QUERY_*` verbatim once registered in `adapterRegistry.ts`.
- **Shared types**: `Neo4jConnection`, `Neo4jNode`/`Neo4jRelationship`/`Neo4jPath`/`Neo4jGraphValue` (all tagged with `__neo4jType` for the structured-clone boundary), `'neo4j'` engine, `LABEL`/`RELATIONSHIP_TYPE` table kinds.
- **Renderer**: fourth `ConnectionModal` tab (inline fields — URI / Username / Password / Database — not a separate Form component); new `cat-teal` token + `TitleBar` accents (`connectionLabel`/`engineColor`/`engineAccent`); `CatalogTree` two-section grouping (Labels / Relationship Types) with `Circle`/`ArrowLeftRight` teal icons and Cypher "Query …" actions (`buildCypherQuery.ts`); `TableDetailPanel` sample-inferred caveat banner on the Schema tab when engine === 'neo4j'; Cypher CodeMirror `StreamLanguage` + schema-aware autocomplete (`cypherLanguage.ts`) wired into `QueryEditor` (engine-branched `languageExtension` memo) and `Editor.tsx` (new `cypherSchema` useMemo mirroring `sqlSchema`); compact graph-element chips (`formatGraphElement.ts` + `GraphElementChip.tsx`) in `ResultsTable`'s cell render with color-by-kind (teal nodes / purple relationships / blue paths); `detectMissingLimit` extended with Cypher read-statement starters (`MATCH`, `OPTIONAL MATCH`, `CALL`, `UNWIND`, `RETURN`).
- **CommandPalette**: `makeTableItem`'s `type` parameter widened to accept `LABEL` / `RELATIONSHIP_TYPE` so Neo4j ⌘K hits compile; sublabel gains `label · ` / `rel · ` prefixes.
- **Tests** (39 new): `neo4j.test.ts` (17 tests covering connection lifecycle, listDatasets de-dupe + fallback, listTables labels + relationship types + counts, getTableSchema node + relationship sampling, searchTables substring match, runQuery scalar+Node serialization + empty + error, getQueryPage + cancelRunningQuery, dryRunQuery), `buildCypherQuery.test.ts` (3 tests), `cypherLanguage.test.ts` (4 tests covering tokenizer tags + completion options), `formatGraphElement.test.ts` (5 tests covering discriminator + Node/Rel/Path format), extended `adapterRegistry.test.ts` (+2 tests for `neo4j` engine lookup + connection dispatch) + `detectMissingLimit.test.ts` (+4 Cypher cases). 318/318 tests pass, coverage on `neo4j.ts` is 88.26% statements / 71.17% branches (above the 70% gate).

**Files affected:**
- `package.json` — added `neo4j-driver`, promoted `@codemirror/autocomplete` + `@codemirror/language` to direct deps
- `src/shared/types.ts` — `Neo4jConnection`, graph value types, union/table-kind extensions
- `src/main/db/neo4j.ts` — created
- `src/main/db/adapterRegistry.ts` — register neo4j adapter
- `tailwind.config.ts`, `src/renderer/src/index.css` — `cat-teal` token (`:root` + `.dark`)
- `src/renderer/src/components/connections/ConnectionModal.tsx` — Neo4j tab + fields
- `src/renderer/src/components/layout/TitleBar.tsx` — teal accent
- `src/renderer/src/components/catalog/CatalogTree.tsx` — Labels / Relationship Types sections + teal icons
- `src/renderer/src/components/catalog/TableDetailPanel.tsx` — sample-inferred banner
- `src/renderer/src/components/command/CommandPalette.tsx` — widened type param for graph kinds
- `src/renderer/src/lib/buildCypherQuery.ts`, `cypherLanguage.ts`, `formatGraphElement.ts` — created
- `src/renderer/src/components/editor/QueryEditor.tsx`, `src/renderer/src/pages/Editor.tsx` — Cypher language + autocomplete + cypherSchema memo
- `src/renderer/src/components/results/GraphElementChip.tsx` — created
- `src/renderer/src/components/results/ResultsTable.tsx` — graph-element cell branch
- `src/renderer/src/lib/detectMissingLimit.ts` — Cypher read starters
- `src/__tests__/main/db/neo4j.test.ts` — created (17 tests)
- `src/__tests__/renderer/lib/{buildCypherQuery,cypherLanguage,formatGraphElement}.test.ts` — created (12 tests)
- `src/__tests__/main/db/adapterRegistry.test.ts` + `src/__tests__/renderer/lib/detectMissingLimit.test.ts` — extended (6 new tests)
- `README.md`, `CHANGELOG.md` — Neo4j subsection + Unreleased entry

---

### [2026-06-07] Feature: Theme import (Base16)

**Type:** Change
**Context:** The app shipped with exactly two hardcoded themes (light, dark) and a Sun/Moon toggle. Users wanted to bring their own colour schemes — specifically community themes from the Base16 ecosystem (Dracula, Nord, Gruvbox, Catppuccin, Solarized…).
**Problem / Change:**
- No way to import or manage custom palettes.
- Hardcoded light/dark toggle was redundant once arbitrary palettes are possible (each Base16 theme is already a complete self-contained palette, dark or light).
- No UI scaffolding for app settings beyond a flat title-bar toggle.

**Solution / Outcome:**
- **Base16 → Aperture token mapping**: pure `applyTheme(theme | null)` utility (`src/renderer/src/lib/applyTheme.ts`) deterministically derives Aperture's full ~30-token CSS-variable palette from the 16 Base16 slots. Direct mappings cover the 25 named tokens; the 5 "subtle" variants are computed via linear blending toward `base00` (e.g. `--c-accent-subtle = blend(base00, base09, 0.14)`). Output is injected as a `<style id="aperture-theme">` block that overrides `index.css`'s `:root`. Calling `applyTheme(null)` removes the override, re-adds `.dark` (so the built-in dark palette is restored), and clears the localStorage cache. Defensive: malformed hex falls back to the built-in.
- **Boot-time FOUC prevention**: `applyTheme` persists the computed CSS to `localStorage` under key `aperture-theme-css`. `bootstrapTheme()` is called from `src/renderer/src/main.tsx` synchronously *before* React mounts, reading the cached CSS and injecting the `<style>` tag in `<head>`. This eliminates the brief flash of the built-in palette that a pure `useEffect`-driven load would cause.
- **Persistent storage**: `themes: Theme[]` and `activeThemeId: string | null` added to `StoreData` in `aperture-store.json`. Five new IPC channels (`THEMES_LIST`, `THEMES_OPEN_FILE_DIALOG`, `THEMES_ADD`, `THEMES_REMOVE`, `THEMES_SET_ACTIVE`). Handlers in `src/main/ipc/themes.ts` validate Base16 files (parse with `js-yaml` — handles JSON as a subset — verify all 16 `base0X` slots are 6-char hex). Both uppercase (`base0A`) and lowercase (`base0a`) slot keys are accepted (community themes use both). Validation errors return a structured `{ error: string }` payload instead of throwing across the IPC boundary; user-cancelled dialog returns `null`.
- **Zustand store**: `useThemeStore` in `src/renderer/src/store/themeStore.ts` mirrors the `connectionStore` shape (`load`, `importFromFile`, `remove`, `setActive`). `load()` is called at app boot in `App.tsx` and applies the active theme (the bootstrap step has already taken care of the synchronous CSS injection; the IPC load refreshes the in-memory state).
- **Settings modal**: new `SettingsModal.tsx` (portal-rendered, ⌘+/Escape to close, click outside to close) with a left-nav (currently just "Themes" — architected for future sections) and a 3-column card grid. Each card is a real `<button>` with `aria-pressed` for keyboard activation and shows 4 representative colour swatches + name + author. Active theme has a terracotta border + accent dot. Built-in "Aperture Default" card is always first and not deletable; clicking it sets `activeThemeId` to `null`. Imported cards get a trash icon on hover (via `group-hover` on the wrapper) with an inline "Delete? No / Yes" confirm + 3s auto-dismiss. Local UI state resets on close. Modal has `role="dialog"`, `aria-modal`, and `aria-labelledby`; close + delete buttons have `aria-label`.
- **Removed light/dark toggle**: `Sun`/`Moon` button in title bar replaced with a `Settings` (gear) button. `App.tsx`'s `isDark` state, the `useEffect` managing the `.dark` class + `localStorage['theme']`, and the `onToggleTheme`/`isDark` prop chain are all gone. `index.css`'s `:root`/`.dark` blocks remain untouched (they are the built-in palette), and `html { @apply dark }` stays — dark is the permanent built-in default. Users get a light look by importing a light Base16 theme. The `CommandPalette` "Toggle theme" action is replaced with a "Settings" action that opens the modal.
- **Tests** (~50 new): `themes.test.ts` (18 IPC handler tests covering list/add/remove/set-active + file-dialog happy paths + invalid/cancelled/unreadable paths + hex normalisation + lowercase-key acceptance + empty-scheme filename fallback + author trim), `applyTheme.test.ts` (22 tests covering `hexToRgb`, `blend` math, style-tag lifecycle, `.dark` add/remove, derived-token correctness, full token-set coverage, bootstrap from localStorage, malformed-hex guard), `themeStore.test.ts` (12 tests covering initial state, load with/without active + stale-id guard, importFromFile happy/error/cancelled paths, remove with/without active, setActive with id/null + unknown-id fallback).

**Files affected:**
- `package.json` — added `js-yaml` + `@types/js-yaml`
- `src/shared/types.ts` — `Theme`, `ThemeImportPayload`
- `src/shared/ipc.ts` — 5 `THEMES_*` channels + IpcMap entries
- `src/main/db/store.ts` — `themes`, `activeThemeId` on `StoreData`
- `src/main/ipc/themes.ts` — created (5 handlers + Base16 file parser)
- `src/main/ipc/index.ts` — register themes handlers
- `src/renderer/src/lib/applyTheme.ts` — created (applyTheme + bootstrapTheme + hexToRgb + blend)
- `src/renderer/src/store/themeStore.ts` — created
- `src/renderer/src/components/settings/SettingsModal.tsx` — created
- `src/renderer/src/main.tsx` — call `bootstrapTheme()` before React mounts
- `src/renderer/src/App.tsx` — removed toggle, mount themes, render SettingsModal
- `src/renderer/src/components/layout/TitleBar.tsx` — gear icon replaces Sun/Moon
- `src/renderer/src/components/command/CommandPalette.tsx` — Settings action
- `src/renderer/src/lib/commandSearch.ts` — `CommandIcon` union: `'settings'` instead of `'sun'`
- `src/__tests__/main/ipc/themes.test.ts` — created (18 tests)
- `src/__tests__/renderer/lib/applyTheme.test.ts` — created (22 tests)
- `src/__tests__/renderer/store/themeStore.test.ts` — created (12 tests)
- `CHANGELOG.md` — Unreleased entry
- `docs/superpowers/specs/2026-06-06-theme-import-design.md` — design spec
- `docs/superpowers/plans/2026-06-06-theme-import.md` — implementation plan

---

### [2026-06-06] Feature: Quality-of-life — Auto-limit guard, Explain plan viewer, Shortcut cheatsheet

**Type:** Change
**Context:** With the ⌘K palette and design revamp shipped, the next highest-leverage work was three quick quality-of-life features that share no dependencies and landed together in one PR.
**Problem / Change:**
- BigQuery charges per byte scanned; a `SELECT *` without `LIMIT` on a large table costs real money and there was no guard.
- The `QUERY_DRY_RUN` IPC channel existed for all three engines but discarded the actual EXPLAIN output — only returning `bytesProcessed`.
- The app had ~7 shortcuts across different contexts with no discoverability.

**Solution / Outcome:**
- **Auto-limit guard**: Pure detection utility `detectMissingLimit(sql)` strips comments/strings, checks if the SQL is a SELECT/WITH, and scans backwards for `LIMIT` at paren depth 0. `LimitWarningBanner` renders between toolbar and results with "Add LIMIT 1000" and "Run anyway" buttons. `Editor.tsx` intercepts `handleRun` to check before executing.
- **Explain plan viewer**: Expanded `QUERY_DRY_RUN` response to include `plan?: string` and `planFormat?: 'text' | 'json'`. BigQuery extracts `queryPlan` stages from dry-run metadata as JSON. Postgres returns `EXPLAIN (FORMAT JSON)` output. Snowflake returns `EXPLAIN` rows as pipe-delimited text. New `ExplainPanel` component renders the plan as a `<pre>` block with a bytes-processed badge. New store actions `explainQuery` and `clearExplain`. QueryEditor gains an "Explain" button (ListTree icon) + `⌘E` keymap binding.
- **Keyboard shortcut cheatsheet**: `ShortcutCheatsheet` modal overlay via `createPortal`, triggered by `⌘/` global listener or "Keyboard shortcuts" action in the ⌘K palette. Shows three sections (Editor, Navigation, Palette) with `.app-kbd` chips.
- **Tests**: 5 new `explainQuery`/`clearExplain` tests in queryStore, 17 `detectMissingLimit` tests, 1 new BigQuery `queryPlan` present test, expanded Postgres/Snowflake `dryRunQuery` tests. 226 tests pass, coverage 84%.

**Files affected:**
- `src/shared/ipc.ts` — expanded `QUERY_DRY_RUN` response type
- `src/shared/types.ts` — added `explainResult`, `isExplaining` to `QueryTab`
- `src/main/db/adapterRegistry.ts` — updated `dryRunQuery` return type on `DbAdapter`
- `src/main/db/bigquery.ts` — extract `queryPlan` from dry-run metadata
- `src/main/db/postgres.ts` — return EXPLAIN JSON output
- `src/main/db/snowflake.ts` — return EXPLAIN text output
- `src/renderer/src/lib/detectMissingLimit.ts` — created
- `src/renderer/src/components/editor/LimitWarningBanner.tsx` — created
- `src/renderer/src/components/results/ExplainPanel.tsx` — created
- `src/renderer/src/components/command/ShortcutCheatsheet.tsx` — created
- `src/renderer/src/store/queryStore.ts` — added `explainQuery` + `clearExplain` actions
- `src/renderer/src/components/editor/QueryEditor.tsx` — Explain button + ⌘E keymap
- `src/renderer/src/pages/Editor.tsx` — limit-guard logic + ExplainPanel wiring
- `src/renderer/src/App.tsx` — cheatsheet state + ⌘/ listener + onShowShortcuts prop
- `src/renderer/src/components/command/CommandPalette.tsx` — "Keyboard shortcuts" action
- `src/renderer/src/components/layout/TitleBar.tsx` — `onShowShortcuts` prop pass-through
- `src/__tests__/renderer/lib/detectMissingLimit.test.ts` — created (17 tests)
- `src/__tests__/renderer/store/queryStore.test.ts` — extended (5 new tests)
- `src/__tests__/main/db/bigquery.test.ts` — extended (1 new test)
- `src/__tests__/main/db/postgres.test.ts` — updated dryRunQuery tests
- `src/__tests__/main/db/snowflake.test.ts` — updated dryRunQuery test
- `CHANGELOG.md` — Unreleased section added

---

### [2026-06-06] Feature: ⌘K command palette (Phase 3 of design revamp)

**Type:** Change
**Context:** With the chrome (Phase 1) and data surfaces (Phase 2) of the Direction D · Hybrid design system landed, the only remaining item from `DESIGN.md`'s "next round" list was the ⌘K command palette — described as "the single global entrypoint" and rendered in the mockup as a 360px hairline input in the title bar center. Today users navigate three sidebar tabs (Catalog / Saved / History) and a connection dropdown to find anything; there is no global jump-to. The catalog tree's table search only matches *already-loaded* datasets, leaving large BigQuery projects mostly undiscoverable without manual expansion.
**Problem / Change:**
- No global keyboard shortcut for jumping to a table, query, or action.
- Table search was limited to the in-memory catalog cache.
- History was re-fetched on every `HistoryPanel` mount (no shared store).

**Solution / Outcome:**
- **`shared/ipc.ts`** + **`shared/types.ts`**: new `CATALOG_SEARCH_TABLES` channel + `TableSearchHit` type.
- **`main/db/adapterRegistry.ts`**: `DbAdapter` gains a `searchTables(connection, query, limit)` method. All three adapters implement it: Postgres runs one `information_schema.tables ILIKE` query; Snowflake uses `INFORMATION_SCHEMA.TABLES` scoped to `connection.database` when set (falls back to `SHOW TABLES IN ACCOUNT`); BigQuery fans out one `INFORMATION_SCHEMA.TABLES` query per dataset with concurrency 5, swallowing per-dataset errors so a single regional or permission failure doesn't abort the whole search.
- **`main/ipc/catalog.ts`**: handler dispatches via `getAdapterForConnection`. Returns `[]` when `query.trim().length < 2` to avoid scanning on a single keystroke.
- **`renderer/store/historyStore.ts`** (new): Zustand store with `entries`, `loaded`, `load()` (idempotent), `reload()`, `clearAll()`. `HistoryPanel.tsx` migrated to use it.
- **`renderer/lib/commandSearch.ts`** (new): pure `CommandItem` + `rankCommands(items, query)` (case-insensitive substring, prefix-match wins, stable sort) + `groupByKind`.
- **`renderer/components/command/CommandPalette.tsx`** (new): hairline 360px input that lives in the title bar between the +Connection button and the theme toggle, centered via two `flex-1` spacers. Exposes a `focus()` handle via `useImperativeHandle` + `forwardRef`. Renders a 480px portal popover below the input with sectioned results (Tables / Saved queries / History / Connections / Actions). Each row has an icon + label + tabular sublabel; active row uses `bg-app-accent-subtle` + 2px terracotta left rail. Backend search is debounced (150 ms) and stale responses are discarded via a generation counter. Keyboard: `↑↓` (wrap-around) / `Enter` / `Esc`; outside-click closes.
- **`renderer/App.tsx`**: eager-loads saved queries + history at boot; installs a window-level `keydown` listener for `⌘K` / `Ctrl+K` that calls `paletteRef.current.focus()`. CodeMirror has no `Mod-K` binding so the window listener wins even when the editor is focused.
- **Per-engine icon colours** in the palette: Tables `cat-green`, Connections `cat-blue`, Saved bookmarks `accent`, History `text-3`, Actions vary.
- **Tests** (29 new): `commandSearch.test.ts` (9 tests covering empty query, substring, prefix scoring, stable sort, groupByKind, no-match, multi-field haystack); `historyStore.test.ts` (5 tests covering load idempotence, reload, clearAll); per-adapter `searchTables` (3 Postgres + 3 Snowflake + 4 BigQuery, including the "skip-dataset-on-error" branch); catalog IPC handler (4 new tests including the short-query and whitespace short-circuits). Updated `adapterRegistry.test.ts` mocks to include `searchTables`.

**Files affected:**
- `src/shared/ipc.ts`, `src/shared/types.ts` — channel + `TableSearchHit` type
- `src/main/ipc/catalog.ts` — handler
- `src/main/db/adapterRegistry.ts` — `searchTables` on DbAdapter
- `src/main/db/postgres.ts`, `snowflake.ts`, `bigquery.ts` — per-adapter `searchTables`
- `src/renderer/src/store/historyStore.ts` — created
- `src/renderer/src/components/history/HistoryPanel.tsx` — migrate to `useHistoryStore`
- `src/renderer/src/lib/commandSearch.ts` — created
- `src/renderer/src/components/command/CommandPalette.tsx` — created
- `src/renderer/src/components/layout/TitleBar.tsx` — slot the palette + thread `paletteRef`
- `src/renderer/src/App.tsx` — eager loads + global ⌘K listener
- `src/__tests__/renderer/lib/commandSearch.test.ts` — created (9 tests)
- `src/__tests__/renderer/store/historyStore.test.ts` — created (5 tests)
- `src/__tests__/main/db/{bigquery,postgres,snowflake}.test.ts` — extended for `searchTables`
- `src/__tests__/main/ipc/catalog.test.ts` — extended for `CATALOG_SEARCH_TABLES`
- `src/__tests__/main/db/adapterRegistry.test.ts` — mocks include `searchTables`
- 202 tests pass, overall coverage 83.6 % (new files at 100 %)

---

### [2026-05-19] Design: Data-surfaces revamp + per-engine accents

**Type:** Change
**Context:** Phase 1 (chrome revamp) brought the new Direction D · Hybrid design system to the title bar, sidebar, catalog tree, and editor tab bar. The remaining data surfaces (`ConnectionModal`, `TableDetailPanel`, `ResultsTable`) were still rendering pre-revamp patterns with raw palette colors (`emerald-400`, `red-950`, `amber-500`, `sky-400`, `violet-400`). Phase 2 was to bring these in line and add per-engine accent hints in the connection breadcrumb.
**Problem / Change:**
- `ConnectionModal`: engine tabs were bottom-bordered icon labels; test-result success/error blocks hardcoded `emerald-950/50` and `red-950/50`; modal header was a single line with no eyebrow.
- `TableDetailPanel`: Schema/Preview tabs were the same bottom-bordered pattern; type-color map referenced raw Tailwind palette; REQUIRED mode badge → `amber-500`; error blocks → `red-950/60`; table headers used ad-hoc `font-medium` instead of small-caps.
- `ResultsTable`: cancelled state used plain grey (semantically wrong — cancellation is an intentional warning state); error block → `red-950/60`; numeric status-bar stats had no tabular numerals (digits drifted between renders); empty state had no header/eyebrow.
- No visual hint that distinguished BigQuery vs Snowflake vs Postgres connections in the breadcrumb beyond text.

**Solution / Outcome:**
- **`ConnectionModal.tsx`**: engine tabs → `.app-segmented` pill with `data-active`; header restructured to use `.app-section-label` eyebrow + bold engine/connection name; field labels now use `.app-section-label`; test-result success → `bg-app-ok-subtle text-app-ok`, failure → `bg-app-err-subtle text-app-err`; inputs gained `focus:ring-app-accent/30`; footer button hover and disabled treatments tightened.
- **`TableDetailPanel.tsx`**: section tabs converted to `.app-segmented inline-flex`; removed the now-unused `SectionTab` sub-component; `typeColor()` mapping swept (`STRING/BYTES` → `cat-green`, numerics → `cat-blue`, booleans → `warn`, time types → `cat-purple`, records → `accent-text`); REQUIRED mode → `app-warn`; error blocks → `app-err-subtle`; schema table headers wrapped in `.app-section-label`; rowCount + executionTimeMs in the preview header use `font-tabular`; tableRef copy button ✓ → `app-ok`.
- **`ResultsTable.tsx`**: running header dot now uses `.app-dot` with accent color; cancelled state surface → `bg-app-warn-subtle/40 text-app-warn` with a warn dot ("intentional state" not "missing state"); error block → `bg-app-err-subtle text-app-err`; empty state gets a small-caps "Empty" eyebrow + helper text; all numeric stats (row count, ms, bytes processed, fetched count, pagination range, page indicator) use `font-tabular`.
- **`TitleBar.tsx`** per-engine accents: introduced `engineAccent(engine)` helper. The engine label in the breadcrumb gets `text-app-cat-blue` for BigQuery, `text-app-accent-text` for Snowflake (the terracotta home color), `text-app-cat-purple` for Postgres. The dropdown row subtitle gets the same color hint on the engine word + `font-tabular` for the identifier suffix.
- Zero hardcoded palette colors remain in `src/renderer/src/components/`, `src/renderer/src/pages/` (verified by `grep -rE "text-(emerald|red|amber|sky|violet)-[0-9]"` returning empty).

**Files affected:**
- `src/renderer/src/components/connections/ConnectionModal.tsx` — segmented engine tabs, semantic ok/err blocks, section-label fields, polish
- `src/renderer/src/components/catalog/TableDetailPanel.tsx` — segmented section tabs, semantic type-color map, REQUIRED → warn, error blocks, header polish
- `src/renderer/src/components/results/ResultsTable.tsx` — semantic cancelled/error/running, tabular numerics, polished empty state
- `src/renderer/src/components/layout/TitleBar.tsx` — per-engine accent on breadcrumb + dropdown rows; `engineAccent()` helper

---

### [2026-05-18] Design: Chrome revamp — Direction D · Hybrid

**Type:** Change
**Context:** Claude Design produced a new design system (`DESIGN.md`) — "Direction D · Hybrid: Linear precision × Atelier warmth" — and committed updated `index.css` + `tailwind.config.ts` with a warm-paper/coffee palette, refined terracotta accent, new semantic tokens (`ok/warn/err`, `cat-blue/purple/green`), and component primitives (`.app-segmented`, `.app-section-label`, `.app-dot`, `.app-kbd`). All previous token names were preserved so components kept rendering — but they still rendered the *old* chrome patterns in new colors. Phase 1 was to adopt the new chrome patterns at the component level.
**Problem / Change:**
- Title bar: still using a boxy bordered button as the connection picker; status dot was a bare circle with no halo.
- Sidebar: tabs were bottom-bordered icon labels; background was `bg-app-surface` instead of the new `bg-app-sidebar`; no inline counts.
- Catalog: open dataset had no visual emphasis; active table row had no highlight; table icons were `text-emerald-500`; section header used ad-hoc `tracking-widest`.
- Editor tabs: active tab was a soft `bg-app-elevated` rectangle; no pill shadow; saved queries got no bookmark prefix.
- QueryEditor: kbd chip had inline mono styling; Cancel used hardcoded `bg-red-700`.

**Solution / Outcome:**
- **`TitleBar.tsx`**: connection picker → breadcrumb (`engine / connection.name` + halo `.app-dot`); +Connection collapsed to a compact icon-only square; bar height 46px; small-caps `tracking-caps` brand wordmark; `StatusDot` rewritten to use `.app-dot--ok / --err`; delete-action error colors swept to `app-err/-subtle`.
- **`Sidebar.tsx`**: rewritten with `.app-segmented` pill tabs showing inline counts (`Catalog n / Saved n / History`); background `bg-app-sidebar`; width bumped to 264px (DESIGN.md spec); counts pulled from `useCatalogStore` (dataset count for the active connection) and `useSavedQueryStore`.
- **`CatalogTree.tsx`**: header uses `.app-section-label`; expanded dataset gets `bg-app-accent-subtle/40`; active table row (matched against `useQueryStore` active table-tab `tableRef`) gets `bg-app-accent-sub-2 border-l-2 border-app-accent`; table icon → `text-app-cat-green`, views/MV → `text-app-cat-purple`; clipboard ✓ → `text-app-ok`.
- **`Editor.tsx` tab bar**: pill-style active tab with `shadow-app-pill` + `bg-app-surface`; tab bar height 40px on `bg-app-bg`; saved-query tabs prefixed with `Bookmark` icon in terracotta; running pulse uses `.app-dot`; +Tab button gets a hover background.
- **`QueryEditor.tsx`**: SQL label → `.app-section-label`; Cancel button → `bg-app-err`; `⌘↵` kbd chip → `.app-kbd` with accent-tinted overrides.
- **Semantic sweep**: `text-red-400` / `bg-red-500/10` in `SavedQueriesPanel.tsx` and `HistoryPanel.tsx` → `app-err` + `app-err-subtle/40`; HistoryPanel section header → `.app-section-label`.
- DESIGN.md explicitly lists *out of scope* for Phase 1: connection modal restyle, `TableDetailPanel` restyle, empty/running/cancelled/error states, ⌘K command palette, per-engine accents. Left untouched.

**Files affected:**
- `DESIGN.md` — new, committed
- `tailwind.config.ts`, `src/renderer/src/index.css` — new token system + component primitives (committed with this PR; produced by Claude Design earlier)
- `src/renderer/src/components/layout/TitleBar.tsx` — breadcrumb, halo dots, semantic colors
- `src/renderer/src/components/layout/Sidebar.tsx` — segmented pill tabs, sidebar background
- `src/renderer/src/components/catalog/CatalogTree.tsx` — section label, active row, cat-* icon colors
- `src/renderer/src/pages/Editor.tsx` — pill tab bar, bookmark icon for saved-query tabs
- `src/renderer/src/components/editor/QueryEditor.tsx` — section label, `.app-kbd`, semantic err
- `src/renderer/src/components/saved/SavedQueriesPanel.tsx` — semantic err colors
- `src/renderer/src/components/history/HistoryPanel.tsx` — section label, semantic err colors

---

### [2026-05-17] Feature: Split panes + schema-aware query builder

**Type:** Change
**Context:** Users needed to compare two result sets side-by-side without switching tabs, and wanted a faster way to start querying a table from the catalog without typing SQL. A visual filter/sort bar was also requested for exploring results without writing WHERE/ORDER BY clauses.
**Problem / Change:**
- No way to run two independent queries in the same tab at once.
- Opening a `SELECT *` from the catalog required manually typing the SQL with the correct engine-specific quoting.
- Results could only be filtered/sorted by modifying the SQL and re-running; no in-place exploration.

**Solution / Outcome:**
- **Split panes**: A "Split" / "Unsplit" button (Columns2 icon) in the `QueryEditor` toolbar activates a right pane. Each pane has its own SQL, result, run/cancel state, and logs. The right pane uses `tabId: "${tabId}-right"` so `QUERY_LOG` events route correctly. A draggable horizontal divider (20–80%) sits between the two panes; the existing vertical editor/results divider controls both pane heights in sync. `toggleSplit`, `updateRightPaneSql`, `runRightPane`, `cancelRightPane` added to `queryStore`. The `QueryPane` interface added to `types.ts` and `rightPane?: QueryPane` on `QueryTab`.
- **"Query table"**: `buildSelectQuery(engine, projectId, datasetId, tableId)` utility created in `src/renderer/src/lib/buildSelectQuery.ts`. `CatalogTree.tsx` `TableRow` dropdown gained a "Query table" item (Play icon) that calls `openTab({ sql, connectionId })`. `TableDetailPanel.tsx` preview SQL now uses `buildSelectQuery` instead of inline quoting logic.
- **Filter/sort bar**: A "Filter" toggle button (SlidersHorizontal icon, with active-count badge) in the `ResultsTable` status bar shows/hides a per-column input row. `filterSortRows` pure helper in `src/renderer/src/lib/filterSortRows.ts` applies case-insensitive substring filters (ANDed) and ascending/descending sort (NULLs last). Column headers gained a sort toggle (asc → desc → off with a ChevronUp/Down indicator). Filters and sort reset when a new result set arrives.

**Files affected:**
- `src/shared/types.ts` — added `QueryPane` interface; added `rightPane?: QueryPane` to `QueryTab`
- `src/renderer/src/store/queryStore.ts` — added `toggleSplit`, `updateRightPaneSql`, `runRightPane`, `cancelRightPane`; updated `QUERY_LOG` handler to route `-right` suffix
- `src/renderer/src/pages/Editor.tsx` — split layout, `splitHPct` state, `handleHDividerMouseDown`
- `src/renderer/src/components/editor/QueryEditor.tsx` — `onSplit`/`isSplit` props, Split/Unsplit button (Columns2 icon)
- `src/renderer/src/components/results/ResultsTable.tsx` — filter/sort state, Sliders button, `filterSortRows` integration, column sort on header click
- `src/renderer/src/lib/buildSelectQuery.ts` — created
- `src/renderer/src/lib/filterSortRows.ts` — created
- `src/renderer/src/components/catalog/CatalogTree.tsx` — "Query table" menu item using `buildSelectQuery`
- `src/renderer/src/components/catalog/TableDetailPanel.tsx` — uses `buildSelectQuery`; removed inline `quoteIdent`
- `src/__tests__/renderer/lib/buildSelectQuery.test.ts` — created (8 tests)
- `src/__tests__/renderer/lib/filterSortRows.test.ts` — created (12 tests)
- `src/__tests__/renderer/store/queryStore.test.ts` — added split pane describe block (13 new tests)
- `CHANGELOG.md` — Unreleased section added

### [2026-04-17] Feature: UX improvements — unified connection modal, edit, delete confirmation, health badge, column search

**Type:** Change
**Context:** The connection manager required two clicks to add a connection (chooser → engine modal), offered no way to edit saved connections without deleting and re-adding them, deleted connections without confirmation, gave no visual indication of whether a connection was healthy, and had no way to search columns in a wide schema.
**Problem / Change:**
- "Add Connection" opened a `ConnectionTypeChooserModal` → then one of three separate engine modals — two modals, two clicks.
- No edit flow: changing a project ID required delete + re-add.
- Trash icon deleted immediately — no undo.
- No health feedback: you had to run a query to know if a connection still worked.
- Schema tab showed all columns in a flat list with no way to filter by name.

**Solution / Outcome:**
- **`src/renderer/src/components/connections/ConnectionModal.tsx`** (rewrite): Unified single modal with a BigQuery / Snowflake / Postgres tab bar at the top. Accepts optional `initialConnection?: Connection`; when provided, the modal is pre-filled and tabs are locked to the connection's engine (edit mode). In edit mode, "Save" calls `update()`; "Test & Save" calls `update()` then `test()`. In add mode behaviour is unchanged.
- **`src/renderer/src/App.tsx`** (simplify): `connectionModal` state collapses from `null | 'chooser' | 'bigquery' | 'postgres' | 'snowflake'` to `null | { mode: 'add' } | { mode: 'edit'; connection: Connection }`. A single `<ConnectionModal>` is rendered for both modes. `onEditConnection` prop added to `TitleBar`.
- **`src/renderer/src/components/layout/TitleBar.tsx`** (update): Added `Pencil` icon button per dropdown row that calls `onEditConnection(conn)`. Trash now triggers an inline "Delete? No / Yes" prompt with a 3-second auto-dismiss (using `confirmTimeoutRef`). `statuses` from the store drive a `StatusDot` component (grey/green/red) shown in the button and in each dropdown row.
- **`src/renderer/src/store/connectionStore.ts`** (update): Added `statuses: Record<string, 'unknown' | 'ok' | 'error'>` field and exported `ConnectionStatus` type. `load()` kicks off background `CONNECTIONS_TEST` calls for every loaded connection (wrapped in `Promise.resolve()` so test stubs that return `undefined` don't crash). `test()` is now `async` and updates `statuses` on every call. `update()` resets the status to `'unknown'` so the badge reflects the new credentials. `remove()` deletes the entry from `statuses`.
- **`src/renderer/src/components/catalog/TableDetailPanel.tsx`** (update): `SchemaSection` gained a `filter` state and a search bar (Search icon + clear button). `flattenFields(schema)` is filtered by `.field.name.toLowerCase().includes(query)` when a query is active. A `n / total` counter appears next to the clear button. Non-matching rows produce a "No columns match" empty-state row.
- **`src/renderer/src/components/connections/PostgresConnectionModal.tsx`** — deleted (absorbed into unified modal).
- **`src/renderer/src/components/connections/SnowflakeConnectionModal.tsx`** — deleted (absorbed into unified modal).

**Files affected:**
- `src/renderer/src/components/connections/ConnectionModal.tsx` — unified rewrite
- `src/renderer/src/App.tsx` — simplified modal state + `onEditConnection` wiring
- `src/renderer/src/components/layout/TitleBar.tsx` — edit button, delete confirmation, health dots
- `src/renderer/src/store/connectionStore.ts` — `statuses`, background health checks, `ConnectionStatus` export
- `src/renderer/src/components/catalog/TableDetailPanel.tsx` — column search in `SchemaSection`
- `src/renderer/src/components/connections/PostgresConnectionModal.tsx` — deleted
- `src/renderer/src/components/connections/SnowflakeConnectionModal.tsx` — deleted

### [2026-04-15] Feature: Snowflake database connector

**Type:** Change
**Context:** The app supported BigQuery and Postgres. Snowflake was not wired up. The spec required a fully functional adapter mirroring the BigQuery pattern, including live query logging, cancellation, server-side pagination, and a redesigned connection modal that supports all three engines.
**Problem / Change:**
- No `SnowflakeConnection` type existed in shared types.
- No Snowflake adapter existed; the adapter registry only handled `bigquery` and `postgres`.
- `ConnectionModal` was BigQuery-only with no engine selector.
- `getAdapterForConnection` had a hardcoded ternary instead of using the registry.

**Solution / Outcome:**
- **`src/shared/types.ts`**: Added `SnowflakeConnection` interface (account, username, password, warehouse, optional database/schema/role). Added `'snowflake'` to `ConnectionEngine` union. Added `SnowflakeConnection` to `Connection` and `ConnectionCreate` unions.
- **`src/main/db/snowflake.ts`** (new): Full adapter implementing `testConnection`, `listDatasets` (`SHOW SCHEMAS IN ACCOUNT` or scoped to `connection.database`; IDs = `DATABASE.SCHEMA`), `listTables` (`SHOW TABLES + SHOW VIEWS IN SCHEMA`), `getTableSchema` (`DESCRIBE TABLE`), `runQuery` (with `streamResult: true`, heartbeat, 180s timeout, statement stored for cancellation and pagination), `getQueryPage` (uses `stmt.streamRows({ start, end })` with numeric offset page tokens), `cancelRunningQuery` (`stmt.cancel()`), `dryRunQuery` (`EXPLAIN`), `invalidateClient` (`conn.destroy()`). Uppercase/lowercase Snowflake column names normalized via `pick()` helper. `Date` and `BigInt` values serialized for IPC.
- **`src/main/db/adapterRegistry.ts`**: Imported all Snowflake functions, registered `snowflakeAdapter`, updated `registry` to include `snowflake`, changed `getAdapterForConnection` to use `registry[connection.engine]` (engine-agnostic lookup).
- **`src/renderer/src/components/connections/ConnectionModal.tsx`**: Refactored from a BigQuery-only form to a multi-engine modal. Added an engine selector row (BigQuery / Snowflake / PostgreSQL). Each engine renders its own sub-form component (`BigQueryForm`, `SnowflakeForm`, `PostgresForm`). Validation and payload construction are engine-specific. Switching engine resets field state.
- **`package.json`**: Added `snowflake-sdk` as a production dependency.

**Files affected:**
- `src/shared/types.ts` — `SnowflakeConnection`, `ConnectionEngine`, `Connection`, `ConnectionCreate`
- `src/main/db/snowflake.ts` — created
- `src/main/db/adapterRegistry.ts` — Snowflake imports, registration, registry lookup fix
- `src/renderer/src/components/connections/ConnectionModal.tsx` — multi-engine refactor
- `package.json` — added `snowflake-sdk`

### [2026-04-06] Decision: MIT open-source license

**Type:** Decision
**Context:** The repository had no `LICENSE` file or SPDX license in `package.json`, so the project was not clearly classified as open source for GitHub, npm, or downstream packagers.
**Problem / Change:** Add standard permissive licensing and wire it into package metadata and the macOS app copyright string.
**Solution / Outcome:**
- **`LICENSE`**: MIT License text (OSI-approved, SPDX identifier `MIT`).
- **`package.json`**: `"license": "MIT"`.
- **`electron-builder.yml`**: `copyright` set so packaged `.app` / DMG metadata matches.

**Files affected:**
- `LICENSE` — created
- `package.json` — added `license`
- `electron-builder.yml` — `copyright`

### [2026-03-17] Error: macOS dock shows Electron icon and "Electron" name in dev mode

**Type:** Error
**Context:** Running `just dev` after adding the custom aperture icon. The dock still showed the default Electron rocket icon and the app name still read "Electron" despite `app.dock.setIcon()` and `app.setName()` being called in `src/main/index.ts`.
**Problem / Change:**
`app.dock.setIcon()` sets the icon at runtime, but macOS reads the initial dock icon and app name from the `.app` bundle being launched. In dev mode, the bundle is `node_modules/electron/dist/Electron.app`, which has `electron.icns` and `CFBundleName = Electron` baked into its `Info.plist`. The runtime calls were too late — the dock had already registered the app with the Electron identity.
**Solution / Outcome:**
- **`scripts/patch-electron-dev.js`** (new): copies `resources/icon.icns` over `Electron.app/Contents/Resources/electron.icns` and patches `CFBundleName` + `CFBundleDisplayName` in `Info.plist` to `Aperture`. Safe to run multiple times (idempotent).
- **`package.json`**: added `"predev": "node scripts/patch-electron-dev.js"` hook so the patch runs automatically before every `just dev`.
- **`scripts/postinstall.js`**: calls `patch-electron-dev.js` at the end so the patch survives `npm install` (which reinstalls Electron and resets the bundle).

**Files affected:**
- `scripts/patch-electron-dev.js` — created
- `package.json` — added `predev` script

---

### [2026-03-17] Feature: Custom app icon for macOS dock and app bundle

**Type:** Change
**Context:** The app was shipping with the default Electron icon everywhere — dock, Finder, DMG, ⌘Tab switcher.
**Problem / Change:**
The project already had `resources/icon.svg` (camera aperture logo) used only as a React component inside the renderer. No native icon assets existed for the Electron bundle or the macOS system.
**Solution / Outcome:**
- **`resources/icon.icns`** (new): full macOS icon set (16 × 16 through 1024 × 1024 @2x) generated from `icon.svg` using `qlmanage` (SVG → 1024px PNG) then `sips` (resize to all required sizes) then `iconutil -c icns`. This is the format macOS natively uses for app icons.
- **`resources/icon.png`** (new): 512 × 512 PNG used as the BrowserWindow `icon` property and as a fallback on non-macOS platforms.
- **`electron-builder.yml`**: added `mac.icon: resources/icon.icns` so the packaged `.app` and DMG use the custom icon.
- **`src/main/index.ts`**: `BrowserWindow` `icon` set to `.icns` on darwin / `.png` elsewhere; `app.dock.setIcon()` called in dev mode with the `.icns` file; `app.setName('Aperture')` called at module load (before `app.whenReady`) so the name is correct in the menu bar, ⌘Tab, and About dialog.

**Files affected:**
- `resources/icon.icns` — created
- `resources/icon.png` — created
- `electron-builder.yml` — added `mac.icon`
- `src/main/index.ts` — `app.setName`, `BrowserWindow icon`, `app.dock.setIcon`

---

### [2026-03-17] Feature: Server-side pagination for BigQuery query results

**Type:** Change
**Context:** Queries without a LIMIT clause fetched all rows at once using `autoPaginate: true`, causing multi-minute hangs for large tables (the user observed a query running for 2+ minutes with no data arriving).
**Problem / Change:**
`job.getQueryResults({ autoPaginate: true })` blocks until BigQuery streams every row. For tables with millions of rows this is impractical. The UI already had client-side pagination (slicing a fully-fetched array) but that was meaningless — all the data still had to arrive first.
**Solution / Outcome:**
- **`src/main/db/bigquery.ts`**: replaced `autoPaginate: true` with `autoPaginate: false, maxResults: 100` on the first call. Introduced a `completedJobs` map (keyed by `tabId`) to retain `Job` references after execution. New `getQueryPage(tabId, pageToken)` function fetches the next 100 rows from an already-completed job using BigQuery's native `pageToken`.
- **`src/shared/types.ts`**: `QueryResult` gained `totalRows?: number`, `pageToken?: string | null`, `hasMore?: boolean`.
- **`src/shared/ipc.ts`**: new `QUERY_GET_PAGE` channel (`{ tabId, pageToken }` → `QueryResult`).
- **`src/main/ipc/query.ts`**: registered `QUERY_GET_PAGE` handler calling `getQueryPage`.
- **`src/renderer/src/store/queryStore.ts`**: new `fetchPage(id)` action — invokes `QUERY_GET_PAGE`, appends returned rows to the existing result, and updates `pageToken` / `hasMore`.
- **`src/renderer/src/components/results/ResultsTable.tsx`**: Next button triggers `onFetchPage()` when on the last locally-fetched page and `hasMore` is true; shows a spinner while loading; page counter displays `+` suffix when more server pages exist; status bar shows server total row count when available.
- **`src/renderer/src/pages/Editor.tsx`**: passes `onFetchPage={() => fetchPage(activeTab.id)}` to `ResultsTable`.

**Files affected:**
- `src/main/db/bigquery.ts` — paginated fetch, `getQueryPage`, `completedJobs` map
- `src/main/ipc/query.ts` — `QUERY_GET_PAGE` handler
- `src/shared/ipc.ts` — `QUERY_GET_PAGE` channel + IpcMap entry
- `src/shared/types.ts` — `QueryResult` pagination fields
- `src/renderer/src/store/queryStore.ts` — `fetchPage` action
- `src/renderer/src/components/results/ResultsTable.tsx` — server-side pagination UI
- `src/renderer/src/pages/Editor.tsx` — `onFetchPage` prop

---

### [2026-03-12] Error: "Aperture is damaged" — app blocked by macOS Gatekeeper on user machines

**Type:** Error
**Context:** A user downloaded the DMG from a GitHub Release and got "Aperture is damaged and can't be opened." on macOS 13+ (Ventura/Sonoma).
**Problem / Change:**
macOS Gatekeeper requires apps distributed outside the App Store to be both (a) **code-signed** with a Developer ID Application certificate and (b) **notarized** (submitted to Apple's scan service). The release workflow handled signing conditionally but had no notarization step. On macOS 13+, notarization is effectively mandatory — even a signed but un-notarized app triggers the "damaged" error when downloaded via a browser (the OS applies a quarantine extended attribute automatically). Additionally, `hardenedRuntime` and entitlements were missing from `electron-builder.yml`; hardened runtime is a prerequisite for notarization, and the three entitlements (`allow-jit`, `allow-unsigned-executable-memory`, `disable-library-validation`) are required for Electron's V8 JIT and for loading unsigned native modules.
**Solution / Outcome:**
- **`scripts/notarize.js`** (new): electron-builder `afterSign` hook. Uses `@electron/notarize` to submit the signed `.app` to Apple via `xcrun notarytool`. Skips silently if `APPLE_ID` / `APPLE_APP_SPECIFIC_PASSWORD` / `APPLE_TEAM_ID` are not set, so unsigned local builds keep working.
- **`resources/entitlements.mac.plist`** (new): three entitlements required for Electron + notarization.
- **`electron-builder.yml`**: added `hardenedRuntime: true`, `entitlements`, `entitlementsInherit`, and `afterSign: scripts/notarize.js`.
- **`.github/workflows/release.yml`**: tightened signing section to document all five secrets with clearer comments and inline log messages.
- **`package.json`**: added `@electron/notarize` devDependency.
- **Immediate workaround for affected users**: `xattr -cr /Applications/Aperture.app` in Terminal removes the quarantine flag.

**Files affected:**
- `scripts/notarize.js` — created
- `resources/entitlements.mac.plist` — created
- `electron-builder.yml` — hardenedRuntime, entitlements, afterSign
- `.github/workflows/release.yml` — notarization env vars, improved comments
- `package.json` — added `@electron/notarize`

### [2026-03-10] Feature: Search bar, design token theme system, and camera aperture logo

**Type:** Change
**Context:** The app used hardcoded Tailwind `gray-*` and `indigo-*` classes scattered across all components. There was no quick way to filter tables in the sidebar, no changelog to track releases, and no distinctive logo.
**Problem / Change:**
- No search in the sidebar — finding a table in a large project required manually expanding every dataset.
- All colour values were hardcoded Tailwind palette classes. Switching themes required touching every component.
- The app used the generic Electron/database icon. No branding.
- No `CHANGELOG.md` to record notable changes per version.

**Solution / Outcome:**
- **CHANGELOG.md**: Created following Keep a Changelog + Semantic Versioning conventions. Documents all versions from 0.1.0 through the current Unreleased entry.
- **Camera aperture logo**: `resources/icon.svg` — 6 blade shapes rotated 60° apart, dark background disc, orange gradient fill, dark centre circle. `src/renderer/src/components/ApertureIcon.tsx` — React component wrapping the SVG with `size` and `className` props, blades rendered via `.map()` over `[0, 60, 120, 180, 240, 300]`.
- **Design token system**: Replaced all hardcoded palette classes with semantic CSS custom property tokens. `tailwind.config.ts` defines `app-bg`, `app-surface`, `app-elevated`, `app-border`, `app-text`, `app-text-2`, `app-text-3`, `app-accent`, `app-accent-hover`, `app-accent-subtle`, `app-accent-text` — all as `rgb(var(--c-*) / <alpha-value>)` so Tailwind opacity modifiers (`/60`, `/80`) work correctly. `index.css` defines the actual RGB triplet values for `:root` (light: warm off-white + orange-500 accent) and `.dark` (near-black + orange-500 accent). `html` defaults to `.dark`; overridden via `localStorage`.
- **Theme toggle**: `App.tsx` reads `localStorage('theme')` on mount, manages `isDark` state, and toggles the `.dark` class on `document.documentElement`. `TitleBar.tsx` renders a `Sun`/`Moon` icon button that calls `onToggleTheme`. Choice persists across restarts.
- **Sidebar search bar**: `CatalogTree.tsx` now has a search input at the top with a `Search` icon and an `X` clear button. Filters datasets whose name matches OR that have at least one table whose name matches. When a query is active, matching datasets auto-expand and only matching tables are shown. When the query is cleared, expansion state reverts to whatever the user had open.
- All 10 renderer component files updated to use `app-*` token classes exclusively — no more `gray-*` or `indigo-*`.

**Files affected:**
- `CHANGELOG.md` — created
- `resources/icon.svg` — created (camera aperture SVG)
- `src/renderer/src/components/ApertureIcon.tsx` — created
- `tailwind.config.ts` — replaced hardcoded colour palette with CSS variable tokens
- `src/renderer/src/index.css` — added `:root` and `.dark` CSS custom property blocks; removed legacy `surface-*` palette
- `src/renderer/src/App.tsx` — theme toggle state + localStorage persistence
- `src/renderer/src/components/layout/TitleBar.tsx` — aperture logo, Sun/Moon toggle button
- `src/renderer/src/components/layout/Sidebar.tsx` — `app-*` token classes
- `src/renderer/src/components/catalog/CatalogTree.tsx` — search bar + filter logic + `app-*` token classes
- `src/renderer/src/pages/Editor.tsx` — `app-*` token classes
- `src/renderer/src/components/editor/QueryEditor.tsx` — `app-*` token classes
- `src/renderer/src/components/results/ResultsTable.tsx` — `app-*` token classes
- `src/renderer/src/components/connections/ConnectionModal.tsx` — `app-*` token classes
- `src/renderer/src/components/catalog/TableDetailPanel.tsx` — `app-*` token classes

### [2026-03-10] Error: Release workflow fails with "not a file" — CSC_LINK set to empty string

**Type:** Error
**Context:** Running the release workflow by pushing a `v*.*.*` tag. The build completes but electron-builder fails at the code-signing step.
**Problem / Change:** `CSC_LINK: ${{ secrets.MAC_CERTIFICATE }}` in the workflow env block evaluates to an empty string `""` when the secret is not set. electron-builder passes this to Node's path resolution, which resolves `""` to the current working directory (`/Users/runner/work/aperture/aperture`). That is a directory, not a `.p12` file, causing the error `⨯ not a file`.
**Solution / Outcome:** Replaced the static `env:` block with a shell script that checks whether `MAC_CERTIFICATE_B64` is non-empty. If it is, the cert is decoded to `/tmp/cert.p12` and `CSC_LINK` is exported pointing to that file. If it is absent, `CSC_IDENTITY_AUTO_DISCOVERY=false` is exported to tell electron-builder to skip signing entirely. This produces an unsigned DMG when no cert is configured and a signed DMG when it is.
**Files affected:**
- `.github/workflows/release.yml` — replaced static env signing block with conditional shell script; added `--publish never` to prevent electron-builder from conflicting with the dedicated release job

### [2026-03-10] Error: CI not triggering on PR — postinstall electron-rebuild fails on ubuntu-latest

**Type:** Error
**Context:** CI workflow was configured with the correct `pull_request` trigger, but jobs never ran when a PR was opened against `main`.
**Problem / Change:** `npm ci` runs the `postinstall` hook, which calls `electron-rebuild -f -w duckdb`. On `ubuntu-latest`, `electron-rebuild` attempts to download or compile a DuckDB binary for Electron's ABI. This either fails outright (missing headers/timeout) or consumes the entire job budget before `tsc` or Vitest can run. CI only needs `tsc` + Vitest — it never launches Electron, so the system-Node ABI DuckDB binary (installed by npm by default) is sufficient.
**Solution / Outcome:** Changed `npm ci` → `npm ci --ignore-scripts` in `.github/workflows/ci.yml`. This skips the `postinstall` electron-rebuild step entirely. npm still installs the system-Node ABI DuckDB binary, which is all Vitest needs. `electron-rebuild` continues to run locally via `just install` / `just rebuild`.
**Files affected:**
- `.github/workflows/ci.yml` — added `--ignore-scripts` flag to the install step

### [2026-03-10] Error: TypeScript errors exposed after tsconfig.node.json fix + test failures

**Type:** Error
**Context:** Running `just typecheck` and `just test` after the initial project setup revealed both compiler errors and failing tests.
**Problem / Change:**
- `tsconfig.node.json` had `"module": "CommonJS"` which is incompatible with `"moduleResolution": "bundler"` (TS5095), and `"paths"` without `"baseUrl"` (TS5090). These masked further type errors.
- Once `tsconfig.node.json` was fixed, pre-existing errors surfaced: `QUERY_LOG` (push-only) being used where `keyof IpcMap` was required; `RunningJob.job` typed via an unsafe generic conditional that resolved to `never`; `IGetQueryResultsResponse` not exposing `statistics`; `client.query()` returning a 2-tuple (no 3rd element for dryRun stats).
- Two test failures: cancel-suppression test set `cancelled: true` before `runQuery` reset it; bigquery timeout test attached the `rejects` handler after `advanceTimersByTimeAsync`, leaking an unhandled rejection.

**Solution / Outcome:**
- `tsconfig.node.json`: `"module": "ESNext"`, added `"baseUrl": "."`
- `src/shared/ipc.ts` / `api.ts`: narrowed generic constraints from `C extends Channel` to `C extends keyof IpcMap` — `invoke` is only valid for req/res channels
- `src/main/db/bigquery.ts`: imported `Job` directly; read `bytesProcessed` from `job.metadata.statistics` (not the response payload); rewrote `dryRunQuery` to use `createQueryJob({ dryRun: true })` instead of `client.query()`
- `queryStore.test.ts`: cancel-suppression test now sets `cancelled: true` inside the mock implementation (after `runQuery` resets it at start), correctly simulating a mid-flight cancel
- `bigquery.test.ts`: timeout test attaches `expect(...).rejects` before advancing fake timers; `runQuery` success test puts stats on `mockJob.metadata`; `dryRunQuery` tests mock `createQueryJob` instead of `client.query`; `mockJob` gained a `metadata` field reset in `beforeEach`

**Files affected:**
- `tsconfig.node.json` — `module`, `baseUrl`
- `src/shared/ipc.ts` — `IpcRequest`/`IpcResponse` generic constraint
- `src/shared/api.ts` — `ElectronAPI.invoke` generic constraint
- `src/main/db/bigquery.ts` — `Job` import, `RunningJob`, stats reading, `dryRunQuery`
- `src/__tests__/main/db/bigquery.test.ts` — `mockJob.metadata`, test mocks updated
- `src/__tests__/renderer/store/queryStore.test.ts` — cancel-suppression test fixed

### [2026-03-10] Error: DuckDB native module ABI mismatch in dev mode

**Type:** Error
**Context:** Running `just dev` after initial `npm install`. The app opened but crashed immediately with "Cannot find module …/duckdb.node".
**Problem / Change:** DuckDB distributes a pre-built `.node` binary keyed to the system Node.js ABI. Electron bundles its own Node.js runtime with a different ABI version, so the binary downloaded by `npm install` can't be loaded. The packaged build was unaffected because `electron-builder` runs `@electron/rebuild` (with `buildFromSource=false`) automatically before packaging, downloading the Electron-compatible binary.
**Solution / Outcome:**
- Added `@electron/rebuild@^4.0.3` as a devDependency — this is the tool that downloads/compiles native modules for a specific Electron ABI.
- Added `"rebuild": "electron-rebuild -f -w duckdb"` npm script — rebuilds only the DuckDB module, skipping everything else.
- Added `"postinstall": "npm run rebuild"` — runs automatically after every `npm install` / `npm ci`, so new contributors never hit this error.
- Added `rebuild` recipe to the justfile — useful to run manually after an Electron version upgrade.
- First rebuild (~2 min) downloads the DuckDB binary compiled for the current Electron ABI and caches it. Subsequent installs are fast if the binary is already cached.

**Files affected:**
- `package.json` — added `@electron/rebuild` devDep, `rebuild` and `postinstall` scripts
- `justfile` — added `rebuild` recipe

### [2026-03-10] Tooling: Fast local DMG build (native arch only)

**Type:** Change
**Context:** `just release` built DMGs for both arm64 and x64, requiring DuckDB to be cross-compiled via Rosetta. On Apple Silicon this added several minutes to every local build.
**Problem / Change:** Local iteration only needs the native arch. The full dual-arch build is only needed in CI for release.
**Solution / Outcome:**
- Added `release-local` recipe: detects the current arch (`uname -m`) and passes `--arm64` or `--x64` to `electron-builder`, skipping cross-compile entirely. Typical time: ~30s vs ~5 min.
- `release` remains the full dual-arch build.
- `release-open` now calls `release-local` so it stays fast during development.

**Files affected:**
- `justfile` — added `release-local`, updated `release-open`, clarified `release` comment
- `README.md` — updated Available Commands table

### [2026-03-10] Testing: Vitest suite with 70 % coverage enforcement

**Type:** Change
**Context:** Project had no automated tests, no coverage tracking, and the CI pipeline ran bare `npm test` with no threshold.
**Problem / Change:**
- No tests meant regressions could land undetected.
- No coverage gate meant untested code could accumulate indefinitely.
- CI ran `vitest run` with no configuration — no coverage, no environment setup.

**Solution / Outcome:**
- **Framework**: Vitest (already installed). Added `@vitest/coverage-v8` (v8 provider, faster than istanbul) and `jsdom` (renderer-side environment) as new devDependencies.
- **`vitest.config.ts`**: Unified config at project root. Key settings:
  - `globals: true` — no need to import `describe`/`it`/`expect` in test files.
  - `clearMocks: true` — call history cleared between tests automatically.
  - `environmentMatchGlobs: [['src/__tests__/renderer/**', 'jsdom']]` — renderer stores get a browser environment; main-process code runs in Node.
  - Coverage includes only `src/main/db/**`, `src/main/ipc/**`, and `src/renderer/src/store/**`; threshold is 70 % on lines, functions, branches, statements.
  - Path aliases `@shared` and `@renderer` mirrored from electron-vite config.
- **`src/__tests__/setup.ts`**: Global setup file. Stubs `window.api` (`invoke`, `on`, `off` as `vi.fn()`) in jsdom tests so renderer stores can be imported without Electron's contextBridge.
- **Test files (11 total, AAA pattern throughout)**:
  - `main/db/store.test.ts` — 5 tests: defaults, persist, disk reload, corrupt JSON, independent keys. Uses `vi.resetModules()` + dynamic imports + real temp directories.
  - `main/db/duckdb.test.ts` — 5 tests: simple SELECT, multiple rows, empty result, invalid SQL rejects, closeDB idempotent. Real DuckDB native module — no mocking.
  - `main/db/bigquery.test.ts` — 14 tests: testConnection (ok/error), listDatasets, listTables (type mapping), getTableSchema (flat + nested RECORD), runQuery (success/logs/empty/error/timeout via `vi.useFakeTimers()`), cancelRunningQuery (no-op + active job), dryRunQuery, invalidateClient.
  - `main/ipc/connections.test.ts` — 6 tests: LIST, ADD (id + timestamp), UPDATE (invalidates cache), DELETE (removes + invalidates), TEST (found / not found).
  - `main/ipc/catalog.test.ts` — 6 tests: DATASETS, TABLES, TABLE_SCHEMA — each with happy path + missing-connection error.
  - `main/ipc/query.test.ts` — 5 tests: EXECUTE (success + unknown connection), CANCEL, DRY_RUN (success + unknown connection).
  - `renderer/store/connectionStore.test.ts` — 8 tests: initial state, load (sets active), load (keeps existing active), add, update, remove (clears active / keeps other active), setActive, test.
  - `renderer/store/catalogStore.test.ts` — 6 tests: initial state, loadDatasets (data + loading flag), loadTables, loadSchema, toggleDataset (expand, collapse, independent).
  - `renderer/store/queryStore.test.ts` — 13 tests: initial state, openTab, openTableTab (new + dedup), closeTab (remove / shift active / null), setActiveTab, updateTabSql, runQuery (success / clears stale / error / cancel-suppresses-error / no-op guards), cancelQuery.
- **CI (`ci.yml`)**: Replaced `npm test` step with `npm run test:coverage` — threshold failure fails the build. Coverage HTML/lcov artifact uploaded (`retention-days: 14`).
- **`justfile`**: Added `coverage` recipe (`npm run test:coverage`), `coverage-open` (opens HTML report in Finder), updated `ci` recipe to run `coverage` instead of bare `test`.

**Files affected:**
- `vitest.config.ts` — created
- `src/__tests__/setup.ts` — created
- `src/__tests__/main/db/store.test.ts` — created
- `src/__tests__/main/db/duckdb.test.ts` — created
- `src/__tests__/main/db/bigquery.test.ts` — created
- `src/__tests__/main/ipc/connections.test.ts` — created
- `src/__tests__/main/ipc/catalog.test.ts` — created
- `src/__tests__/main/ipc/query.test.ts` — created
- `src/__tests__/renderer/store/connectionStore.test.ts` — created
- `src/__tests__/renderer/store/catalogStore.test.ts` — created
- `src/__tests__/renderer/store/queryStore.test.ts` — created
- `package.json` — added `@vitest/coverage-v8`, `jsdom`, `test:coverage` script
- `.github/workflows/ci.yml` — upgraded test step to coverage + artifact upload
- `justfile` — added `coverage`, `coverage-open`; updated `ci` recipe
- `README.md` — added Testing section
- `CLAUDE.md` — this log entry

### [2026-03-10] Tooling: CI/CD pipeline, justfile, and README

**Type:** Change
**Context:** Project had no CI pipeline, no developer task runner, and no user-facing documentation.
**Problem / Change:**
- No automated checks on PRs — type errors or test failures could land on main undetected.
- No standardised way to build a release DMG, bump versions, or create branches.
- No README for end-users or new contributors.

**Solution / Outcome:**
- **`.github/workflows/ci.yml`**: Runs on every push to `main` and every PR. Steps: `npm ci` → `npm run typecheck` → `npm test`. Runs on `ubuntu-latest`; concurrency group cancels stale runs.
- **`.github/workflows/release.yml`**: Triggered by a `v*.*.*` tag push. Builds on `macos-14` (Apple Silicon). `electron-builder` cross-compiles arm64 + x64 in one pass. Uploads both DMGs as artifacts, then publishes a GitHub Release with auto-generated release notes. Code-signing and notarization are optional — enabled when `MAC_CERTIFICATE` / `APPLE_ID` / `APPLE_TEAM_ID` secrets are present; falls back to unsigned DMG otherwise.
- **`justfile`**: Developer task runner (`brew install just`). Key recipes: `dev`, `typecheck`, `test`, `test-watch`, `lint` (alias for typecheck), `ci` (local full suite), `build`, `release`, `release-open`, `version`, `bump [level]`, `tag-release` (commit + tag + push), `branch <name>` (creates from latest main), `pr` (push + open GitHub PR via `gh`), `clean`, `clean-all`, `docker-ci`, `status`.
- **`README.md`**: Covers overall architecture (ASCII diagram + directory layout + key decisions table), authentication (ADC step-by-step + service account step-by-step + required BigQuery IAM permissions), installation (download DMG from Releases + macOS security note), and development (prerequisites, setup, all `just` commands, branching workflow, CI/CD release process).
- **`CLAUDE.md` guidelines**: Added two rules — all changes on branches; README.md must be kept in sync.
- **`CLAUDE.md` commands section**: Replaced raw `npm` commands with `just` equivalents.

**Files affected:**
- `.github/workflows/ci.yml` — created
- `.github/workflows/release.yml` — created
- `justfile` — created
- `README.md` — created
- `CLAUDE.md` — updated (guidelines + commands section + this log entry)

### [2026-03-10] Feature: Table catalog exploration (click-to-inspect + copy reference)

**Type:** Change
**Context:** Tables in the sidebar were display-only with no interaction.
**Problem / Change:** Users needed to click a table and see its schema + data preview, and quickly copy the `dataset.table` reference for use in queries.
**Solution / Outcome:**
- **Table tab type**: Extended `QueryTab` with `type?: 'query' | 'table'` and `tableRef?: { projectId, datasetId, tableId }`. Table inspection opens as a first-class tab in the editor tab bar — multiple table tabs can coexist with query tabs.
- **Deduplication**: `openTableTab` checks if a tab for the same table already exists before creating a new one — clicking the same table just focuses the existing tab.
- **`TableDetailPanel` (new)**: Full-screen panel rendered when the active tab is a table tab.
  - *Schema section* (default): loads via `CATALOG_TABLE_SCHEMA` IPC, renders a sticky-header table with column name, type (colour-coded by category), mode (REQUIRED/REPEATED highlighted), and description. Nested RECORD fields are shown with indentation and `↳` prefix.
  - *Preview section* (lazy): runs `SELECT * FROM \`project.dataset.table\` LIMIT 50` on first open. Uses a generated `previewTabId` so `QUERY_LOG` events are silently ignored (no phantom tab state).
  - Copy button in the header copies `dataset.table` with a transient "Copied" confirmation.
- **CatalogTree `TableRow`**: clicking the table name calls `openTableTab`. A `...` (`MoreHorizontal`) button appears on row hover and opens a small dropdown with "Copy · dataset.table". Click outside closes the menu via `document.addEventListener('mousedown', …)`.
- **Editor tab bar**: table tabs show a green `Table2` icon instead of the running-indicator dot.

**Files affected:**
- `src/shared/types.ts` — `QueryTab`: added `type`, `tableRef`
- `src/renderer/src/store/queryStore.ts` — added `openTableTab` action
- `src/renderer/src/components/catalog/CatalogTree.tsx` — rewrote with `TableRow` sub-component: click-to-open, `...` hover menu, outside-click dismiss
- `src/renderer/src/components/catalog/TableDetailPanel.tsx` — created
- `src/renderer/src/pages/Editor.tsx` — renders `TableDetailPanel` for table tabs, table tab icon

### [2026-03-10] Feature: Query timeout, live logging, and cancel

**Type:** Change
**Context:** Queries were hanging with no feedback and no way to stop them. `client.query()` blocks until completion with no cancel handle.
**Problem / Change:**
- `runQuery` used `client.query()` (high-level, opaque) — no job reference, no cancel, no progress.
- No timeout: a runaway query would block forever.
- No feedback to the user while waiting.
- Cancel IPC handler was a no-op stub.

**Solution / Outcome:**
- Switched to `client.createQueryJob()` → gives a `Job` object that can be cancelled via `job.cancel()`.
- Added `Promise.race` against a 180s timeout — on expiry, calls `job.cancel()` then rejects with a human-readable message.
- Added a 10s heartbeat interval that logs "Still running… Xs elapsed" to the renderer while the job is active.
- Added `QUERY_LOG` as a push-only IPC channel (`webContents.send`). Main process emits log lines at: job created, waiting, heartbeat, done/error/cancel/timeout.
- `runningJobs` map (keyed by `tabId`) stores `{ job, webContents }` — lets the cancel handler reach the exact job and its renderer.
- `QUERY_CANCEL` IPC handler now calls `cancelRunningQuery(tabId)`, which calls `job.cancel()` and sends a final log line before removing the entry.
- Added `tabId` to `QUERY_EXECUTE` request so the main process can key the running job to the correct tab.
- Renderer `queryStore`: added `cancelQuery(id)`, global `window.api.on(QUERY_LOG, …)` listener that routes log lines to the right tab with a wall-clock timestamp.
- `QueryTab` type: added `logs: string[]` and `cancelled?: boolean`.
- `QueryEditor`: Run button flips to a red Cancel button while `isRunning`. `⌘↵` cancels if already running.
- `ResultsTable`: while running, shows a live scrolling log panel instead of a spinner. After cancel, shows "Query cancelled" with the log history. On error, collapses log above the error message.
- Tab bar: shows a pulsing indigo dot on running tabs.

**Files affected:**
- `src/shared/types.ts` — `QueryTab`: added `logs`, `cancelled`
- `src/shared/ipc.ts` — added `QUERY_LOG` channel; `QUERY_EXECUTE.req` gained `tabId`
- `src/main/db/bigquery.ts` — full rewrite of `runQuery`; added `cancelRunningQuery`, `runningJobs` map, `elapsed()`, cleanup logic
- `src/main/ipc/query.ts` — passes `event.sender` + `req.tabId` to `runQuery`; cancel handler now calls `cancelRunningQuery`
- `src/renderer/src/store/queryStore.ts` — added `cancelQuery`, global log listener, `cancelled` state handling
- `src/renderer/src/components/editor/QueryEditor.tsx` — cancel button, updated props
- `src/renderer/src/components/results/ResultsTable.tsx` — live log panel, cancelled state, error+log layout
- `src/renderer/src/pages/Editor.tsx` — wires `onCancel`, passes `cancelled`+`logs` to ResultsTable, tab running indicator

### [2026-03-09] Setup: Initial project scaffolding

**Type:** Change
**Context:** Project created from scratch. No prior code existed.
**Problem / Change:** Needed a full working boilerplate for the Aperture Electron app — build system, IPC layer, BigQuery connectivity, React UI, and Docker configuration.
**Solution / Outcome:** Scaffolded 41 files across the project. Key decisions made:
- Used `electron-vite` (not plain Vite + custom esbuild) as the unified build system — handles main/preload/renderer in one config.
- Replaced `electron-store` (ESM-only in v10, incompatible with CommonJS main process) with a lightweight custom JSON store at `src/main/db/store.ts`.
- BigQuery queries go through `@google-cloud/bigquery` client directly. `duckdb` module is set up in `src/main/db/duckdb.ts` as a local in-memory engine, ready for the community BigQuery extension when it matures.
- Typed IPC map in `src/shared/ipc.ts` + `ElectronAPI` interface in `src/shared/api.ts` — ensures renderer and main process stay in sync at compile time.
- `contextIsolation: true`, `nodeIntegration: false`, `sandbox: false` in BrowserWindow — secure preload-only bridge.
- Docker targets headless CI only (tests + typecheck). macOS `.app` packaging must run on the host via `npm run build:mac`.

**Files affected:** All files listed below (created):
- `package.json`, `electron.vite.config.ts`, `tsconfig.json`, `tsconfig.node.json`, `tsconfig.web.json`
- `tailwind.config.ts`, `postcss.config.js`, `electron-builder.yml`, `.gitignore`, `.env.example`
- `src/shared/types.ts`, `src/shared/ipc.ts`, `src/shared/api.ts`
- `src/main/index.ts`, `src/main/ipc/index.ts`, `src/main/ipc/connections.ts`, `src/main/ipc/catalog.ts`, `src/main/ipc/query.ts`
- `src/main/db/store.ts`, `src/main/db/bigquery.ts`, `src/main/db/duckdb.ts`
- `src/preload/index.ts`
- `src/renderer/index.html`, `src/renderer/src/main.tsx`, `src/renderer/src/App.tsx`, `src/renderer/src/index.css`, `src/renderer/src/env.d.ts`
- `src/renderer/src/components/layout/TitleBar.tsx`, `src/renderer/src/components/layout/Sidebar.tsx`
- `src/renderer/src/components/catalog/CatalogTree.tsx`
- `src/renderer/src/components/editor/QueryEditor.tsx`
- `src/renderer/src/components/results/ResultsTable.tsx`
- `src/renderer/src/components/connections/ConnectionModal.tsx`
- `src/renderer/src/pages/Editor.tsx`
- `src/renderer/src/store/connectionStore.ts`, `src/renderer/src/store/catalogStore.ts`, `src/renderer/src/store/queryStore.ts`
- `docker/Dockerfile`, `docker/docker-compose.yml`, `resources/.gitkeep`
