# Aperture

> A modern, friendly desktop app for querying BigQuery — navigate your catalog, write SQL, and organise saved queries. macOS-native, keyboard-first.

---

## Table of Contents

- [Architecture](#architecture)
- [Authentication](#authentication)
- [Installation](#installation)
- [Development](#development)
  - [Prerequisites](#prerequisites)
  - [Setup](#setup)
  - [Available Commands](#available-commands)
  - [Branching Workflow](#branching-workflow)
  - [Testing](#testing)
  - [CI / CD](#ci--cd)

---

## Architecture

Aperture is an Electron app split into three processes that communicate through a typed IPC bridge.

```
┌──────────────────────────────────────────────────┐
│                  macOS .app bundle                │
│                                                  │
│  ┌─────────────────┐      ┌────────────────────┐ │
│  │  Renderer        │ IPC  │  Main process       │ │
│  │  (React + Vite)  │◄────►│  (Node.js)          │ │
│  │                  │      │                    │ │
│  │  • React 18      │      │  • BigQuery client  │ │
│  │  • Tailwind CSS  │      │  • DuckDB engine    │ │
│  │  • Zustand store │      │  • JSON config store│ │
│  │  • CodeMirror 6  │      │  • IPC handlers     │ │
│  └─────────────────┘      └────────────────────┘ │
│          ▲                          ▲             │
│          │        Preload           │             │
│          └──── contextBridge ───────┘             │
└──────────────────────────────────────────────────┘
```

### Directory Layout

```
aperture/
├── .github/
│   └── workflows/
│       ├── ci.yml          # Typecheck + tests on every PR / push to main
│       └── release.yml     # Build macOS DMG + publish GitHub Release on tag
├── src/
│   ├── main/               # Electron main process (Node.js — never bundled to browser)
│   │   ├── index.ts        # App entry, BrowserWindow creation, native menu
│   │   ├── ipc/            # One handler file per domain (connections, catalog, query)
│   │   └── db/
│   │       ├── bigquery.ts # @google-cloud/bigquery client, runQuery, cancelRunningQuery
│   │       ├── duckdb.ts   # DuckDB in-memory engine (ready for BQ extension)
│   │       └── store.ts    # Lightweight JSON persistence (replaces electron-store)
│   ├── preload/
│   │   └── index.ts        # contextBridge — exposes window.api to renderer
│   ├── renderer/           # React SPA (compiled by Vite, runs in Chromium sandbox)
│   │   └── src/
│   │       ├── components/
│   │       │   ├── catalog/
│   │       │   │   ├── CatalogTree.tsx      # Sidebar: projects → datasets → tables
│   │       │   │   └── TableDetailPanel.tsx # Schema viewer + data preview tab
│   │       │   ├── connections/
│   │       │   │   └── ConnectionModal.tsx  # Add / edit BigQuery connections
│   │       │   ├── editor/
│   │       │   │   └── QueryEditor.tsx      # CodeMirror SQL editor, run/cancel
│   │       │   ├── layout/
│   │       │   │   ├── TitleBar.tsx         # macOS traffic lights spacer
│   │       │   │   └── Sidebar.tsx          # Left panel shell
│   │       │   └── results/
│   │       │       └── ResultsTable.tsx     # Results grid, live log panel, cancelled state
│   │       ├── pages/
│   │       │   └── Editor.tsx               # Tab bar + split-pane layout
│   │       └── store/                       # Zustand stores (UI state only)
│   │           ├── connectionStore.ts
│   │           ├── catalogStore.ts
│   │           └── queryStore.ts
│   └── shared/             # Types and IPC constants shared across processes
│       ├── api.ts           # ElectronAPI interface (window.api contract)
│       ├── ipc.ts           # Typed channel map — IpcMap, CHANNELS constants
│       └── types.ts         # Domain types: Connection, QueryTab, Table, …
├── docker/
│   ├── Dockerfile           # Headless CI image (no Electron GUI)
│   └── docker-compose.yml   # Runs typecheck + tests in containers
├── resources/               # App icons and native assets
├── justfile                 # Developer task runner (install: brew install just)
├── electron-builder.yml     # macOS packaging config (DMG, arm64 + x64)
├── electron.vite.config.ts  # Unified build: main + preload + renderer
├── CLAUDE.md                # Project guidelines and change log
└── package.json
```

### Key Design Decisions

| Decision | Rationale |
|---|---|
| All DB work in main process | Renderer runs in a sandboxed Chromium context — Node.js APIs unavailable |
| Typed IPC via `IpcMap` | Compile-time safety; `IpcRequest<C>` / `IpcResponse<C>` generics catch mismatches |
| `createQueryJob()` not `client.query()` | Returns a `Job` object for real cancellation + progress logging |
| Custom JSON store instead of `electron-store` | `electron-store` v10 is ESM-only, incompatible with the CommonJS main process |
| `electron-vite` as build system | Unified config for main + preload + renderer; HMR in dev |
| Push channel `QUERY_LOG` | Main → renderer heartbeat via `webContents.send` — not request/response |

---

## Authentication

Aperture connects to BigQuery using Google credentials. Two methods are supported and can be configured per-connection in the **Connection Manager** (⌘,).

### Method 1 — Application Default Credentials (ADC)

Best for local development and environments that run on GCP (Cloud Run, GCE, Cloud Shell).

**Setup:**

```bash
# Install gcloud CLI (if not already installed)
brew install --cask google-cloud-sdk

# Authenticate and create local credentials
gcloud auth application-default login
```

This writes credentials to `~/.config/gcloud/application_default_credentials.json`. Aperture picks them up automatically when you select **"Application Default Credentials"** in the connection form.

**No file path is needed** — just select ADC and enter your GCP Project ID.

---

### Method 2 — Service Account JSON

Best for production deployments, CI environments, or when you need to run as a specific service account.

**Setup:**

1. Open [Google Cloud Console → IAM → Service Accounts](https://console.cloud.google.com/iam-admin/serviceaccounts)
2. Create (or select) a service account with the **BigQuery Data Viewer** and **BigQuery Job User** roles
3. Click **Keys → Add Key → Create new key → JSON** — download the `.json` file
4. In Aperture, open the Connection Manager (⌘,) → **New Connection** → select **Service Account**, then provide the path to the downloaded `.json` file

> **Tip:** Store the `.json` file outside your project directory (e.g., `~/.config/aperture/`) to avoid accidentally committing credentials.

---

### Required BigQuery Permissions

| Permission | Purpose |
|---|---|
| `bigquery.datasets.get` | List datasets in a project |
| `bigquery.tables.list` | List tables within a dataset |
| `bigquery.tables.get` | Read table schema |
| `bigquery.jobs.create` | Execute queries |
| `bigquery.jobs.get` | Poll job status |

The predefined roles **BigQuery Data Viewer** + **BigQuery Job User** cover all of the above.

---

## Installation

### Download from GitHub Releases (recommended)

1. Go to the [Releases](../../releases) page
2. Download the `.dmg` file for your Mac:
   - `Aperture-x.y.z-arm64.dmg` → Apple Silicon (M1/M2/M3/M4)
   - `Aperture-x.y.z-x64.dmg` → Intel
3. Open the `.dmg`, drag **Aperture.app** to your **Applications** folder
4. Launch Aperture from Applications or Spotlight

> **⚠️ First launch on macOS — "Aperture is damaged" error**
>
> macOS blocks apps that aren't notarized by Apple, showing _"Aperture is damaged and can't be opened."_
> This is a Gatekeeper warning — the app is not actually damaged.
>
> **Fix (one-time, 10 seconds):** open Terminal and run:
> ```bash
> xattr -cr /Applications/Aperture.app
> ```
> Then double-click the app normally. You will not need to do this again.
>
> _Alternatively_: right-click **Aperture.app** → **Open** → click **Open** in the dialog.

**Requirements:** macOS 13 Ventura or later.

---

## Development

### Prerequisites

| Tool | Version | Install |
|---|---|---|
| Node.js | 20 LTS | `brew install node@20` or [nodejs.org](https://nodejs.org) |
| npm | 10+ | bundled with Node.js |
| just | latest | `brew install just` |
| git | any | `brew install git` |
| gcloud CLI | any | `brew install --cask google-cloud-sdk` (for ADC auth) |

### Setup

```bash
# 1. Clone the repository
git clone https://github.com/<your-org>/aperture.git
cd aperture

# 2. Install dependencies
just install

# 3. Set up BigQuery credentials (pick one method from the Authentication section)
gcloud auth application-default login   # ADC (easiest for dev)

# 4. Start the app in development mode
just dev
```

The app opens with hot-reload enabled. Changes to renderer code refresh the window instantly; changes to main-process code restart the Electron process.

---

### Available Commands

Run `just` with no arguments to list all recipes.

```
just install        Install npm dependencies
just dev            Start app in dev mode (hot-reload)

just typecheck      Type-check main + renderer
just test           Run unit tests once
just test-watch     Run tests in watch mode
just lint           Alias for typecheck (static analysis gate)
just ci             Run full local CI suite (lint + test)

just build          Compile without packaging (outputs to out/)
just release-local  Build DMG for your machine's arch only (~30 s, use locally)
just release        Build DMGs for arm64 + x64 (~5 min, mirrors CI)
just release-open   Build (local arch) + open dist/ in Finder

just version        Print current version
just bump [level]   Bump version (patch | minor | major)
just tag-release    Commit version bump, tag, and push → triggers Release workflow

just branch <name>  Create a new branch from latest main
just pr [title]     Push branch + open a GitHub PR (requires gh CLI)

just clean          Remove out/ and dist/
just clean-all      Remove out/, dist/, and node_modules/
just docker-ci      Run headless CI in Docker
just status         Print branch, commit, node, npm versions
```

---

### Branching Workflow

> **All changes must be made on a feature branch — never commit directly to `main`.**

```bash
# 1. Create a branch
just branch feat/my-feature-name

# 2. Make your changes, then commit
git add -p
git commit -m "feat: describe what changed"

# 3. Run CI checks locally before pushing
just ci

# 4. Push and open a PR
just pr
```

**Branch naming conventions:**

| Prefix | When to use |
|---|---|
| `feat/` | New feature |
| `fix/` | Bug fix |
| `chore/` | Tooling, deps, CI, non-functional changes |
| `refactor/` | Code restructure without behaviour change |
| `docs/` | Documentation-only changes |

PRs require CI to pass before merging. Merge with **Squash and merge** to keep the history linear.

---

### Testing

The project uses **Vitest** with a **70 % coverage minimum** enforced in CI.

#### Framework overview

| Layer | Environment | What is tested |
|---|---|---|
| `src/main/db/` | Node | Store persistence, DuckDB engine, BigQuery bridge |
| `src/main/ipc/` | Node | IPC handlers (connections, catalog, query) |
| `src/renderer/src/store/` | jsdom | Zustand stores (connection, catalog, query) |

The test files live in `src/__tests__/` mirroring the source tree. Each test follows the **Arrange → Act → Assert** pattern and is kept intentionally short.

#### Running tests

```bash
just test          # run once
just test-watch    # re-run on file changes
just coverage      # run with coverage report (enforces 70 % threshold)
just coverage-open # open the HTML report in the browser after `just coverage`
```

#### Coverage scope

Coverage is measured only over the core logic files (`src/main/db/**`, `src/main/ipc/**`, `src/renderer/src/store/**`). UI components and Electron bootstrap are excluded — they are tested via E2E tests (Playwright, planned).

#### Mocking strategy

- **`electron`** — mocked via `vi.mock('electron', ...)` so main-process code can run in plain Node.
- **`@google-cloud/bigquery`** — fully mocked; no real GCP calls in tests.
- **`duckdb`** — uses the real native module (integration tests).
- **`window.api`** — stubbed in `src/__tests__/setup.ts` for renderer store tests.

---

### CI / CD

| Workflow | Trigger | What it does |
|---|---|---|
| `ci.yml` | Push to `main` or PR | Typecheck (main + renderer) + Vitest unit tests — runs on Ubuntu |
| `release.yml` | Push a `v*.*.*` tag | Builds macOS DMG (arm64 + x64) on `macos-14`, creates a GitHub Release with DMG artifacts |

#### Publishing a release

```bash
# 1. Make sure you're on main and everything is merged
git checkout main && git pull

# 2. Bump the version
just bump minor   # or patch / major

# 3. Tag and push — GitHub Actions takes it from here
just tag-release
```

The Release workflow will produce signed+notarized builds when the following GitHub secrets are configured on the repository:

| Secret | Value |
|---|---|
| `MAC_CERTIFICATE` | Base64-encoded `.p12` Developer ID certificate |
| `MAC_CERTIFICATE_PASSWORD` | Password for the `.p12` file |
| `APPLE_ID` | Your Apple ID email |
| `APPLE_APP_SPECIFIC_PASSWORD` | App-specific password from appleid.apple.com |
| `APPLE_TEAM_ID` | 10-character Apple Team ID |

Without these secrets the workflow still runs and produces an **unsigned DMG** (suitable for internal distribution).

---

> **Change log** — all significant changes are tracked in [CLAUDE.md](./CLAUDE.md#change-log--error-report).
