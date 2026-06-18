# Auto-update notifier (GitHub "notify & redirect")

**Date:** 2026-06-18
**Status:** Approved (design)
**Author:** Aperture

## Problem

Aperture ships unsigned, un-notarized DMGs to GitHub Releases (tag-triggered via
`.github/workflows/release.yml`). Users have no way to learn that a newer version
exists; they must manually visit the repo. We want every user to be notified
in-app when a new release is deployed and be able to get it in one click.

## Hard constraint: no silent auto-update on macOS

Electron's standard auto-updater (`electron-updater` / Squirrel.Mac) refuses to
apply an update unless the app is code-signed with an Apple Developer ID
certificate. Aperture is intentionally **un-notarized** (no Apple Developer
Program enrollment; the release workflow even instructs users to run
`xattr -cr /Applications/Aperture.app` to clear the Gatekeeper "damaged app"
warning). There is no free path to notarization or the Mac App Store, and the
App Store sandbox is hostile to Aperture's needs (reading Google ADC credential
files, loading the unsigned `duckdb.node` native module, arbitrary outbound DB
connections).

Therefore this feature is a **notify-and-redirect updater**, not a silent
auto-updater: detect a newer release, surface it in-app, and open the correct
DMG in the user's browser for manual install.

## Goals

- Detect when a newer GitHub release exists, with zero new hosting infrastructure.
- Notify passively via an unobtrusive badge on the existing Settings gear.
- Provide a dedicated **Settings → Updates** section: current vs latest version,
  release notes, a one-click arch-aware **Download**, and a manual "Check for
  updates" button.
- Smooth the un-notarized install wall by showing the `xattr` fix inline.

## Non-goals (v1)

- Silent background download / install-on-relaunch (impossible un-notarized).
- `electron-updater`, delta updates, auto-applying updates.
- "Skip this version" / dismiss persistence — the badge simply reflects live
  state. Revisit only if it feels naggy.
- Windows/Linux-specific update UX (the core logic is cross-platform; only the
  macOS surface is built now).

## Architecture & data flow

The **main process owns the check** (no CORS, Node `fetch`, direct access to
`app.getVersion()` and `process.arch`). The renderer only renders state.

```
main: scheduler  (initial check ~5s after app.whenReady, then every 3h)
        └─ checkForUpdate()
             ├─ fetch https://api.github.com/repos/joao-victor-campos/aperture/releases/latest
             ├─ compareSemver(current, latest)
             └─ selectDmgAsset(assets, process.arch)
                  └─ push UPDATES_STATUS → renderer  (push channel, like QUERY_LOG)

renderer: updateStore (Zustand) ← latest UpdateStatus
            ├─ gear badge: app-accent dot when updateAvailable
            └─ Settings → Updates: details + Download + "Check for updates"

manual "Check for updates" → invoke UPDATES_CHECK → runs checkForUpdate() → returns result
```

`/releases/latest` is deliberately chosen because GitHub excludes drafts and
prereleases from it, so prerelease tags (those containing `-`, per the release
workflow) are ignored automatically.

## Components

### Update-check core (pure, unit-tested)

Location: `src/main/updates/` (mirrors the `src/main/db/` adapter split so the
fetch/parse logic is isolable and testable).

- `compareSemver(a: string, b: string): -1 | 0 | 1` — strips a leading `v`,
  compares `major.minor.patch` numerically. No new dependency. Returns `0` for
  unparseable input so a malformed tag never falsely reports an update.
- `selectDmgAsset(assets, arch): string | null` — picks the asset whose `name`
  ends with `-arm64.dmg` or `-x64.dmg` matching `process.arch` ('arm64' | 'x64').
  Returns `null` when no asset matches (caller falls back to the release
  `html_url`).
- `GITHUB_REPO = 'joao-victor-campos/aperture'` constant.

### Main process

- `src/main/updates/checkForUpdate.ts` — orchestrates fetch + compare + asset
  select, returns an `UpdateStatus`. Network/non-200/rate-limit failures resolve
  to an `UpdateStatus` with `error` set (never throws to the scheduler).
- `src/main/ipc/updates.ts` — registers the `UPDATES_CHECK` handler (runs
  `checkForUpdate`, returns the result) and exposes a helper to push
  `UPDATES_STATUS` to all renderer windows.
- `src/main/index.ts` — starts the scheduler after `whenReady`: one check ~5s
  after launch, then `setInterval` every 3h. Each tick pushes `UPDATES_STATUS`.
  Periodic failures are swallowed silently.

### Shared

- `src/shared/ipc.ts` — new channels:
  - `UPDATES_CHECK` (req/res): `{}` → `UpdateStatus`.
  - `UPDATES_STATUS` (push, no response): `UpdateStatus`.
- `src/shared/types.ts` — new `UpdateStatus`:
  ```ts
  interface UpdateStatus {
    currentVersion: string
    latestVersion: string | null
    updateAvailable: boolean
    dmgUrl: string | null      // arch-matched asset, or null
    releaseUrl: string | null  // release html_url
    releaseNotes: string | null
    publishedAt: string | null
    checkedAt: string          // ISO timestamp of this check
    error: string | null
  }
  ```

### Renderer

- `src/renderer/src/store/updateStore.ts` (new, Zustand) — holds the latest
  `UpdateStatus` and a `checking` flag. `checkNow()` invokes `UPDATES_CHECK`;
  the store subscribes to `UPDATES_STATUS` pushes. Wired into the existing
  app-boot eager-load path (alongside saved queries / history).
- `src/renderer/src/components/layout/TitleBar.tsx` — small `app-accent` dot on
  the Settings gear button when `updateAvailable`.
- `src/renderer/src/components/settings/SettingsModal.tsx` — new "Updates"
  left-nav entry **after "Themes"**. Content:
  - Current version vs latest version + published date.
  - "Check for updates" button with states: idle / checking / "Up to date" /
    error ("Couldn't check for updates" + retry).
  - When `updateAvailable`: release notes (plain text), a primary **Download**
    button (`shell.openExternal(dmgUrl ?? releaseUrl)`), and a "View release
    notes" link (`releaseUrl`).
  - Un-notarized install hint: `xattr -cr /Applications/Aperture.app` with a
    copy button.

## Error handling

- Manual check failure → Updates section shows "Couldn't check for updates" +
  retry; `UpdateStatus.error` carries the raw message.
- Periodic check failure → silent (no badge, no nag); retried next 3h tick.
- Non-200 / rate-limit (GitHub unauthenticated: 60 req/hr/IP, far above our
  cadence) → treated as a check failure, scheduler keeps running.
- Unparseable version → `compareSemver` returns `0`, so no false "update
  available".

## Testing (respects the 70% coverage gate)

- `compareSemver` — newer / older / equal / `v` prefix / malformed.
- `selectDmgAsset` — arm64 match, x64 match, no-match → null.
- `checkForUpdate` / `updates.ts` handler — mocked `fetch`: update available,
  up-to-date, network error, no matching asset.
- `updateStore` — `checkNow` success, `checkNow` error, `UPDATES_STATUS` push
  handling.

`src/main/ipc/**` and `src/renderer/src/store/**` are inside the coverage
include set, so the handler and store need tests; `src/main/updates/**` pure
helpers are tested directly.

## Documentation

- `README.md` — add an "Updating Aperture" note (in-app check + manual install +
  `xattr` step).
- `CHANGELOG.md` — Unreleased entry.
- `CLAUDE.md` — change-log entry per project convention.
