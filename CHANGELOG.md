# Changelog

All notable changes to Aperture are documented here.
Format follows [Keep a Changelog](https://keepachangelog.com/en/1.1.0/).
Versions follow [Semantic Versioning](https://semver.org/).

---

## [Unreleased]

### Added
- Search bar in the sidebar catalog tree — filter datasets and tables by name in real time
- Light theme (orange + off-white) and dark theme (orange accent) with a toggle in the title bar
- Camera aperture logo replacing the generic database icon

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
