# Theme Import — Design Spec

**Date:** 2026-06-06
**Status:** Approved (brainstorming complete)
**Branch:** `feat/theme-import`

## Context

Aperture currently ships with exactly two themes — light and dark — both hardcoded as CSS custom properties in `index.css` (Direction D · Hybrid: warm-paper/coffee palette with a terracotta accent). A `Sun`/`Moon` toggle in the title bar flips a `.dark` class on `<html>`, and the preference is persisted in `localStorage`.

Users want the ability to bring their own colour schemes — specifically, themes from the wider open-source community. This spec covers importing **Base16** theme files (the dominant cross-application theme standard, with hundreds of existing community themes — Dracula, Nord, Gruvbox, Catppuccin, Solarized, Tokyo Night, etc.) and managing them in a simple **theme library**.

## Goals

- Let users import Base16 theme files (JSON or YAML) from disk
- Maintain a library of imported themes that can be browsed, previewed, switched between, and removed
- Replace the existing light/dark toggle entirely — each imported theme is a complete, self-contained palette; users pick whichever one they want, dark or light
- Always allow reverting to the built-in "Aperture Default" theme (the existing warm-paper/terracotta look)
- Mathematically derive Aperture's full ~30-token palette (including semantic "subtle" variants) from just the 16 Base16 colours, so any valid theme produces a coherent result with zero manual tuning

## Non-goals

- Authoring/editing themes in-app (import only, no theme editor)
- Syncing themes across devices/cloud
- Supporting other theme formats (VS Code themes, Catppuccin's native format, etc.) — Base16 only for v1
- Per-component theme overrides — a theme is applied globally

## Architecture overview

Themes follow the exact same storage pattern as connections and saved queries: persisted in `aperture-store.json` via the existing `store.ts`, exposed to the renderer through typed IPC channels, and managed by a Zustand store that mirrors `connectionStore` / `savedQueryStore`.

```
[User clicks "Import…" in Settings → Themes]
        │
        ▼
SettingsModal (renderer)
   → themeStore.importFromFile()
        │  IPC: THEMES_OPEN_FILE_DIALOG  (native file picker, returns parsed+validated theme)
        │  IPC: THEMES_ADD               (persists, returns Theme with generated id)
        ▼
src/main/ipc/themes.ts
   → store.set('themes', [...themes, newTheme])
        │
        ▼
themeStore updates `themes` array
   (theme is NOT auto-activated — user clicks a card to apply it)

[User clicks a theme card]
        │
        ▼
themeStore.setActive(id)
        │  IPC: THEMES_SET_ACTIVE
        ▼
store.set('activeThemeId', id)
        │
        ▼
applyTheme(theme) → computes CSS variables → injects <style id="aperture-theme">
        │
        ▼
App re-renders instantly (all components reference rgb(var(--c-*)))
```

## Data model

### `Theme` type (added to `src/shared/types.ts`)

```ts
interface Theme {
  id: string                      // uuid, generated on import
  name: string                    // from Base16 "scheme" field
  author?: string                 // from Base16 "author" field
  base: Record<string, string>    // base00–base0F → lowercase hex strings, no leading '#'
  importedAt: string              // ISO 8601 timestamp
}
```

### `StoreData` extension (`src/main/db/store.ts`)

```ts
interface StoreData {
  // ...existing fields (connections, savedQueries, folders, historyEntries)
  themes: Theme[]                 // default: []
  activeThemeId: string | null    // default: null  (null = built-in "Aperture Default")
}
```

`activeThemeId: null` is a first-class state, not an edge case — it means "use the built-in theme defined in `index.css`." This guarantees users can always get back to the default look without needing to keep an "Aperture Default" entry in the imported list. The Settings UI shows a non-deletable "Aperture Default" card that, when clicked, sets `activeThemeId` back to `null`.

## IPC contract

Five new channels added to `src/shared/ipc.ts`, following the request/response shape of `CONNECTIONS_*`:

| Channel | Request | Response | Notes |
|---|---|---|---|
| `THEMES_LIST` | `void` | `{ themes: Theme[]; activeThemeId: string \| null }` | Loaded once at app start |
| `THEMES_OPEN_FILE_DIALOG` | `void` | `{ scheme: string; author?: string; base: Record<string,string> } \| { error: string }` | Opens native file picker, reads + parses + validates the chosen file. Returns a structured error (not a thrown exception) on invalid files so the UI can show an inline message |
| `THEMES_ADD` | `{ scheme: string; author?: string; base: Record<string,string> }` | `Theme` | Persists a validated theme payload (generates `id` + `importedAt`) |
| `THEMES_REMOVE` | `string` (theme id) | `void` | If the removed theme was active, resets `activeThemeId` to `null` |
| `THEMES_SET_ACTIVE` | `string \| null` (theme id, or `null` for built-in) | `void` | Persists the active theme selection |

**Why split `THEMES_OPEN_FILE_DIALOG` from `THEMES_ADD`** rather than one combined "import" call: it lets the renderer show a confirmation/preview step between picking the file and committing it to the library (and keeps the file-system/dialog concern cleanly separable from the persistence concern, mirroring how `CONNECTIONS_TEST` is separate from `CONNECTIONS_ADD`).

### File parsing & validation (main process)

- Supported extensions: `.json`, `.yaml`, `.yml` (parsed via `js-yaml`, which handles JSON as a YAML subset — no need for a separate JSON path)
- A file is a valid Base16 theme if, after parsing, it is an object containing all sixteen keys `base00`...`base0F`, each a 6-character hex string (case-insensitive, optional leading `#` stripped and re-normalized to lowercase)
- `scheme` and `author` are optional; if `scheme` is missing, fall back to the filename (without extension) as the theme name
- Any failure (file unreadable, invalid YAML/JSON, missing/malformed colour keys) returns `{ error: string }` with a human-readable message — never throws across the IPC boundary

## Token mapping — Base16 → Aperture CSS variables

This is the core of the feature: a pure function `applyTheme(theme: Theme | null): void` in `src/renderer/src/lib/applyTheme.ts` that deterministically derives Aperture's entire palette from 16 input colours. Passing `null` (the built-in default state) removes any injected override — see "Output: CSS injection" below.

### Direct mappings

| Base16 slot | Standard meaning | Aperture token(s) |
|---|---|---|
| `base00` | Default background | `--c-bg` |
| `base01` | Lighter background (status bars, gutters) | `--c-sidebar` |
| `base02` | Selection background | `--c-surface`, `--c-elevated` |
| `base03` | Comments, invisibles | `--c-border`, `--c-text-4` |
| `base04` | Dark foreground (status bars) | `--c-border-2`, `--c-text-3` |
| `base05` | Default foreground | `--c-text` |
| `base06` | Light foreground | `--c-text-2` |
| `base07` | Light background | *(unused — rarely differs meaningfully from base06/02 in practice)* |
| `base08` | Variables, diff-deleted (red) | `--c-state-err` |
| `base09` | Integers, constants (orange) | `--c-accent`, `--c-accent-text` |
| `base0A` | Classes, search bg (yellow) | `--c-state-warn` |
| `base0B` | Strings, diff-inserted (green) | `--c-state-ok`, `--c-cat-green` |
| `base0C` | Support, regex (cyan) | `--c-cat-blue` *(fallback only — see note)* |
| `base0D` | Functions, headings (blue) | `--c-cat-blue` |
| `base0E` | Keywords, storage (purple) | `--c-cat-purple` |
| `base0F` | Deprecated, embedded tags | `--c-accent-hover` blend source |

Note: `base0C` and `base0D` both trend toward the "blue/cyan" family across most Base16 themes; `base0D` (functions/headings — typically the more prominent of the two) is used as the primary source for `--c-cat-blue`, with `base0C` available as a fallback if `base0D` is absent (some older/minimal scheme files omit slots).

### Derived ("subtle") tokens — computed via linear blending

Aperture's design system pairs every semantic colour with a low-opacity "subtle" background variant (`app-accent-subtle`, `app-ok-subtle`, `app-err-subtle`, etc.) for badges, banners, and highlighted rows. Because the app's CSS custom properties are stored as bare `R G B` triplets (to support Tailwind's `/<alpha>` opacity modifiers against an opaque background), these subtle variants are pre-blended opaque colours rather than alpha-transparent ones.

We compute them with a simple linear interpolation toward the background:

```ts
type RGB = [number, number, number]

function hexToRgb(hex: string): RGB {
  const clean = hex.replace(/^#/, '')
  return [
    parseInt(clean.slice(0, 2), 16),
    parseInt(clean.slice(2, 4), 16),
    parseInt(clean.slice(4, 6), 16),
  ]
}

function blend(bg: RGB, fg: RGB, alpha: number): string {
  return [0, 1, 2]
    .map((i) => Math.round(bg[i] * (1 - alpha) + fg[i] * alpha))
    .join(' ')
}
```

| Derived token | Formula |
|---|---|
| `--c-accent-subtle` | `blend(base00, base09, 0.14)` |
| `--c-accent-sub-2` | `blend(base00, base09, 0.22)` |
| `--c-accent-hover` | `blend(base09, base0F, 0.35)` |
| `--c-state-ok-subtle` | `blend(base00, base0B, 0.18)` |
| `--c-state-warn-subtle` | `blend(base00, base0A, 0.18)` |
| `--c-state-err-subtle` | `blend(base00, base08, 0.18)` |
| `--c-cat-blue-subtle` | `blend(base00, base0D, 0.16)` |

The exact alpha constants above were chosen to visually approximate the existing built-in theme's subtle-token relationships (e.g. comparing `--c-state-ok` `46 139 106` against `--c-state-ok-subtle` `215 234 226` over background `250 247 241` yields ≈18% blend). They are starting points to be fine-tuned during implementation against 2–3 real community themes (Dracula, Nord, Gruvbox) for visual sanity, but the formula and architecture are fixed.

### Output: CSS injection

`applyTheme` builds a single CSS text block of the form:

```css
:root {
  --c-bg: 40 42 54;
  --c-sidebar: 33 34 44;
  /* ...all ~30 variables... */
}
```

...and writes it into a `<style id="aperture-theme">` element in `<head>` (created on first use, its `textContent` replaced on every subsequent call). Because this `:root` block is injected *after* `index.css` in the cascade, its declarations win over the built-in `:root` values — and since themes are self-contained, `applyTheme` also removes the `.dark` class from `<html>` so the built-in `.dark` overrides never combine with an imported theme.

Calling `applyTheme(null)` — used when `activeThemeId` is `null` — removes the injected `<style>` tag entirely, restoring the built-in `index.css` `:root`/`.dark` defaults untouched. As covered in "Removing the light/dark toggle" below, the light/dark toggle goes away entirely and `.dark` becomes Aperture's permanent built-in look; `applyTheme` therefore never needs to add or remove the `.dark` class for the `null` case — it only removes `.dark` when activating an *imported* theme (so the imported palette isn't combined with the built-in dark overrides).

## UI design

### Settings modal (`src/renderer/src/components/settings/SettingsModal.tsx`)

A new modal, portal-rendered to `document.body`, opened via:
- A `⚙` gear icon button in the title bar (replacing the removed Sun/Moon toggle, same slot/size)
- A "Settings" action in the ⌘K command palette

Structure: a left-hand nav column (currently just **Themes**, architected to support future sections like **Shortcuts** or **General** without rework) and a content area.

**Themes section — card grid layout:**
- A 3-column responsive grid of theme cards
- Each card shows: a small swatch cluster (background + 3 representative accent colours: accent/base09, ok/base0B, a categorical colour), theme name, author (or "built-in" for the default)
- The active theme's card has a terracotta border + a small active-indicator dot
- The built-in **"Aperture Default"** card is always first, never deletable, and always shows the current built-in palette swatches
- A trash icon appears on hover for imported (non-default) cards; clicking it removes the theme (with the same lightweight inline confirm pattern used for connection deletion — "Delete? No / Yes" with a 3s auto-dismiss)
- An **"+ Import…"** button in the section header (and a dashed-border placeholder card in the grid) triggers the file-picker flow

**Interaction model:**
- Clicking **anywhere on a card** (other than the trash icon) immediately activates that theme — no separate "Apply" step. This matches the instant-feedback feel of the existing light/dark toggle and lets users preview themes by clicking through the library.
- Newly imported themes are added to the grid but **not** auto-activated — the user explicitly picks a card to apply it. (This avoids a jarring palette swap immediately after a multi-second file-picker interaction, and lets users build a collection before committing to one.)

## Removing the light/dark toggle

Since each Base16 theme is a complete, self-contained palette (a "Solarized Light" theme is just as valid an import as "Dracula"), the light/dark toggle becomes redundant — the theme library *is* the theme control.

- **`App.tsx`**: remove `isDark` state, the `useEffect` managing the `.dark` class + `localStorage['theme']`, and the `onToggleTheme`/`isDark` props passed down. Add `themeStore.load()` on mount (which also triggers the initial `applyTheme` call for the persisted active theme) and render `<SettingsModal>`.
- **`TitleBar.tsx`**: remove the `isDark`/`onToggleTheme` props and the `Sun`/`Moon` button; add a `⚙` button in the same position that calls a new `onOpenSettings` prop.
- **`CommandPalette.tsx`**: replace any toggle-theme action with a "Settings" action that calls `onShowSettings`.
- **`index.css`**: the existing `:root` and `.dark` blocks are **not deleted** — they remain the built-in default palette. The `html { @apply dark; }` base rule stays, making dark the permanent built-in look (consistent with the app's current default-to-dark behaviour). Users who prefer a light look simply import/pick a light Base16 theme (e.g. "Solarized Light", "GitHub Light", "Gruvbox Light").

## Tests

Following the existing Vitest + AAA + mocked-IPC conventions:

- **`src/__tests__/main/ipc/themes.test.ts`** (~8 tests): `THEMES_LIST` (empty store; populated store), `THEMES_ADD` (generates id/timestamp, persists), `THEMES_REMOVE` (removes existing; no-op on unknown id; resets `activeThemeId` when removing the active theme), `THEMES_SET_ACTIVE` (persists a valid id; persists `null`), `THEMES_OPEN_FILE_DIALOG` (valid JSON; valid YAML; invalid/missing keys → structured error; user-cancelled dialog → no-op)
- **`src/__tests__/renderer/store/themeStore.test.ts`** (~6 tests): initial state, `load()` (populates `themes`/`activeThemeId` and triggers `applyTheme`), `importFromFile()` (happy path; surfaces error from main without throwing), `remove()` (removes from list; resets active selection locally if the removed theme was active), `setActive()` (persists + applies)
- **`src/__tests__/renderer/lib/applyTheme.test.ts`** (~8 tests): `hexToRgb` parsing (with/without `#`, case-insensitivity), `blend` math (verifies exact interpolated values against known inputs), full mapping spot-checks (`base09` → `--c-accent`, `base0B` → `--c-state-ok`, etc.), `<style>` tag lifecycle (created on first call, content replaced on second call, removed entirely when called with `null`), `.dark` class removal when a theme is applied

Coverage target: maintain the existing ≥70% threshold (current overall coverage is ~84%; these are all new, fully-unit-testable modules that should land at or near 100%).

## Files summary

### New files
| File | Purpose |
|---|---|
| `src/main/ipc/themes.ts` | IPC handlers: list/add/remove/set-active/open-file-dialog |
| `src/renderer/src/lib/applyTheme.ts` | Pure token-mapping + CSS injection |
| `src/renderer/src/store/themeStore.ts` | Zustand store mirroring `connectionStore` |
| `src/renderer/src/components/settings/SettingsModal.tsx` | Modal shell + Themes section (card grid) |
| `src/__tests__/main/ipc/themes.test.ts` | IPC handler tests |
| `src/__tests__/renderer/store/themeStore.test.ts` | Store tests |
| `src/__tests__/renderer/lib/applyTheme.test.ts` | Token-mapping tests |

### Modified files
| File | Change |
|---|---|
| `src/shared/ipc.ts` | Add `THEMES_LIST`, `THEMES_ADD`, `THEMES_REMOVE`, `THEMES_SET_ACTIVE`, `THEMES_OPEN_FILE_DIALOG` channels |
| `src/shared/types.ts` | Add `Theme` interface |
| `src/main/db/store.ts` | Add `themes: Theme[]`, `activeThemeId: string \| null` to `StoreData` + defaults |
| `src/main/ipc/index.ts` | Register the new themes handlers |
| `src/renderer/src/App.tsx` | Remove toggle state/effects; load themes on mount; render `SettingsModal` |
| `src/renderer/src/components/layout/TitleBar.tsx` | Replace Sun/Moon toggle with `⚙` settings button |
| `src/renderer/src/components/command/CommandPalette.tsx` | Replace/add "Settings" action |
| `package.json` | Add `js-yaml` (+ `@types/js-yaml` devDependency) |
| `CHANGELOG.md` | Unreleased entry |
| `CLAUDE.md` | Change-log entry per project convention |

## Open questions / risks (acknowledged, not blocking)

- **Blend-alpha tuning**: the constants in the derived-token table are starting points; implementation should visually sanity-check against a few real themes and adjust if "subtle" surfaces look too strong/weak. This is a tuning pass, not an architectural question.
- **`base07`/`base0C` underuse**: two Base16 slots aren't directly mapped (or are used only as fallbacks). This is intentional — Aperture has fewer semantic surfaces than Base16 has slots — and matches how many other Base16 consumers handle the mapping (not every slot maps 1:1 to every app's design system).
