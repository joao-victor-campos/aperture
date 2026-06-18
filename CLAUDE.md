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
