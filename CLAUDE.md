# Aperture

A modern, friendly UI tool for querying SQL databases — starting with BigQuery.

## Project Vision

Aperture makes database access intuitive: connect to BigQuery, navigate the catalog, write queries, and organize your work in a folder-based, intelligent way.

## Tech Stack

| Layer | Technology |
|---|---|
| Frontend | [Electron](https://www.electronjs.org/) (macOS-first, responsive) |
| Query engine | [DuckDB](https://duckdb.org/) with BigQuery extension |
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
│   │   └── db/        # DuckDB bridge, BigQuery connector
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
- All database work happens in the **main process** via IPC; the renderer never touches DuckDB directly
- Use TypeScript strict mode everywhere
- Prefer explicit types over `any`
- **All changes must be made on a branch** — never commit directly to `main` (`just branch feat/…`)
- **README.md must be kept in sync** — update it whenever architecture, auth flow, install steps, or developer commands change

### IPC Pattern
- All renderer → main communication goes through typed IPC channels defined in `src/shared/ipc.ts`
- Main process handlers live in `src/main/ipc/`
- Always validate input in main process handlers before touching DuckDB

### DuckDB / BigQuery
- Use the `duckdb` npm package with the `httpfs` and `bigquery` extensions
- Authenticate via Google ADC or a service account JSON path stored in the app's secure config
- Run queries in a worker thread to keep the main process responsive

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
- All DuckDB/IPC logic must have unit tests before merging
- **All tests must pass before merging a PR — never ship with a broken test suite**
- The `pretest`/`posttest` npm hooks automatically swap the DuckDB native binary to the system-Node ABI before running tests and restore the Electron ABI binary afterwards. Both `npm test` and `just dev` work after a `just install` without any manual binary management.
- If `duckdb.test.ts` fails with a `dlopen` / architecture error locally, run `just rebuild` to restore the Electron binary, then re-run `npm test` (pretest will fix the swap automatically). If the system-Node binary (`duckdb-system.node`) was deleted, re-run `just install` to regenerate both binaries.

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

### [2026-03-17] Error: DuckDB Electron binary repeatedly reverts to x86_64 after tests

**Type:** Error
**Context:** Running `just dev` after `npm test` always failed with the `dlopen … incompatible architecture (have 'x86_64', need 'arm64')` error, even though the binary had been correctly set to arm64 before the test run.
**Problem / Change:**
Two compounding bugs in the binary-management scripts:
1. `pretest.js` backed up `duckdb.node` (whatever it was at the time) as `duckdb-electron.node` before swapping to the system binary. If something had already replaced `duckdb.node` with an x86_64 binary (e.g. DuckDB's own `node-pre-gyp install` ran under Rosetta), `duckdb-electron.node` became a corrupt x86_64 backup.
2. `posttest.js` then dutifully restored the corrupt x86_64 `duckdb-electron.node` → `duckdb.node`, locking in the bad state permanently.
**Solution / Outcome:**
- **`scripts/postinstall.js`**: immediately after downloading the correct arm64 Electron binary via `curl`, save it as `duckdb-electron.node` as well. This creates a pristine, arch-verified backup that cannot be overwritten by `pretest.js`.
- **`scripts/pretest.js`**: changed to only write `duckdb-electron.node` when it does not already exist (`if (!existsSync(electronBin))`), preserving the pristine backup from `postinstall`.
- Net result: `duckdb-electron.node` is written once at install time from a known-good download, and is never overwritten by test lifecycle scripts.

**Files affected:**
- `scripts/postinstall.js` — save electron binary immediately after curl
- `scripts/pretest.js` — guard: only back up if pristine copy absent

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
macOS Gatekeeper requires apps distributed outside the App Store to be both (a) **code-signed** with a Developer ID Application certificate and (b) **notarized** (submitted to Apple's scan service). The release workflow handled signing conditionally but had no notarization step. On macOS 13+, notarization is effectively mandatory — even a signed but un-notarized app triggers the "damaged" error when downloaded via a browser (the OS applies a quarantine extended attribute automatically). Additionally, `hardenedRuntime` and entitlements were missing from `electron-builder.yml`; hardened runtime is a prerequisite for notarization, and the three entitlements (`allow-jit`, `allow-unsigned-executable-memory`, `disable-library-validation`) are required for Electron's V8 JIT and for loading unsigned native modules such as `duckdb.node`.
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

### [2026-03-10] Error: DuckDB native binary architecture and ABI mismatch — tests and app both failing

**Type:** Error
**Context:** Running `npm test` and `just dev` after a fresh install on Apple Silicon (arm64). Both failed with `dlopen … incompatible architecture (have 'x86_64', need 'arm64')`.
**Problem / Change:**
Two distinct problems compounded each other:
1. **Wrong architecture**: The `duckdb.node` binary in `node_modules` was `x86_64`, likely installed at some point via a Rosetta terminal. Both Electron (arm64) and the system Node (arm64) need an arm64 binary, so both the app and tests crashed at load time.
2. **ABI version mismatch**: Even with the correct architecture, Electron 33 embeds Node 20 (ABI 115) while the developer's system Node is 22 (ABI 127). They require different pre-built binaries. Previously, `electron-rebuild` replaced the system-Node binary with the Electron binary, which meant tests always failed after a `just install`.

**Solution / Outcome:**
- **Binary management scripts** added in `scripts/`:
  - `scripts/postinstall.js` — runs after `npm install`. Saves the freshly downloaded system-Node binary (`duckdb.node`) as `duckdb-system.node`, then runs `electron-rebuild` to install the Electron-ABI binary as `duckdb.node`. Both binaries are now available. Skipped in CI (`process.env.CI`).
  - `scripts/pretest.js` — runs before every `npm test` (via `pretest` lifecycle hook). If `duckdb-system.node` exists, backs up the current binary as `duckdb-electron.node` then copies `duckdb-system.node` → `duckdb.node` so Vitest can load it. No-op in CI.
  - `scripts/posttest.js` — runs after every `npm test`. Restores `duckdb-electron.node` → `duckdb.node` so `just dev` continues to work without a manual rebuild.
- **`package.json`** updated: `postinstall` → `node scripts/postinstall.js`; added `pretest` and `posttest` lifecycle hooks.
- **Immediate fix**: Deleted the bad x86_64 binary, downloaded the correct arm64 system-Node binary via `node-pre-gyp` directly, saved it as `duckdb-system.node`, then ran `npm run rebuild` to install the Electron binary.
- **CLAUDE.md Testing guideline** updated: "All tests must pass before merging a PR"; documented the binary management behaviour and recovery steps.
- Result: **85/85 tests pass**; `just dev` loads the app correctly; no manual binary management required.

**Files affected:**
- `scripts/postinstall.js` — created
- `scripts/pretest.js` — created
- `scripts/posttest.js` — created
- `package.json` — updated `postinstall`, added `pretest` and `posttest` scripts
- `CLAUDE.md` — updated Testing guideline + this log entry

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
