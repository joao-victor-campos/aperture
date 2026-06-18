# Changelog

All notable changes to Aperture are documented here.
Format follows [Keep a Changelog](https://keepachangelog.com/en/1.1.0/).
Versions follow [Semantic Versioning](https://semver.org/).

---
## [Unreleased]

### Added
- Catalog tree now lists datasets and tables alphabetically (case-insensitive, natural numeric ordering) for all engines. Neo4j Labels and Relationship Types are each sorted within their group.

---
## [2.3.0] - 2026-06-14

### Changed
- **Renderer responsiveness** — editor typing and large result tables are now smooth. The results area (`ResultsRegion`) and editor (`EditorPane`) are split into memoized components that subscribe to narrow store slices, so a keystroke re-renders only the editor and a streaming log tick re-renders only the results. `ResultsTable` is memoized, its filter/sort/page derivation is memoized, and its rows are virtualized via `@tanstack/react-virtual` (only visible rows mount). No behavior changes.
- **Smarter SQL autocomplete** — column suggestions now appear for any table referenced in the query (a background prefetch loads referenced tables' schemas, so you no longer have to open a table first), `alias.` and CTE (`WITH t AS (…)` → `t.`) completions resolve to the right columns, and suggestions auto-open as you type and on `.` with no lag. Completion stays fully local/instant. Cypher completion is unchanged.

---
## [2.2.0] - 2026-06-10

### Added
- **Neo4j support (Phase 1 — Foundation)** — Neo4j is now a first-class fourth engine. Connect over Bolt (`neo4j://` or `neo4j+s://`), browse databases → Labels / Relationship Types, write Cypher with syntax highlighting + schema-aware autocomplete (labels, relationship types, property keys), and view results with compact Cypher-style chips for Node/Relationship/Path values, e.g. `(:Person {name: "Alice", …})`. Reuses the existing auto-limit guard (extended with Cypher read-statement starters: MATCH / OPTIONAL MATCH / CALL / UNWIND / RETURN), explain-plan viewer (Neo4j EXPLAIN plan tree → JSON), export, history, ⌘K, split panes, pagination, and cancel infrastructure. New `cat-teal` per-engine accent.
- **Neo4j Phase 2 — interactive graph view** — graph-shaped results now offer a force-directed canvas with a persistent side inspector. The "View as graph" banner appears automatically when a result contains Node / Relationship / Path values; clicking swaps the results area without re-fetching. Pan / zoom / drag-to-reposition / click-to-select / fit-to-view, plus a legend mapping colors to labels and relationship types. Results past 500 nodes show a "too many to visualize" message instead, suggesting a `LIMIT`.

---
## [2.1.0] - 2026-06-07

### Added
- **Theme import (Base16)** — a new Settings modal (⚙ icon in the title bar, or "Settings" in the ⌘K palette) lets users import community Base16 theme files (JSON or YAML) into a managed theme library. The library shows each theme as a card with a colour-swatch preview; clicking a card applies it instantly. The previous light/dark toggle is removed — each Base16 theme is a complete, self-contained palette, so users get a light look by importing a light theme (e.g. Solarized Light, GitHub Light) and a dark look by importing a dark theme (e.g. Dracula, Nord, Gruvbox). The built-in **Aperture Dark** is always present at the top of the library and is the fallback when no imported theme is active. Imports are validated as proper Base16 (all 16 base00–base0F slots present and parseable as hex); invalid files surface an inline error in the modal. Both uppercase and lowercase slot keys are accepted. The active theme is cached to localStorage and re-applied synchronously at app boot to prevent a flash of the built-in palette.
- **Auto-limit guard** — before executing a `SELECT`/`WITH` query that lacks a top-level `LIMIT` clause, the editor now shows a warning banner offering "Add LIMIT 1000" or "Run anyway." Prevents accidental full-table scans on metered engines like BigQuery. Detection handles subqueries, CTEs, comments, and string literals correctly.
- **Explain plan viewer** — a new "Explain" button (⌘E) in the editor toolbar runs the existing `QUERY_DRY_RUN` IPC and displays the execution plan in a dedicated panel below the editor. BigQuery returns the query-plan stages as formatted JSON; Postgres returns `EXPLAIN (FORMAT JSON)` output; Snowflake returns `EXPLAIN` rows as text. The panel shows bytes-processed for BigQuery and a "Dry run OK" message when no plan is available.
- **Keyboard shortcut cheatsheet** — press `⌘/` anywhere (or select "Keyboard shortcuts" from the ⌘K palette) to open a modal overlay listing all app shortcuts grouped by context: Editor (⌘↵, ⌘E, ⌘S, ⌥⌘F), Navigation (⌘K, ⌘/), and Palette (↑↓, ⏎, Esc).

### Fixed
- **Theme defaults on first boot** — `bootstrapTheme()` previously left the app on the light palette when no theme was cached yet, even though the built-in dark theme was meant to be the default. It now defaults to **Aperture Dark** on first launch. A second built-in, **Aperture Light**, was added alongside it (selectable from Settings) via a new `applyBuiltinLight()` helper and an `__aperture_light__` localStorage sentinel, so users have a built-in light option without needing to import a Base16 theme.

---
## [2.0.0] - 2026-06-06

- **Design revamp — chrome (Direction D · Hybrid)** — adopted the new warm-paper/coffee palette + refined-terracotta accent across the title bar, sidebar, catalog tree, editor tab bar, and SQL editor toolbar. New chrome includes: a `snowflake / prod_warehouse` connection breadcrumb (replacing the boxy picker button), segmented pill tabs in the sidebar with inline counts (`Catalog 42 / Saved 18 / History`), small-caps section labels, halo-glow status dots via `.app-dot`, pill-style active editor tabs with the `app-pill` shadow, saved-query bookmark icon on tabs, and a 2px-terracotta-rail active-table indicator in the catalog. Tables/views in the catalog now use semantic categorical colors (`cat-green` / `cat-purple`). All hardcoded `text-emerald/red/amber` classes in the chrome were swept to the semantic `app-ok/err/warn` and `app-cat-*` tokens. No layout or component-tree changes — restyle only.
- **Design revamp — data surfaces** — extends the design system into the remaining screens: (1) `ConnectionModal` engine selector → segmented pill tabs, error/success blocks → semantic `app-ok/err-subtle`, header restructured with small-caps eyebrow + bold engine name, inputs gain a focus ring; (2) `TableDetailPanel` Schema/Preview tabs → `.app-segmented`, type-color map switched from raw palette (`emerald/sky/amber/violet`) to semantic `cat-green/cat-blue/warn/cat-purple` tokens, REQUIRED mode → `app-warn`, error blocks → `app-err-subtle`, table headers use `.app-section-label`; (3) `ResultsTable` running/cancelled/error states adopt semantic colors (cancelled now uses `app-warn-subtle` instead of plain grey), all numeric stats in the status bar and pagination use `font-tabular`, empty state gains a small-caps "Empty" eyebrow; (4) per-engine accents — the active engine label in the title-bar breadcrumb and the engine subtitle in the connection dropdown are now colored by engine (BigQuery `cat-blue`, Snowflake `accent-text`, Postgres `cat-purple`).

### Added
- **⌘K command palette** — a global hairline input in the title bar that searches **everything**: tables (across all datasets via a new backend search), saved queries, history, connections, and a set of static actions (New query tab, Run query, Cancel query, Toggle theme, Add connection…). Press `⌘K` anywhere in the app to focus it. Empty input shows a "Recent" view (top history entries + most recently updated saved queries + actions). Typing 2+ characters triggers a debounced (150 ms) backend search. Results are sectioned, each row has an icon and a sublabel; `↑↓` navigates with wrap-around, `Enter` opens, `Esc` closes. Selecting a table opens it as a new table tab; a saved query / history entry opens it in a new query tab; a connection switches the active connection.
- **Catalog-wide table search** — new `CATALOG_SEARCH_TABLES` IPC channel and adapter method, so the palette can find a table even if its dataset was never expanded in the sidebar. Postgres uses a single `information_schema.tables` ILIKE query; Snowflake uses `INFORMATION_SCHEMA.TABLES` scoped to the connection's default database (falls back to `SHOW TABLES IN ACCOUNT`); BigQuery fans out one `INFORMATION_SCHEMA.TABLES` query per dataset with a concurrency cap of 5, gracefully skipping any dataset that errors (e.g. permission denied or regional mismatch).
- **History store** — `useHistoryStore` (Zustand) lifts history from `HistoryPanel`-local state to a shared store, eager-loaded at app start. `load()` is idempotent (no double-fetch); `reload()` forces fresh data; `clearAll()` calls `HISTORY_CLEAR`.

---
## [1.6.0] - 2026-06-04

### Added
- **Split panes** — a new "Split" button in the query editor toolbar opens a second independent editor + results panel side-by-side in the same tab. Each pane runs its own SQL, maintains its own result set, run/cancel state, and logs. The vertical divider between panes is draggable (20–80% range). Clicking "Unsplit" closes the right pane.
- **"Query table" in catalog** — right-clicking any table in the catalog sidebar now shows a "Query table" option. Selecting it opens a new query tab pre-filled with a `SELECT * FROM … LIMIT 100` statement using the correct engine-specific quoting (backticks for BigQuery, double-quotes for Postgres/Snowflake).
- **Visual filter/sort bar in results** — a new "Filter" button in the results status bar toggles a compact per-column filter bar. Each column gets a text input for case-insensitive substring filtering; all active filters are ANDed. A badge on the button shows the number of active filters. Clicking a column header sorts by that column (asc → desc → off). A "Clear" button resets all filters and sort. Client-side filtering is tracked separately from the server total.

### Changed
- **`buildSelectQuery` utility** — engine-specific `SELECT *` SQL generation was extracted into `src/renderer/src/lib/buildSelectQuery.ts` and shared between the catalog tree ("Query table") and `TableDetailPanel` preview tab, removing duplicated quoting logic.

---
## [1.5.0] - 2026-05-16

### Added
- **Linux release** — Aperture now ships AppImage (x64 + arm64) and `.deb` (x64) artifacts alongside the macOS DMGs on every GitHub Release. The AppImage is self-contained and runs on any distro without installation; the `.deb` is installable via `dpkg` or `apt` on Debian/Ubuntu.
- **Parallel Linux CI build** — a new `build-linux` job on `ubuntu-latest` runs in parallel with the macOS build job. Both artifact sets are collected by the publish job and uploaded to the same GitHub Release in a single step.
- **`window.platform` in renderer** — `process.platform` is now exposed to the renderer via `contextBridge`, allowing the UI to adapt per operating system without breaking `contextIsolation`.

### Fixed
- **macOS-only window options on Linux** — `titleBarStyle: 'hiddenInset'` and `vibrancy: 'sidebar'` are now applied only on macOS; Linux uses `titleBarStyle: 'hidden'` with no vibrancy, preventing silent Electron misbehaviour on non-macOS platforms.
- **macOS-only menu roles on Linux** — `services`, `hide`, `hideOthers`, and `unhide` menu roles are now filtered out on non-macOS, preventing Electron warnings and empty menu entries on Linux.
- **Title-bar spacer on Linux** — the `w-20` spacer reserved for macOS traffic lights shrinks to `w-4` on Linux and Windows where no traffic lights are present.

---
## [1.4.1] - 2026-05-10

### Fixed
- **Window drag region** — the entire title bar area between the +Connection button and the theme toggle is now draggable. Previously, a `no-drag` wrapper consumed the full flexible spacer, leaving only the Aperture logo as a drag target. `no-drag` is now applied only to individual interactive buttons.
- **SQL formatter keymap** — `handleFormat` was recreated on every render (plain function reference), causing the `keymapExtension` useMemo to rebuild the CodeMirror extension each render. Wrapped in `useCallback` so the extension only rebuilds when `value`, `engine`, or `onChange` actually changes.
- **Memory leaks on unmount** — three separate cleanup gaps fixed: (1) the column-name copy timeout (`copyTimeoutRef`) was never cleared on `ResultsTable` unmount; (2) the `savedFlash` toast timeout in `Editor` was fire-and-forget; (3) in-flight column-resize and divider-drag `window` event listeners were not removed if the component unmounted during a drag.
- **Connection reassignment during query** — switching the active connection while a query was running silently reassigned `connectionId` on the running tab, potentially routing the result to the wrong connection. The update now skips tabs with `isRunning: true`.
- **React key collision across pages** — result table rows were keyed by their page-local row index (`i`), causing React to reuse DOM nodes when navigating between pages. Keys are now `${page}-${i}`.

---
## [1.4.0] - 2026-04-26

### Added
- **Export results** — an Export button in the results status bar lets you save query results as CSV, TSV, or JSON via a native Save dialog. The formatter handles NULL values, embedded commas/quotes in CSV, and preserves BigQuery's wrapped date/numeric values as plain strings.
- **SQL formatter** — a Format button in the query editor toolbar (also bound to ⌥⌘F) reformats the current SQL with consistent indentation, keyword casing (UPPER), and line breaks. Dialect is auto-selected from the active connection (BigQuery, PostgreSQL, or Snowflake). Uses the `sql-formatter` library; invalid SQL is silently left unchanged.
- **Query history** — every successfully completed query is automatically saved to a persistent history (capped at 500, newest first). A new **History** tab in the sidebar shows each entry with a relative timestamp, connection name, row count, and duration. Clicking any entry opens it in a new editor tab. The panel has a trash icon to clear all history.
- **Dialect-aware SQL autocomplete** — the CodeMirror editor now uses the correct SQL dialect for keyword and function completions: `PostgreSQL` dialect for Postgres connections, `StandardSQL` for BigQuery and Snowflake. Keywords are suggested in uppercase. Schema-aware table and column completions (from the loaded catalog) continue to work across all engines.
- **Pinned result tabs** — a Pin button in the results status bar snapshots the current result into a new read-only tab. Pinned tabs show a 📌 icon in the tab bar with a SQL preview as the title, letting you compare before/after results without re-running the query.
- **Copy column name** — clicking any column header in the results table copies the column name to the clipboard. The header briefly shows ✓ Copied as confirmation.

### Fixed
- Export dropdown was being clipped by the panel's `overflow-hidden` container and was unclickable. The dropdown now opens downward (below the button) so it renders inside the visible area.

---
## [1.3.0] - 2026-04-17

### Added
- **Unified connection modal** — "Add Connection" and "Edit Connection" now open a single modal with a BigQuery / Snowflake / Postgres tab bar at the top. The old two-step flow (chooser → engine-specific modal) is gone; one click, one modal.
- **Edit existing connections** — each connection in the title-bar dropdown now has a pencil icon that reopens the modal pre-filled with the current values. Saving calls `CONNECTIONS_UPDATE`; the adapter cache is invalidated so the next query uses the new credentials.
- **Delete confirmation** — the trash icon no longer deletes immediately. Clicking it shows an inline "Delete? No / Yes" prompt that auto-dismisses after 3 seconds, preventing accidental deletions.
- **Connection health badge** — a small colour dot appears next to each connection: grey (untested), green (last test OK), red (last test failed). Tests run in the background on app start (non-blocking) and after every explicit "Test & Save" or save+update.
- **Column search in schema view** — a filter input above the schema table in the table-detail panel lets you search column names in real time. Shows a match counter (`n / total`) and a clear button; non-matching rows are hidden with a "No columns match" empty state.

### Removed
- `PostgresConnectionModal.tsx` and `SnowflakeConnectionModal.tsx` — absorbed into the unified `ConnectionModal`.

---
## [1.2.0] - 2026-04-17

### Removed
- **DuckDB dependency** — DuckDB was included in the original scaffold as a planned query engine but was never wired into any IPC handler or adapter. All query execution already went through the native SDK adapters (`@google-cloud/bigquery`, `pg`, `snowflake-sdk`). Removed the `duckdb` npm package, `@electron/rebuild` devDependency, the three binary-management scripts (`scripts/postinstall.js`, `scripts/pretest.js`, `scripts/posttest.js`), the `rebuild`/`postinstall`/`pretest`/`posttest` npm lifecycle hooks, and the `just rebuild` recipe. `npm install` no longer triggers `electron-rebuild` and tests run without any binary-swapping ceremony.

---
## [1.1.0] - 2026-04-16

### Added
- Snowflake connections — support for listing schemas/tables and fetching table schemas in the catalog browser.
- Snowflake query execution — adapter wiring with live query logs, server-side pagination, and cancel support consistent with the existing engines.
- Snowflake UI integration — a dedicated Snowflake connection modal wired into the app flow.

### Changed
- Adapter registry now dispatches by `connection.engine` (engine-agnostic lookup), and new Snowflake tests were added to cover the adapter wiring.


## [1.0.0] - 2026-03-30

### Added
- **PostgreSQL connections** — save and connect to Postgres alongside BigQuery. New connection flow (`PostgresConnectionModal`) for host, port, database, and credentials. Catalog browsing treats schemas as datasets; table inspection and SQL queries use the same editor and results UI as BigQuery.
- **Postgres query execution** — `pg` driver with connection pooling, 180s timeout, live heartbeat logs, cancel via backend PID, and paginated results (100 rows per page) consistent with BigQuery behavior.

### Changed
- **Multi-engine IPC** — main process uses an adapter registry (`adapterRegistry`) so catalog, query, and connection handlers dispatch to BigQuery or Postgres based on the active connection’s engine. Shared types and tests cover both connection kinds.

---

## [0.8.0] — 2026-03-25

### Added
- **Draggable tabs** — query tabs can be dragged left and right to reorder them. Uses native HTML5 drag-and-drop with no extra dependencies.
- **Resizable columns** — every column header has a drag handle on its right edge; dragging resizes the column. Widths reset when a new query is run. Truncated cell values show a tooltip on hover.
- **Changelog-based GitHub Releases** — new workflow (`.github/workflows/changelog-release.yml`) triggers on any `v*.*.*` tag push, extracts the matching section from `CHANGELOG.md`, and creates the GitHub Release on `ubuntu-latest` only (~1 min, no macOS minutes consumed). Works independently of the DMG build.

### Fixed
- **BigQuery date/datetime display** — `DATE`, `DATETIME`, `TIMESTAMP`, and `NUMERIC` columns were shown as raw JSON (`{"value":"2026-02-01T00:00:00"}`). The cell formatter now extracts the string value directly.
- **⌘↵ inserting a newline** — `onKeyDown` on the CodeMirror wrapper div fired after CodeMirror had already processed the key, so `preventDefault()` did not stop the newline from being inserted. Fixed by registering the keybinding inside CodeMirror via `keymap.of()` + `Prec.highest()`, which intercepts the key before all built-in handlers.
- **Column resize crashing the app** — dragging a column very wide caused WebKit's table layout engine to crash (white screen). Fixed by capping column width at 1200px and capturing the column name in a local variable before the state updater to eliminate a ref-after-cleanup race.
- **DuckDB x86_64 binary on Apple Silicon** — `postinstall.js` was using `process.arch` to choose the download URL, which returns `'x64'` when Node runs under Rosetta. Switched to `uname -m` (native machine architecture) so the correct `arm64` binary is always downloaded.
- **GitHub Release body** — `release.yml` now reads the release body from `CHANGELOG.md` instead of the hardcoded Gatekeeper workaround text.

---

## [0.7.0] — 2026-03-17

### Added
- **Server-side BigQuery pagination** — queries now fetch only the first 100 rows on execution; subsequent pages are loaded on demand via the Next button. No more multi-minute waits for large tables without a LIMIT clause. The pagination bar shows the total row count from BigQuery metadata and a `+` indicator when more pages exist.
- **Custom macOS app icon** — camera aperture logo (`.icns` + `.png`) replaces the default Electron icon in the dock, Finder, DMG, and ⌘Tab switcher. All required sizes (16 × 16 through 1024 × 1024 @2x) generated from the existing SVG.
- **Save queries with folders** — save the current query tab with a name and optional folder, re-save silently with ⌘S, browse and search saved queries in the sidebar Saved panel.
- **SQL autocomplete for BigQuery** — the CodeMirror editor now suggests table names (e.g. `dataset.table`) and column names (populated lazily as schemas are inspected).

### Changed
- App name now shows **Aperture** (not "Electron") in the macOS dock, menu bar, and ⌘Tab switcher in dev mode.
- `QUERY_GET_PAGE` IPC channel added for fetching subsequent result pages without re-running the query.
- `QueryResult` type extended with `totalRows`, `pageToken`, and `hasMore` fields.

### Fixed
- DuckDB Electron binary repeatedly reverting to x86_64 after test runs: `postinstall.js` now saves a pristine arm64 `duckdb-electron.node` immediately after downloading, so `pretest.js` can no longer overwrite it with a corrupt backup.
- macOS dock showing the Electron rocket icon in dev mode: `scripts/patch-electron-dev.js` (run via `predev` hook) replaces `electron.icns` inside the Electron app bundle and patches `Info.plist` before each `just dev`.

---

## [0.3.0] — 2026-03-12

### Fixed
- **"Aperture is damaged" on macOS 13+** — added notarization infrastructure (`scripts/notarize.js`, `resources/entitlements.mac.plist`), `hardenedRuntime: true` in `electron-builder.yml`, and documented the `xattr -cr` immediate workaround in the README and every GitHub Release body.

---

## [0.2.0] — 2026-03-10

### Added
- Search bar in the sidebar catalog tree — filter datasets and tables by name in real time
- Light theme (orange + off-white) and dark theme (orange accent) with a toggle in the title bar
- Camera aperture SVG logo (`resources/icon.svg`) and React component (`ApertureIcon.tsx`)
- `CHANGELOG.md` following Keep a Changelog conventions

### Changed
- Accent colour changed from indigo to orange across the entire UI
- Design token system using CSS custom properties — a single source of truth for all colours in both themes

---

## [0.1.3] — 2026-03-10

### Fixed
- Release workflow: `electron-builder` attempted to auto-publish to GitHub when a tag was pushed, colliding with the dedicated `softprops/action-gh-release` job. Added `--publish never` to the build step.
- Release workflow: `CSC_LINK` set to an empty string when `MAC_CERTIFICATE` secret is absent caused electron-builder to resolve `""` to the project directory and fail with "not a file". Replaced the static env block with a shell script that decodes the cert to `/tmp/cert.p12` when the secret exists, or exports `CSC_IDENTITY_AUTO_DISCOVERY=false` when it is absent.

---

## [0.1.2] — 2026-03-10

### Fixed
- CI (`duckdb.test.ts` failing on GitHub Actions): `npm ci --ignore-scripts` skipped DuckDB's own `install` hook (node-pre-gyp), so the native `.node` binary was never downloaded. Changed `postinstall` to check `process.env.CI` and skip `electron-rebuild` automatically; CI now uses plain `npm ci`.

---

## [0.1.1] — 2026-03-10

### Fixed
- CI not triggering on PRs: `postinstall` ran `electron-rebuild` on `ubuntu-latest`, which failed before `tsc` or Vitest could run. Fixed by making `postinstall` skip when `CI=true`.
- TypeScript strict errors surfaced after fixing `tsconfig.node.json` (`module: CommonJS` incompatible with `moduleResolution: bundler`; missing `baseUrl`).
  - `IpcRequest` / `IpcResponse` / `ElectronAPI.invoke` generic constraints narrowed to `keyof IpcMap` (push-only `QUERY_LOG` channel excluded from `invoke`).
  - `RunningJob.job` typed via `Job` import instead of unsafe conditional generic.
  - `getQueryResults` stats read from `job.metadata` (not the response payload).
  - `dryRunQuery` switched from `client.query()` (2-tuple) to `createQueryJob({ dryRun: true })`.
- Three test fixes: cancel-suppression test, bigquery timeout unhandled rejection, `dryRunQuery` mock updated to `createQueryJob`.

---

## [0.1.0] — 2026-03-10

### Added
- Full project scaffold: Electron + React + TypeScript + Tailwind CSS + DuckDB + BigQuery.
- Typed IPC layer (`src/shared/ipc.ts`) — all renderer↔main communication is type-safe at compile time.
- BigQuery connection manager — save, switch, and test connections (ADC or service account JSON).
- Catalog browser — navigate projects → datasets → tables with lazy loading and refresh.
- Click-to-inspect tables — schema tab (column name / type / mode / description, nested RECORD support) and lazy preview tab (SELECT * LIMIT 50).
- `...` hover menu on each table row to copy `dataset_id.table_id` reference.
- Query editor (CodeMirror, SQL syntax highlighting, `⌘↵` to run).
- Results panel — sortable table view with column count, execution time, and bytes processed.
- Query tab system — multiple tabs, draggable split pane between editor and results.
- 180-second query timeout with live heartbeat log streamed to the renderer via `QUERY_LOG` push channel.
- Cancel button — calls `job.cancel()` on the running BigQuery job.
- Custom lightweight JSON store (`src/main/db/store.ts`) for persisting connections across restarts.
- DuckDB in-memory engine (`src/main/db/duckdb.ts`) — ready for the BigQuery community extension.
- CI pipeline (GitHub Actions) — typecheck + Vitest coverage (70 % threshold) on every PR and push to master.
- Release pipeline — macOS DMG (arm64 + x64) built and published on `v*.*.*` tag push; optional code-signing via secrets.
- `justfile` developer task runner (`just dev`, `just test`, `just release-local`, `just branch`, `just pr`, etc.).
- 85 unit tests across main process (DB, IPC) and renderer stores with 70 %+ coverage enforcement.
