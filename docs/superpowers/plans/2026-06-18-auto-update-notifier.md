# Auto-update Notifier Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Notify users in-app when a newer GitHub release of Aperture exists, with a gear-icon badge and a Settings → Updates section that offers a one-click arch-aware DMG download — no code-signing, no extra hosting.

**Architecture:** The Electron **main process** owns the check: a scheduler (one check ~5s after launch, then every 3h) fetches GitHub's `/releases/latest`, compares versions, picks the arch-matched DMG asset, and pushes an `UpdateStatus` to the renderer over a push IPC channel (mirroring `QUERY_LOG`). A manual "Check for updates" button uses a request/response channel. The renderer holds the status in a Zustand store; a `TitleBar` gear badge and a `SettingsModal` "Updates" section render it. Downloads open the DMG URL in the browser via the existing `setWindowOpenHandler` → `shell.openExternal` path (plain `<a target="_blank">`).

**Tech Stack:** TypeScript, Electron 33, Node 20 global `fetch`, Zustand, React, Tailwind, Vitest.

**Reference spec:** `docs/superpowers/specs/2026-06-18-auto-update-notifier-design.md`

---

## File Structure

**New files:**
- `src/main/updates/compareSemver.ts` — pure semver comparator (no deps)
- `src/main/updates/selectDmgAsset.ts` — pure arch → DMG asset URL picker
- `src/main/updates/checkForUpdate.ts` — orchestration: fetch + compare + select → `UpdateStatus`
- `src/main/ipc/updates.ts` — `UPDATES_CHECK` handler + `pushUpdateStatus()` helper
- `src/renderer/src/store/updateStore.ts` — Zustand store + `UPDATES_STATUS` push listener
- Tests:
  - `src/__tests__/main/updates/compareSemver.test.ts`
  - `src/__tests__/main/updates/selectDmgAsset.test.ts`
  - `src/__tests__/main/updates/checkForUpdate.test.ts`
  - `src/__tests__/main/ipc/updates.test.ts`
  - `src/__tests__/renderer/store/updateStore.test.ts`

**Modified files:**
- `src/shared/types.ts` — add `UpdateStatus`
- `src/shared/ipc.ts` — add `UPDATES_CHECK` (req/res) + `UPDATES_STATUS` (push) channels
- `src/main/ipc/index.ts` — register update handlers
- `src/main/index.ts` — start the 3h scheduler + initial check
- `src/renderer/src/components/layout/TitleBar.tsx` — gear badge dot
- `src/renderer/src/components/settings/SettingsModal.tsx` — two-section nav + Updates section
- `README.md`, `CHANGELOG.md`, `CLAUDE.md` — docs

**Coverage note:** Vitest's coverage include set is `src/main/db/**`, `src/main/ipc/**`, `src/renderer/src/store/**`. So `src/main/ipc/updates.ts` and `src/renderer/src/store/updateStore.ts` MUST be tested to hold the 70% gate. The `src/main/updates/**` helpers sit outside the include set (like the existing `lib/*` parsers) but are still unit-tested per the CLAUDE.md "all IPC/adapter logic must have unit tests" rule. `TitleBar.tsx`, `SettingsModal.tsx`, and `main/index.ts` are outside the include set (UI / bootstrap) and are verified via typecheck + build + manual run.

---

## Task 1: Shared types + IPC channels

**Files:**
- Modify: `src/shared/types.ts` (append a new interface)
- Modify: `src/shared/ipc.ts` (add two channels + one IpcMap entry)

- [ ] **Step 1: Add the `UpdateStatus` type**

Append to the end of `src/shared/types.ts`:

```ts
/**
 * Result of an update check against GitHub's /releases/latest.
 * `currentVersion` is always set; the rest are null on a failed/empty check.
 */
export interface UpdateStatus {
  currentVersion: string
  latestVersion: string | null
  updateAvailable: boolean
  /** Arch-matched DMG asset URL, or null if no matching asset was found. */
  dmgUrl: string | null
  /** The release's GitHub HTML page. */
  releaseUrl: string | null
  releaseNotes: string | null
  publishedAt: string | null
  /** ISO timestamp of when this check ran. */
  checkedAt: string
  /** Non-null when the check failed (network/HTTP/parse). */
  error: string | null
}
```

- [ ] **Step 2: Add the import for `UpdateStatus` in ipc.ts**

In `src/shared/ipc.ts`, the first line imports types. Add `UpdateStatus` to that import list:

```ts
import type { Connection, ConnectionCreate, Dataset, Table, TableField, TableSearchHit, QueryResult, SavedQuery, Folder, HistoryEntry, Theme, ThemeImportPayload, UpdateStatus } from './types'
```

- [ ] **Step 3: Add the channels to the `CHANNELS` object**

In `src/shared/ipc.ts`, inside the `CHANNELS` object, add a new block right after the `THEMES_*` entries (before the closing `} as const`):

```ts
  // Updates
  UPDATES_CHECK: 'updates:check',
  // Push event: main → renderer (not request/response — use window.api.on to listen)
  UPDATES_STATUS: 'updates:status',
```

- [ ] **Step 4: Add the IpcMap entry**

In `src/shared/ipc.ts`, inside the `IpcMap` interface, add this entry after the `THEMES_SET_ACTIVE` line (note: only `UPDATES_CHECK` goes here — `UPDATES_STATUS` is push-only, like `QUERY_LOG`):

```ts
  [CHANNELS.UPDATES_CHECK]: { req: undefined; res: UpdateStatus }
```

- [ ] **Step 5: Verify it compiles**

Run: `npm run typecheck`
Expected: no errors.

- [ ] **Step 6: Commit**

```bash
git add src/shared/types.ts src/shared/ipc.ts
git commit -m "✨ feat(updates): add UpdateStatus type + IPC channels"
```

---

## Task 2: `compareSemver` (pure)

**Files:**
- Create: `src/main/updates/compareSemver.ts`
- Test: `src/__tests__/main/updates/compareSemver.test.ts`

- [ ] **Step 1: Write the failing test**

Create `src/__tests__/main/updates/compareSemver.test.ts`:

```ts
import { describe, it, expect } from 'vitest'
import { compareSemver } from '../../../main/updates/compareSemver'

describe('compareSemver', () => {
  it('returns 1 when a is newer (patch)', () => {
    expect(compareSemver('2.3.1', '2.3.0')).toBe(1)
  })

  it('returns 1 when a is newer (minor / major)', () => {
    expect(compareSemver('2.4.0', '2.3.9')).toBe(1)
    expect(compareSemver('3.0.0', '2.9.9')).toBe(1)
  })

  it('returns -1 when a is older', () => {
    expect(compareSemver('2.3.0', '2.3.1')).toBe(-1)
  })

  it('returns 0 when equal', () => {
    expect(compareSemver('2.3.0', '2.3.0')).toBe(0)
  })

  it('strips a leading v on either side', () => {
    expect(compareSemver('v2.4.0', '2.3.0')).toBe(1)
    expect(compareSemver('2.4.0', 'v2.3.0')).toBe(1)
  })

  it('ignores a prerelease suffix on the numeric core', () => {
    expect(compareSemver('2.4.0-beta.1', '2.3.0')).toBe(1)
  })

  it('returns 0 for unparseable input (never a false update)', () => {
    expect(compareSemver('not-a-version', '2.3.0')).toBe(0)
    expect(compareSemver('2.3.0', 'garbage')).toBe(0)
  })
})
```

- [ ] **Step 2: Run the test to verify it fails**

Run: `npx vitest run src/__tests__/main/updates/compareSemver.test.ts`
Expected: FAIL — cannot find module `compareSemver`.

- [ ] **Step 3: Write the implementation**

Create `src/main/updates/compareSemver.ts`:

```ts
/**
 * Compares two semver-ish version strings by their numeric major.minor.patch
 * core. A leading `v` and any prerelease/build suffix are ignored.
 *
 * Returns 1 if a > b, -1 if a < b, 0 if equal OR if either side is unparseable
 * (returning 0 on garbage guarantees we never report a false "update available").
 */
export function compareSemver(a: string, b: string): -1 | 0 | 1 {
  const pa = parse(a)
  const pb = parse(b)
  if (!pa || !pb) return 0
  for (let i = 0; i < 3; i++) {
    if (pa[i] > pb[i]) return 1
    if (pa[i] < pb[i]) return -1
  }
  return 0
}

function parse(v: string): [number, number, number] | null {
  const m = /^v?(\d+)\.(\d+)\.(\d+)/.exec(v.trim())
  if (!m) return null
  return [Number(m[1]), Number(m[2]), Number(m[3])]
}
```

- [ ] **Step 4: Run the test to verify it passes**

Run: `npx vitest run src/__tests__/main/updates/compareSemver.test.ts`
Expected: PASS (7 tests).

- [ ] **Step 5: Commit**

```bash
git add src/main/updates/compareSemver.ts src/__tests__/main/updates/compareSemver.test.ts
git commit -m "✨ feat(updates): add compareSemver helper"
```

---

## Task 3: `selectDmgAsset` (pure)

**Files:**
- Create: `src/main/updates/selectDmgAsset.ts`
- Test: `src/__tests__/main/updates/selectDmgAsset.test.ts`

- [ ] **Step 1: Write the failing test**

Create `src/__tests__/main/updates/selectDmgAsset.test.ts`:

```ts
import { describe, it, expect } from 'vitest'
import { selectDmgAsset } from '../../../main/updates/selectDmgAsset'

const assets = [
  { name: 'Aperture-2.4.0-arm64.dmg', browser_download_url: 'https://x/arm64.dmg' },
  { name: 'Aperture-2.4.0-x64.dmg', browser_download_url: 'https://x/x64.dmg' },
  { name: 'Aperture-2.4.0-arm64.dmg.blockmap', browser_download_url: 'https://x/map' },
]

describe('selectDmgAsset', () => {
  it('picks the arm64 DMG for arm64', () => {
    expect(selectDmgAsset(assets, 'arm64')).toBe('https://x/arm64.dmg')
  })

  it('picks the x64 DMG for x64', () => {
    expect(selectDmgAsset(assets, 'x64')).toBe('https://x/x64.dmg')
  })

  it('returns null when no asset matches the arch', () => {
    expect(selectDmgAsset(assets, 'ppc64')).toBeNull()
  })

  it('returns null for an empty asset list', () => {
    expect(selectDmgAsset([], 'arm64')).toBeNull()
  })
})
```

- [ ] **Step 2: Run the test to verify it fails**

Run: `npx vitest run src/__tests__/main/updates/selectDmgAsset.test.ts`
Expected: FAIL — cannot find module `selectDmgAsset`.

- [ ] **Step 3: Write the implementation**

Create `src/main/updates/selectDmgAsset.ts`:

```ts
export interface GithubAsset {
  name: string
  browser_download_url: string
}

/**
 * Picks the browser download URL of the DMG asset matching the given arch.
 * Asset names follow electron-builder's `${productName}-${version}-${arch}.dmg`
 * (see electron-builder.yml dmg.artifactName), e.g. `Aperture-2.4.0-arm64.dmg`.
 * Returns null when no DMG matches (caller falls back to the release page).
 */
export function selectDmgAsset(assets: GithubAsset[], arch: string): string | null {
  const suffix = `-${arch}.dmg`
  const hit = assets.find((a) => a.name.endsWith(suffix))
  return hit ? hit.browser_download_url : null
}
```

- [ ] **Step 4: Run the test to verify it passes**

Run: `npx vitest run src/__tests__/main/updates/selectDmgAsset.test.ts`
Expected: PASS (4 tests).

- [ ] **Step 5: Commit**

```bash
git add src/main/updates/selectDmgAsset.ts src/__tests__/main/updates/selectDmgAsset.test.ts
git commit -m "✨ feat(updates): add selectDmgAsset helper"
```

---

## Task 4: `checkForUpdate` (fetch orchestration)

**Files:**
- Create: `src/main/updates/checkForUpdate.ts`
- Test: `src/__tests__/main/updates/checkForUpdate.test.ts`

- [ ] **Step 1: Write the failing test**

Create `src/__tests__/main/updates/checkForUpdate.test.ts`:

```ts
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest'
import { checkForUpdate } from '../../../main/updates/checkForUpdate'

function release(overrides: Record<string, unknown> = {}) {
  return {
    tag_name: 'v2.4.0',
    html_url: 'https://github.com/joao-victor-campos/aperture/releases/tag/v2.4.0',
    body: 'Release notes here',
    published_at: '2026-06-18T00:00:00Z',
    assets: [
      { name: 'Aperture-2.4.0-arm64.dmg', browser_download_url: 'https://x/arm64.dmg' },
      { name: 'Aperture-2.4.0-x64.dmg', browser_download_url: 'https://x/x64.dmg' },
    ],
    ...overrides,
  }
}

beforeEach(() => {
  vi.stubGlobal('fetch', vi.fn())
})

afterEach(() => {
  vi.unstubAllGlobals()
})

describe('checkForUpdate', () => {
  it('reports an update with the arch-matched DMG when latest is newer', async () => {
    ;(fetch as unknown as ReturnType<typeof vi.fn>).mockResolvedValue({
      ok: true,
      json: async () => release(),
    })

    const status = await checkForUpdate('2.3.0', 'arm64')

    expect(status.updateAvailable).toBe(true)
    expect(status.latestVersion).toBe('v2.4.0')
    expect(status.dmgUrl).toBe('https://x/arm64.dmg')
    expect(status.releaseUrl).toContain('/releases/tag/v2.4.0')
    expect(status.releaseNotes).toBe('Release notes here')
    expect(status.error).toBeNull()
  })

  it('reports no update when already on the latest', async () => {
    ;(fetch as unknown as ReturnType<typeof vi.fn>).mockResolvedValue({
      ok: true,
      json: async () => release(),
    })

    const status = await checkForUpdate('2.4.0', 'arm64')

    expect(status.updateAvailable).toBe(false)
    expect(status.dmgUrl).toBeNull()
    expect(status.error).toBeNull()
  })

  it('leaves dmgUrl null when no asset matches the arch but an update exists', async () => {
    ;(fetch as unknown as ReturnType<typeof vi.fn>).mockResolvedValue({
      ok: true,
      json: async () => release({ assets: [] }),
    })

    const status = await checkForUpdate('2.3.0', 'arm64')

    expect(status.updateAvailable).toBe(true)
    expect(status.dmgUrl).toBeNull()
    expect(status.releaseUrl).toContain('/releases/tag/v2.4.0')
  })

  it('returns an error status on a non-200 response', async () => {
    ;(fetch as unknown as ReturnType<typeof vi.fn>).mockResolvedValue({
      ok: false,
      status: 403,
      json: async () => ({}),
    })

    const status = await checkForUpdate('2.3.0', 'arm64')

    expect(status.updateAvailable).toBe(false)
    expect(status.latestVersion).toBeNull()
    expect(status.currentVersion).toBe('2.3.0')
    expect(status.error).toContain('403')
  })

  it('returns an error status on a network failure', async () => {
    ;(fetch as unknown as ReturnType<typeof vi.fn>).mockRejectedValue(new Error('offline'))

    const status = await checkForUpdate('2.3.0', 'arm64')

    expect(status.updateAvailable).toBe(false)
    expect(status.error).toBe('offline')
  })
})
```

- [ ] **Step 2: Run the test to verify it fails**

Run: `npx vitest run src/__tests__/main/updates/checkForUpdate.test.ts`
Expected: FAIL — cannot find module `checkForUpdate`.

- [ ] **Step 3: Write the implementation**

Create `src/main/updates/checkForUpdate.ts`:

```ts
import { compareSemver } from './compareSemver'
import { selectDmgAsset, type GithubAsset } from './selectDmgAsset'
import type { UpdateStatus } from '../../shared/types'

export const GITHUB_REPO = 'joao-victor-campos/aperture'
const RELEASES_LATEST_URL = `https://api.github.com/repos/${GITHUB_REPO}/releases/latest`

interface GithubRelease {
  tag_name: string
  html_url: string
  body: string | null
  published_at: string
  assets: GithubAsset[]
}

/**
 * Checks GitHub's /releases/latest (which excludes drafts and prereleases) for a
 * version newer than `currentVersion`. Never throws — failures resolve to an
 * UpdateStatus with `error` set so the scheduler can swallow them silently.
 *
 * @param currentVersion app.getVersion()
 * @param arch process.arch ('arm64' | 'x64')
 */
export async function checkForUpdate(currentVersion: string, arch: string): Promise<UpdateStatus> {
  const checkedAt = new Date().toISOString()
  try {
    const res = await fetch(RELEASES_LATEST_URL, {
      headers: { Accept: 'application/vnd.github+json' },
    })
    if (!res.ok) {
      return errorStatus(currentVersion, checkedAt, `GitHub responded ${res.status}`)
    }
    const release = (await res.json()) as GithubRelease
    const latestVersion = release.tag_name
    const updateAvailable = compareSemver(latestVersion, currentVersion) === 1
    return {
      currentVersion,
      latestVersion,
      updateAvailable,
      dmgUrl: updateAvailable ? selectDmgAsset(release.assets ?? [], arch) : null,
      releaseUrl: release.html_url ?? null,
      releaseNotes: release.body ?? null,
      publishedAt: release.published_at ?? null,
      checkedAt,
      error: null,
    }
  } catch (err) {
    return errorStatus(currentVersion, checkedAt, err instanceof Error ? err.message : String(err))
  }
}

function errorStatus(currentVersion: string, checkedAt: string, error: string): UpdateStatus {
  return {
    currentVersion,
    latestVersion: null,
    updateAvailable: false,
    dmgUrl: null,
    releaseUrl: null,
    releaseNotes: null,
    publishedAt: null,
    checkedAt,
    error,
  }
}
```

- [ ] **Step 4: Run the test to verify it passes**

Run: `npx vitest run src/__tests__/main/updates/checkForUpdate.test.ts`
Expected: PASS (5 tests).

- [ ] **Step 5: Commit**

```bash
git add src/main/updates/checkForUpdate.ts src/__tests__/main/updates/checkForUpdate.test.ts
git commit -m "✨ feat(updates): add checkForUpdate orchestration"
```

---

## Task 5: IPC handler + push helper

**Files:**
- Create: `src/main/ipc/updates.ts`
- Modify: `src/main/ipc/index.ts`
- Test: `src/__tests__/main/ipc/updates.test.ts`

- [ ] **Step 1: Write the failing test**

Create `src/__tests__/main/ipc/updates.test.ts`:

```ts
import { describe, it, expect, vi, beforeEach } from 'vitest'
import { CHANNELS } from '../../../shared/ipc'
import type { UpdateStatus } from '../../../shared/types'

// ── Capture ipcMain.handle registrations ────────────────────────────────────
type Handler = (event: unknown, req?: unknown) => unknown
const handlers = new Map<string, Handler>()

vi.mock('electron', () => ({
  ipcMain: {
    handle: (channel: string, fn: Handler) => handlers.set(channel, fn),
  },
  app: { getVersion: () => '2.3.0' },
}))

// ── Mock checkForUpdate ──────────────────────────────────────────────────────
const mockCheck = vi.fn()
vi.mock('../../../main/updates/checkForUpdate', () => ({
  checkForUpdate: (...args: unknown[]) => mockCheck(...args),
}))

import { registerUpdateHandlers, pushUpdateStatus } from '../../../main/ipc/updates'

function fakeStatus(): UpdateStatus {
  return {
    currentVersion: '2.3.0',
    latestVersion: '2.4.0',
    updateAvailable: true,
    dmgUrl: 'https://x/arm64.dmg',
    releaseUrl: 'https://x/release',
    releaseNotes: 'notes',
    publishedAt: '2026-06-18T00:00:00Z',
    checkedAt: '2026-06-18T00:00:00Z',
    error: null,
  }
}

beforeEach(() => {
  handlers.clear()
  mockCheck.mockReset()
})

describe('UPDATES_CHECK handler', () => {
  it('returns the checkForUpdate result using the app version', async () => {
    mockCheck.mockResolvedValue(fakeStatus())
    registerUpdateHandlers()

    const handler = handlers.get(CHANNELS.UPDATES_CHECK)!
    const result = await handler({})

    expect(mockCheck).toHaveBeenCalledWith('2.3.0', process.arch)
    expect(result).toEqual(fakeStatus())
  })
})

describe('pushUpdateStatus', () => {
  it('sends UPDATES_STATUS to a live window', async () => {
    mockCheck.mockResolvedValue(fakeStatus())
    const send = vi.fn()
    const win = { isDestroyed: () => false, webContents: { send } }

    await pushUpdateStatus(win as never)

    expect(send).toHaveBeenCalledWith(CHANNELS.UPDATES_STATUS, fakeStatus())
  })

  it('is a no-op when the window is null', async () => {
    await pushUpdateStatus(null)
    expect(mockCheck).not.toHaveBeenCalled()
  })

  it('is a no-op when the window is destroyed', async () => {
    const send = vi.fn()
    const win = { isDestroyed: () => true, webContents: { send } }

    await pushUpdateStatus(win as never)

    expect(send).not.toHaveBeenCalled()
  })
})
```

- [ ] **Step 2: Run the test to verify it fails**

Run: `npx vitest run src/__tests__/main/ipc/updates.test.ts`
Expected: FAIL — cannot find module `updates`.

- [ ] **Step 3: Write the implementation**

Create `src/main/ipc/updates.ts`:

```ts
import { ipcMain, app, type BrowserWindow } from 'electron'
import { CHANNELS } from '../../shared/ipc'
import { checkForUpdate } from '../updates/checkForUpdate'

export function registerUpdateHandlers(): void {
  ipcMain.handle(CHANNELS.UPDATES_CHECK, async () => {
    return checkForUpdate(app.getVersion(), process.arch)
  })
}

/**
 * Runs a check and pushes the result to the renderer over UPDATES_STATUS.
 * Used by the scheduler in main/index.ts. No-ops if the window is gone, and
 * checkForUpdate never throws, so this is safe to fire-and-forget.
 */
export async function pushUpdateStatus(window: BrowserWindow | null): Promise<void> {
  if (!window || window.isDestroyed()) return
  const status = await checkForUpdate(app.getVersion(), process.arch)
  if (!window.isDestroyed()) {
    window.webContents.send(CHANNELS.UPDATES_STATUS, status)
  }
}
```

- [ ] **Step 4: Register the handler in the IPC barrel**

In `src/main/ipc/index.ts`, add the import (after the themes import):

```ts
import { registerUpdateHandlers } from './updates'
```

And add the call inside `registerIpcHandlers()` (after `registerThemeHandlers()`):

```ts
  registerUpdateHandlers()
```

- [ ] **Step 5: Run the test to verify it passes**

Run: `npx vitest run src/__tests__/main/ipc/updates.test.ts`
Expected: PASS (4 tests).

- [ ] **Step 6: Commit**

```bash
git add src/main/ipc/updates.ts src/main/ipc/index.ts src/__tests__/main/ipc/updates.test.ts
git commit -m "✨ feat(updates): add UPDATES_CHECK handler + pushUpdateStatus"
```

---

## Task 6: Main-process scheduler

**Files:**
- Modify: `src/main/index.ts`

This file is the app bootstrap (outside the coverage include set); `pushUpdateStatus` itself is already tested in Task 5. Verify via typecheck + build.

- [ ] **Step 1: Import the push helper**

In `src/main/index.ts`, add after the existing `import { registerIpcHandlers } from './ipc'` line:

```ts
import { pushUpdateStatus } from './ipc/updates'
```

- [ ] **Step 2: Add the scheduler function**

In `src/main/index.ts`, add this function just above the `app.whenReady().then(...)` block:

```ts
const UPDATE_CHECK_INTERVAL_MS = 3 * 60 * 60 * 1000 // 3 hours

/** Initial check ~5s after launch, then every 3h. Failures are swallowed by pushUpdateStatus. */
function startUpdateScheduler(): void {
  const run = (): void => {
    void pushUpdateStatus(mainWindow)
  }
  setTimeout(run, 5000)
  setInterval(run, UPDATE_CHECK_INTERVAL_MS)
}
```

- [ ] **Step 3: Start the scheduler after the window is created**

In `src/main/index.ts`, inside `app.whenReady().then(() => { ... })`, add `startUpdateScheduler()` right after the `createWindow()` call:

```ts
  registerIpcHandlers()
  createWindow()
  startUpdateScheduler()
```

- [ ] **Step 4: Verify it compiles and builds**

Run: `npm run typecheck`
Expected: no errors.

Run: `npm run build`
Expected: build succeeds (main + preload + renderer bundles emitted).

- [ ] **Step 5: Commit**

```bash
git add src/main/index.ts
git commit -m "✨ feat(updates): schedule update checks (initial + every 3h)"
```

---

## Task 7: Renderer update store

**Files:**
- Create: `src/renderer/src/store/updateStore.ts`
- Test: `src/__tests__/renderer/store/updateStore.test.ts`

- [ ] **Step 1: Write the failing test**

Create `src/__tests__/renderer/store/updateStore.test.ts`:

```ts
import { describe, it, expect, vi, beforeEach } from 'vitest'
import { CHANNELS } from '@shared/ipc'
import type { UpdateStatus } from '@shared/types'
import { useUpdateStore, applyUpdateStatusPush } from '../../../renderer/src/store/updateStore'

function fakeStatus(overrides: Partial<UpdateStatus> = {}): UpdateStatus {
  return {
    currentVersion: '2.3.0',
    latestVersion: '2.4.0',
    updateAvailable: true,
    dmgUrl: 'https://x/arm64.dmg',
    releaseUrl: 'https://x/release',
    releaseNotes: 'notes',
    publishedAt: '2026-06-18T00:00:00Z',
    checkedAt: '2026-06-18T00:00:00Z',
    error: null,
    ...overrides,
  }
}

beforeEach(() => {
  useUpdateStore.setState({ status: null, checking: false })
  vi.mocked(window.api.invoke).mockReset()
})

describe('updateStore.checkNow', () => {
  it('stores the status on success', async () => {
    vi.mocked(window.api.invoke).mockResolvedValue(fakeStatus())

    await useUpdateStore.getState().checkNow()

    expect(window.api.invoke).toHaveBeenCalledWith(CHANNELS.UPDATES_CHECK, undefined)
    expect(useUpdateStore.getState().status?.latestVersion).toBe('2.4.0')
    expect(useUpdateStore.getState().checking).toBe(false)
  })

  it('records an error status when the invoke rejects', async () => {
    useUpdateStore.setState({ status: fakeStatus({ currentVersion: '2.3.0' }) })
    vi.mocked(window.api.invoke).mockRejectedValue(new Error('boom'))

    await useUpdateStore.getState().checkNow()

    const s = useUpdateStore.getState().status!
    expect(s.error).toBe('boom')
    expect(s.updateAvailable).toBe(false)
    expect(s.currentVersion).toBe('2.3.0') // preserved from prior status
    expect(useUpdateStore.getState().checking).toBe(false)
  })
})

describe('updateStore UPDATES_STATUS push listener', () => {
  it('applies a pushed status to the store', () => {
    // applyUpdateStatusPush is the exported listener body. We test it directly
    // rather than retrieving the import-time window.api.on callback, because the
    // project's vitest config sets clearMocks:true (it wipes mock.calls before
    // each test, so the import-time registration call is not retrievable here).
    applyUpdateStatusPush(fakeStatus({ latestVersion: '2.5.0' }))

    expect(useUpdateStore.getState().status?.latestVersion).toBe('2.5.0')
  })
})
```

- [ ] **Step 2: Run the test to verify it fails**

Run: `npx vitest run src/__tests__/renderer/store/updateStore.test.ts`
Expected: FAIL — cannot find module `updateStore`.

- [ ] **Step 3: Write the implementation**

Create `src/renderer/src/store/updateStore.ts`:

```ts
import { create } from 'zustand'
import { CHANNELS } from '@shared/ipc'
import type { UpdateStatus } from '@shared/types'

interface UpdateState {
  status: UpdateStatus | null
  checking: boolean
  /** Manual "Check for updates" — invokes the main process and stores the result. */
  checkNow: () => Promise<void>
}

export const useUpdateStore = create<UpdateState>((set, get) => ({
  status: null,
  checking: false,

  checkNow: async () => {
    set({ checking: true })
    try {
      const status = await window.api.invoke(CHANNELS.UPDATES_CHECK, undefined)
      set({ status, checking: false })
    } catch (err) {
      // checkForUpdate normally returns its own error status; this only fires if
      // the IPC bridge itself fails. Preserve the known currentVersion.
      set({
        checking: false,
        status: {
          currentVersion: get().status?.currentVersion ?? '',
          latestVersion: null,
          updateAvailable: false,
          dmgUrl: null,
          releaseUrl: null,
          releaseNotes: null,
          publishedAt: null,
          checkedAt: new Date().toISOString(),
          error: err instanceof Error ? err.message : String(err),
        },
      })
    }
  },
}))

// ── Global UPDATES_STATUS push listener ─────────────────────────────────────
// Main process pushes an UpdateStatus on each scheduled check.
/** Exported so it can be unit-tested directly (see updateStore.test.ts). */
export function applyUpdateStatusPush(data: unknown): void {
  useUpdateStore.setState({ status: data as UpdateStatus })
}

window.api.on(CHANNELS.UPDATES_STATUS, applyUpdateStatusPush)
```

- [ ] **Step 4: Run the test to verify it passes**

Run: `npx vitest run src/__tests__/renderer/store/updateStore.test.ts`
Expected: PASS (3 tests).

- [ ] **Step 5: Commit**

```bash
git add src/renderer/src/store/updateStore.ts src/__tests__/renderer/store/updateStore.test.ts
git commit -m "✨ feat(updates): add renderer updateStore + push listener"
```

---

## Task 8: Gear-icon badge in the title bar

**Files:**
- Modify: `src/renderer/src/components/layout/TitleBar.tsx`

UI component (outside coverage include set). Verify via typecheck + build + manual.

- [ ] **Step 1: Import the update store**

In `src/renderer/src/components/layout/TitleBar.tsx`, add near the other store imports at the top:

```ts
import { useUpdateStore } from '../../store/updateStore'
```

- [ ] **Step 2: Read `updateAvailable` inside the component**

In `src/renderer/src/components/layout/TitleBar.tsx`, inside the `TitleBar` function body (near the existing `const activeConn = ...` line), add:

```ts
  const updateAvailable = useUpdateStore((s) => s.status?.updateAvailable ?? false)
```

- [ ] **Step 3: Render the badge on the Settings button**

In `src/renderer/src/components/layout/TitleBar.tsx`, replace the Settings button block:

```tsx
        {/* Settings */}
        <button
          onClick={onOpenSettings}
          title="Settings"
          style={{ WebkitAppRegion: 'no-drag' } as React.CSSProperties}
          className="p-1.5 rounded-md text-app-text-2 hover:text-app-text hover:bg-app-elevated transition-colors"
        >
          <Settings size={14} />
        </button>
```

with:

```tsx
        {/* Settings */}
        <button
          onClick={onOpenSettings}
          title={updateAvailable ? 'Settings — update available' : 'Settings'}
          style={{ WebkitAppRegion: 'no-drag' } as React.CSSProperties}
          className="relative p-1.5 rounded-md text-app-text-2 hover:text-app-text hover:bg-app-elevated transition-colors"
        >
          <Settings size={14} />
          {updateAvailable && (
            <span
              className="absolute top-0.5 right-0.5 w-2 h-2 rounded-full bg-app-accent ring-2 ring-app-bg"
              aria-label="Update available"
            />
          )}
        </button>
```

- [ ] **Step 4: Verify it compiles**

Run: `npm run typecheck`
Expected: no errors.

- [ ] **Step 5: Commit**

```bash
git add src/renderer/src/components/layout/TitleBar.tsx
git commit -m "✨ feat(updates): badge the settings gear when an update is available"
```

---

## Task 9: Settings → Updates section

**Files:**
- Modify: `src/renderer/src/components/settings/SettingsModal.tsx`

UI component (outside coverage include set). This converts the single-section modal into a two-section one (Themes / Updates) and adds the Updates panel. Verify via typecheck + build + manual run.

- [ ] **Step 1: Replace the whole `SettingsModal.tsx` file**

Overwrite `src/renderer/src/components/settings/SettingsModal.tsx` with:

```tsx
import { useEffect, useRef, useState } from 'react'
import { createPortal } from 'react-dom'
import { X, Plus, Trash2, Palette, Download, RefreshCw, Check } from 'lucide-react'
import { useThemeStore } from '../../store/themeStore'
import { useUpdateStore } from '../../store/updateStore'

interface SettingsModalProps {
  open: boolean
  onClose: () => void
}

type Section = 'themes' | 'updates'

export default function SettingsModal({ open, onClose }: SettingsModalProps) {
  const { themes, activeThemeId, importFromFile, remove, setActive } = useThemeStore()
  const updateAvailable = useUpdateStore((s) => s.status?.updateAvailable ?? false)
  const [section, setSection] = useState<Section>('themes')
  const [importError, setImportError] = useState<string | null>(null)
  const [isImporting, setIsImporting] = useState(false)
  const [confirmDeleteId, setConfirmDeleteId] = useState<string | null>(null)
  const confirmTimeoutRef = useRef<ReturnType<typeof setTimeout> | null>(null)

  // Close on Escape
  useEffect(() => {
    if (!open) return
    const onKey = (e: KeyboardEvent) => {
      if (e.key === 'Escape') onClose()
    }
    window.addEventListener('keydown', onKey)
    return () => window.removeEventListener('keydown', onKey)
  }, [open, onClose])

  // Clean up confirm timeout on unmount
  useEffect(() => () => {
    if (confirmTimeoutRef.current) clearTimeout(confirmTimeoutRef.current)
  }, [])

  // Reset transient state when the modal closes (component stays mounted).
  useEffect(() => {
    if (!open) {
      setImportError(null)
      setConfirmDeleteId(null)
      setSection('themes')
      if (confirmTimeoutRef.current) {
        clearTimeout(confirmTimeoutRef.current)
        confirmTimeoutRef.current = null
      }
    }
  }, [open])

  if (!open) return null

  const handleImport = async () => {
    setIsImporting(true)
    setImportError(null)
    const result = await importFromFile()
    setIsImporting(false)
    if (result && 'error' in result) {
      setImportError(result.error)
    }
  }

  const requestDelete = (id: string) => {
    if (confirmTimeoutRef.current) clearTimeout(confirmTimeoutRef.current)
    setConfirmDeleteId(id)
    confirmTimeoutRef.current = setTimeout(() => setConfirmDeleteId(null), 3000)
  }

  const confirmDelete = async (id: string) => {
    if (confirmTimeoutRef.current) clearTimeout(confirmTimeoutRef.current)
    setConfirmDeleteId(null)
    await remove(id)
  }

  const navItemClass = (active: boolean) =>
    `w-full flex items-center gap-2 px-2 py-1.5 rounded-md text-ui ${
      active
        ? 'bg-app-elevated text-app-accent-text font-semibold'
        : 'text-app-text-2 hover:text-app-text hover:bg-app-elevated'
    }`

  return createPortal(
    <div
      className="fixed inset-0 bg-black/40 z-[9999] flex items-center justify-center"
      onClick={onClose}
    >
      <div
        onClick={(e) => e.stopPropagation()}
        role="dialog"
        aria-modal="true"
        aria-labelledby="settings-modal-title"
        className="bg-app-surface border border-app-border rounded-xl shadow-app-card w-[640px] max-h-[80vh] flex overflow-hidden"
      >
        {/* Left nav */}
        <div className="w-[140px] bg-app-sidebar border-r border-app-border p-3 shrink-0">
          <div className="app-section-label mb-3">Settings</div>
          <button onClick={() => setSection('themes')} className={navItemClass(section === 'themes')}>
            <Palette size={13} />
            Themes
          </button>
          <button onClick={() => setSection('updates')} className={`mt-1 ${navItemClass(section === 'updates')}`}>
            <Download size={13} />
            Updates
            {updateAvailable && <span className="ml-auto w-2 h-2 rounded-full bg-app-accent" />}
          </button>
        </div>

        {/* Content */}
        <div className="flex-1 flex flex-col min-w-0">
          {section === 'themes' && (
            <>
              <div className="flex items-center justify-between px-4 py-3 border-b border-app-border">
                <div id="settings-modal-title" className="text-ui-md font-semibold text-app-text">Theme Library</div>
                <div className="flex items-center gap-2">
                  <button
                    onClick={handleImport}
                    disabled={isImporting}
                    className="flex items-center gap-1.5 px-2.5 py-1 bg-app-accent hover:bg-app-accent-hover disabled:opacity-50 text-white rounded-md text-ui font-medium transition-colors"
                  >
                    <Plus size={12} />
                    {isImporting ? 'Importing…' : 'Import…'}
                  </button>
                  <button
                    onClick={onClose}
                    aria-label="Close settings"
                    className="p-1.5 rounded-md text-app-text-3 hover:text-app-text hover:bg-app-elevated transition-colors"
                  >
                    <X size={14} />
                  </button>
                </div>
              </div>

              {importError && (
                <div className="mx-4 mt-3 px-3 py-2 bg-app-err-subtle text-app-err rounded-md text-ui">
                  {importError}
                </div>
              )}

              <div className="p-4 overflow-y-auto grid grid-cols-3 gap-3">
                {/* Built-in dark — always first, not deletable */}
                <ThemeCard
                  builtin
                  active={activeThemeId === null}
                  swatchColors={['#15110D', '#D97757', '#5BC98A', '#7AB3F0']}
                  name="Aperture Dark"
                  author="built-in"
                  onClick={() => setActive(null)}
                />
                <ThemeCard
                  builtin
                  active={activeThemeId === 'aperture-light'}
                  swatchColors={['#FAF7F1', '#C8633B', '#2E8B6A', '#2E6FB8']}
                  name="Aperture Light"
                  author="built-in"
                  onClick={() => setActive('aperture-light')}
                />

                {themes.map((theme) => (
                  <ThemeCard
                    key={theme.id}
                    active={activeThemeId === theme.id}
                    swatchColors={[
                      `#${theme.base.base00}`,
                      `#${theme.base.base09}`,
                      `#${theme.base.base0b}`,
                      `#${theme.base.base0d}`,
                    ]}
                    name={theme.name}
                    author={theme.author ?? 'imported'}
                    onClick={() => setActive(theme.id)}
                    onDelete={() => requestDelete(theme.id)}
                    confirmingDelete={confirmDeleteId === theme.id}
                    onConfirmDelete={() => confirmDelete(theme.id)}
                    onCancelDelete={() => setConfirmDeleteId(null)}
                  />
                ))}

                {/* Dashed-border import placeholder */}
                <button
                  onClick={handleImport}
                  disabled={isImporting}
                  className="border border-dashed border-app-border rounded-lg p-3 flex flex-col items-center justify-center gap-1.5 text-app-text-3 hover:text-app-text hover:border-app-border-2 transition-colors disabled:opacity-50"
                >
                  <Plus size={18} />
                  <span className="text-ui">Import theme</span>
                </button>
              </div>
            </>
          )}

          {section === 'updates' && <UpdatesSection onClose={onClose} />}
        </div>
      </div>
    </div>,
    document.body
  )
}

function UpdatesSection({ onClose }: { onClose: () => void }) {
  const status = useUpdateStore((s) => s.status)
  const checking = useUpdateStore((s) => s.checking)
  const checkNow = useUpdateStore((s) => s.checkNow)
  const [copied, setCopied] = useState(false)

  // Kick off a check the first time the panel is shown with no data yet.
  useEffect(() => {
    if (!status && !checking) void checkNow()
  }, [status, checking, checkNow])

  const copyXattr = async () => {
    await navigator.clipboard.writeText('xattr -cr /Applications/Aperture.app')
    setCopied(true)
    setTimeout(() => setCopied(false), 2000)
  }

  return (
    <>
      <div className="flex items-center justify-between px-4 py-3 border-b border-app-border">
        <div id="settings-modal-title" className="text-ui-md font-semibold text-app-text">Updates</div>
        <button
          onClick={onClose}
          aria-label="Close settings"
          className="p-1.5 rounded-md text-app-text-3 hover:text-app-text hover:bg-app-elevated transition-colors"
        >
          <X size={14} />
        </button>
      </div>

      <div className="p-4 overflow-y-auto flex flex-col gap-4">
        {/* Current version + manual check */}
        <div className="flex items-center justify-between">
          <div>
            <div className="app-section-label">Current version</div>
            <div className="text-ui-md font-semibold text-app-text font-tabular">
              {status?.currentVersion ?? '—'}
            </div>
          </div>
          <button
            onClick={() => void checkNow()}
            disabled={checking}
            className="flex items-center gap-1.5 px-2.5 py-1 bg-app-elevated hover:bg-app-border/40 disabled:opacity-50 text-app-text rounded-md text-ui font-medium transition-colors"
          >
            <RefreshCw size={12} className={checking ? 'animate-spin' : ''} />
            {checking ? 'Checking…' : 'Check for updates'}
          </button>
        </div>

        {/* Error */}
        {status?.error && (
          <div className="px-3 py-2 bg-app-err-subtle text-app-err rounded-md text-ui">
            Couldn't check for updates — {status.error}
          </div>
        )}

        {/* Up to date */}
        {status && !status.error && !status.updateAvailable && (
          <div className="flex items-center gap-2 px-3 py-2 bg-app-ok-subtle text-app-ok rounded-md text-ui">
            <Check size={14} />
            You're on the latest version.
          </div>
        )}

        {/* Update available */}
        {status?.updateAvailable && (
          <div className="flex flex-col gap-3 border border-app-accent rounded-lg p-3 bg-app-accent-subtle/40">
            <div className="flex items-start justify-between gap-3">
              <div>
                <div className="app-section-label">New version available</div>
                <div className="text-ui-md font-semibold text-app-text font-tabular">{status.latestVersion}</div>
                {status.publishedAt && (
                  <div className="text-ui-xs text-app-text-3">
                    Released {new Date(status.publishedAt).toLocaleDateString()}
                  </div>
                )}
              </div>
              <a
                href={status.dmgUrl ?? status.releaseUrl ?? '#'}
                target="_blank"
                rel="noreferrer"
                className="flex items-center gap-1.5 px-2.5 py-1 bg-app-accent hover:bg-app-accent-hover text-white rounded-md text-ui font-medium transition-colors shrink-0"
              >
                <Download size={12} />
                Download
              </a>
            </div>

            {status.releaseNotes && (
              <pre className="text-ui-xs text-app-text-2 whitespace-pre-wrap max-h-40 overflow-y-auto bg-app-surface rounded-md p-2 border border-app-border">
                {status.releaseNotes}
              </pre>
            )}

            {status.releaseUrl && (
              <a
                href={status.releaseUrl}
                target="_blank"
                rel="noreferrer"
                className="text-ui-xs text-app-accent-text hover:underline"
              >
                View release notes on GitHub →
              </a>
            )}

            {/* Un-notarized install hint */}
            <div className="text-ui-xs text-app-text-3 border-t border-app-border pt-2">
              After installing, if macOS says the app is “damaged”, run this once in Terminal:
              <div className="mt-1 flex items-center gap-2">
                <code className="flex-1 px-2 py-1 bg-app-surface border border-app-border rounded font-tabular text-app-text-2 truncate">
                  xattr -cr /Applications/Aperture.app
                </code>
                <button
                  onClick={copyXattr}
                  className="px-2 py-1 rounded bg-app-elevated hover:bg-app-border/40 text-app-text-2 text-ui-xs shrink-0"
                >
                  {copied ? 'Copied' : 'Copy'}
                </button>
              </div>
            </div>
          </div>
        )}
      </div>
    </>
  )
}

interface ThemeCardProps {
  active: boolean
  builtin?: boolean
  swatchColors: string[]
  name: string
  author: string
  onClick: () => void
  onDelete?: () => void
  confirmingDelete?: boolean
  onConfirmDelete?: () => void
  onCancelDelete?: () => void
}

function ThemeCard({
  active,
  builtin,
  swatchColors,
  name,
  author,
  onClick,
  onDelete,
  confirmingDelete,
  onConfirmDelete,
  onCancelDelete,
}: ThemeCardProps) {
  return (
    <div className="relative group">
      <button
        type="button"
        onClick={onClick}
        aria-pressed={active}
        className={`group relative cursor-pointer rounded-lg p-3 transition-colors text-left w-full ${
          active
            ? 'bg-app-accent-subtle border-2 border-app-accent'
            : 'bg-app-elevated border border-app-border hover:border-app-border-2'
        }`}
      >
        <div className="flex gap-1 mb-2">
          {swatchColors.map((c, i) => (
            <div
              key={i}
              className="w-5 h-5 rounded"
              style={{ backgroundColor: c, border: '1px solid rgba(0,0,0,0.05)' }}
            />
          ))}
        </div>
        <div className="text-ui font-semibold text-app-text truncate">{name}</div>
        <div className="text-ui-xs text-app-text-3 truncate">{author}</div>

        {active && (
          <div className="absolute top-2 right-2 app-dot" style={{ backgroundColor: 'rgb(var(--c-accent))' }} />
        )}
      </button>

      {!builtin && onDelete && (
        <>
          {confirmingDelete ? (
            <div className="absolute top-2 right-2 flex items-center gap-1 bg-app-surface rounded px-1 py-0.5 shadow-app-card">
              <button
                type="button"
                onClick={onCancelDelete}
                className="text-ui-xs px-1.5 py-0.5 text-app-text-2 hover:text-app-text"
              >
                No
              </button>
              <button
                type="button"
                onClick={onConfirmDelete}
                className="text-ui-xs px-1.5 py-0.5 rounded bg-app-err-subtle text-app-err"
              >
                Yes
              </button>
            </div>
          ) : (
            <button
              type="button"
              onClick={onDelete}
              className="absolute top-2 right-2 opacity-0 group-hover:opacity-100 p-1 rounded text-app-text-3 hover:text-app-err hover:bg-app-err-subtle/60 transition-all focus:opacity-100"
              title="Delete theme"
              aria-label={`Delete ${name}`}
            >
              <Trash2 size={11} />
            </button>
          )}
        </>
      )}
    </div>
  )
}
```

- [ ] **Step 2: Verify it compiles**

Run: `npm run typecheck`
Expected: no errors.

- [ ] **Step 3: Run the full test suite + coverage gate**

Run: `npm run test:coverage`
Expected: all tests pass (existing + the new `compareSemver`, `selectDmgAsset`, `checkForUpdate`, `updates` handler, and `updateStore` tests); coverage stays ≥70%.

- [ ] **Step 4: Manual smoke test**

Run: `just dev`
Verify:
- Open Settings (gear). A new "Updates" nav item appears under "Themes".
- The Updates panel shows the current version and "Check for updates"; clicking it shows either "You're on the latest version" or a new-version card (depending on the latest GitHub release).
- If a newer release exists, the gear shows a terracotta dot and the card's Download button opens the DMG in the browser.

- [ ] **Step 5: Commit**

```bash
git add src/renderer/src/components/settings/SettingsModal.tsx
git commit -m "✨ feat(updates): add Settings → Updates section"
```

---

## Task 10: Documentation

**Files:**
- Modify: `README.md`
- Modify: `CHANGELOG.md`
- Modify: `CLAUDE.md`

- [ ] **Step 1: README — add an "Updating Aperture" section**

In `README.md`, add a new section (place it near the installation / macOS security notes):

```markdown
## Updating Aperture

Aperture checks GitHub for new releases automatically (shortly after launch and
every 3 hours). When a newer version is available:

- A dot appears on the Settings (gear) icon.
- **Settings → Updates** shows the new version, release notes, and a **Download**
  button that fetches the right DMG for your Mac (Apple Silicon or Intel).
- You can also check on demand with the **Check for updates** button.

Because Aperture is distributed un-notarized, after installing a new version
macOS may warn that the app is "damaged". Clear the quarantine flag once:

```bash
xattr -cr /Applications/Aperture.app
```

(The Updates panel shows this command with a copy button.)
```

- [ ] **Step 2: CHANGELOG — add an Unreleased entry**

In `CHANGELOG.md`, under the `## [Unreleased]` heading (create it if absent, above the latest version), add:

```markdown
### Added
- In-app update notifier: Aperture checks GitHub Releases on launch and every 3
  hours, badges the Settings gear when a newer version exists, and adds a
  **Settings → Updates** section with release notes, a manual "Check for
  updates" button, and an arch-aware one-click DMG download. No code-signing or
  extra hosting required.
```

- [ ] **Step 3: CLAUDE.md — add a change-log entry**

In `CLAUDE.md`, add a new entry at the top of the "Change Log & Error Report" entries (right after the `---` that follows the Format section, before the most recent dated entry):

```markdown
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
```

- [ ] **Step 4: Commit**

```bash
git add README.md CHANGELOG.md CLAUDE.md
git commit -m "📝 docs: document the in-app update notifier"
```

---

## Final Verification

- [ ] **Run the full CI suite locally**

Run: `just ci`
Expected: typecheck passes, all tests pass, coverage ≥70%.

- [ ] **Confirm the feature end-to-end**

Run: `just dev`, open Settings → Updates, click "Check for updates", confirm the up-to-date / new-version states render and the gear badge tracks `updateAvailable`.
