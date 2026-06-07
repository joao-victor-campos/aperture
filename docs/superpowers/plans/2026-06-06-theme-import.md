# Theme Import Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Let users import Base16 community theme files into a managed theme library that replaces the existing light/dark toggle.

**Architecture:** Imported themes are persisted in the existing `aperture-store.json` file via the main process, surfaced to the renderer through five typed IPC channels, and applied by injecting a `<style id="aperture-theme">` block that overrides the CSS custom properties defined in `index.css`. A pure `applyTheme` utility computes Aperture's ~30-token palette (including derived "subtle" variants) from just the 16 Base16 colours via linear-blend math.

**Tech Stack:** TypeScript, Electron IPC, Zustand, React, Tailwind, Vitest, `js-yaml` (new dependency).

**Spec:** [`docs/superpowers/specs/2026-06-06-theme-import-design.md`](../specs/2026-06-06-theme-import-design.md)

**Branch:** `feat/theme-import` (already checked out, cut from `master`, with `.gitignore` updated to ignore `.superpowers/`)

---

## File Map

**New files (7):**
- `src/main/ipc/themes.ts` — IPC handlers (list/add/remove/set-active/open-file-dialog)
- `src/renderer/src/lib/applyTheme.ts` — Pure token-mapping + CSS injection
- `src/renderer/src/store/themeStore.ts` — Zustand store
- `src/renderer/src/components/settings/SettingsModal.tsx` — Modal + Themes section
- `src/__tests__/main/ipc/themes.test.ts` — IPC handler tests
- `src/__tests__/renderer/store/themeStore.test.ts` — Store tests
- `src/__tests__/renderer/lib/applyTheme.test.ts` — Token-mapping tests

**Modified files (10):**
- `src/shared/types.ts` — add `Theme`
- `src/shared/ipc.ts` — add 5 `THEMES_*` channels + `IpcMap` entries
- `src/main/db/store.ts` — add `themes` + `activeThemeId` to `StoreData`
- `src/main/ipc/index.ts` — register themes handlers
- `src/renderer/src/App.tsx` — remove toggle, mount themes, render SettingsModal
- `src/renderer/src/components/layout/TitleBar.tsx` — replace Sun/Moon with ⚙ gear
- `src/renderer/src/components/command/CommandPalette.tsx` — replace toggle-theme action with "Settings"
- `package.json` — add `js-yaml` + `@types/js-yaml`
- `CHANGELOG.md` — Unreleased entry
- `CLAUDE.md` — change-log entry

---

## Task 1: Dependencies + shared types

**Files:**
- Modify: `package.json`
- Modify: `src/shared/types.ts`
- Modify: `src/shared/ipc.ts`

- [ ] **Step 1.1: Install `js-yaml` (parses Base16 themes — handles JSON as YAML subset)**

```bash
npm install js-yaml@^4.1.0
npm install --save-dev @types/js-yaml@^4.0.9
```

Expected: package.json gains `js-yaml` in `dependencies` and `@types/js-yaml` in `devDependencies`; lockfile updates.

- [ ] **Step 1.2: Add `Theme` interface to `src/shared/types.ts`**

Append after the `HistoryEntry` interface (last interface in file):

```ts
/**
 * An imported Base16 colour theme. Persisted via the main store.
 * `base` is a map of Base16 slot keys ("base00"–"base0F") to lowercase
 * hex strings without a leading `#`.
 */
export interface Theme {
  id: string
  name: string
  author?: string
  base: Record<string, string>
  importedAt: string
}

/** Validated Base16 payload returned from the file-dialog IPC. */
export interface ThemeImportPayload {
  scheme: string
  author?: string
  base: Record<string, string>
}
```

- [ ] **Step 1.3: Add THEMES_* channels to `src/shared/ipc.ts`**

Update the top import:

```ts
import type { Connection, ConnectionCreate, Dataset, Table, TableField, TableSearchHit, QueryResult, SavedQuery, Folder, HistoryEntry, Theme, ThemeImportPayload } from './types'
```

Add after the `EXPORT_RESULTS` line in the `CHANNELS` object (before the closing `} as const`):

```ts
  // Themes
  THEMES_LIST: 'themes:list',
  THEMES_OPEN_FILE_DIALOG: 'themes:open-file-dialog',
  THEMES_ADD: 'themes:add',
  THEMES_REMOVE: 'themes:remove',
  THEMES_SET_ACTIVE: 'themes:set-active',
```

Add the matching `IpcMap` entries after the `EXPORT_RESULTS` entry:

```ts
  [CHANNELS.THEMES_LIST]: {
    req: undefined
    res: { themes: Theme[]; activeThemeId: string | null }
  }
  [CHANNELS.THEMES_OPEN_FILE_DIALOG]: {
    req: undefined
    res: ThemeImportPayload | { error: string }
  }
  [CHANNELS.THEMES_ADD]: { req: ThemeImportPayload; res: Theme }
  [CHANNELS.THEMES_REMOVE]: { req: string; res: void }
  [CHANNELS.THEMES_SET_ACTIVE]: { req: string | null; res: void }
```

- [ ] **Step 1.4: Verify typecheck**

```bash
npx tsc --noEmit
```

Expected: no output (clean compile).

- [ ] **Step 1.5: Commit**

```bash
git add package.json package-lock.json src/shared/types.ts src/shared/ipc.ts
git commit -m "feat(themes): add Theme type + THEMES_* IPC channels"
```

---

## Task 2: Extend the persistent store

**Files:**
- Modify: `src/main/db/store.ts`

- [ ] **Step 2.1: Add `themes` and `activeThemeId` to `StoreData`**

Update `src/main/db/store.ts`:

```ts
import { app } from 'electron'
import { join } from 'path'
import { readFileSync, writeFileSync, existsSync, mkdirSync } from 'fs'
import type { Connection, SavedQuery, Folder, HistoryEntry, Theme } from '../../shared/types'

interface StoreData {
  connections: Connection[]
  savedQueries: SavedQuery[]
  folders: Folder[]
  historyEntries: HistoryEntry[]
  themes: Theme[]
  activeThemeId: string | null
}

const DEFAULTS: StoreData = {
  connections: [],
  savedQueries: [],
  folders: [],
  historyEntries: [],
  themes: [],
  activeThemeId: null,
}
```

Leave the rest of the file unchanged — the generic `get<K>`/`set<K>` accessors automatically handle the new keys.

- [ ] **Step 2.2: Verify existing store tests still pass**

```bash
npx vitest run src/__tests__/main/db/store.test.ts
```

Expected: 5 tests pass.

- [ ] **Step 2.3: Commit**

```bash
git add src/main/db/store.ts
git commit -m "feat(themes): extend StoreData with themes and activeThemeId"
```

---

## Task 3: IPC handler tests (TDD — failing first)

**Files:**
- Create: `src/__tests__/main/ipc/themes.test.ts`

- [ ] **Step 3.1: Write the full test file**

Create `src/__tests__/main/ipc/themes.test.ts`:

```ts
/**
 * themes.test.ts
 * Tests the IPC theme handlers (src/main/ipc/themes.ts).
 * ipcMain, dialog, fs, and store are fully mocked.
 */
import { describe, it, expect, vi, beforeEach } from 'vitest'
import { CHANNELS } from '../../../shared/ipc'
import type { Theme, ThemeImportPayload } from '../../../shared/types'

// ── Capture ipcMain.handle registrations ────────────────────────────────────
type Handler = (event: unknown, req?: unknown) => unknown
const handlers = new Map<string, Handler>()

const mockShowOpenDialog = vi.fn()

vi.mock('electron', () => ({
  ipcMain: {
    handle: (channel: string, fn: Handler) => handlers.set(channel, fn),
  },
  dialog: {
    showOpenDialog: (...args: unknown[]) => mockShowOpenDialog(...args),
  },
  app: { getPath: () => '/tmp' },
}))

const mockReadFileSync = vi.fn()
vi.mock('fs', () => ({
  readFileSync: (...args: unknown[]) => mockReadFileSync(...args),
  writeFileSync: vi.fn(),
  existsSync: vi.fn(() => false),
  mkdirSync: vi.fn(),
}))

// ── Mock: store ──────────────────────────────────────────────────────────────
let storedThemes: Theme[] = []
let storedActiveId: string | null = null

vi.mock('../../../main/db/store', () => ({
  store: {
    get: vi.fn((key: string) => {
      if (key === 'themes') return storedThemes
      if (key === 'activeThemeId') return storedActiveId
      return undefined
    }),
    set: vi.fn((key: string, value: unknown) => {
      if (key === 'themes') storedThemes = value as Theme[]
      if (key === 'activeThemeId') storedActiveId = value as string | null
    }),
  },
}))

// ── Helpers ──────────────────────────────────────────────────────────────────
function validBase16(): Record<string, string> {
  const slots: Record<string, string> = {}
  for (let i = 0; i <= 0x0f; i++) {
    const key = `base0${i.toString(16).toUpperCase()}`
    slots[key] = `${i.toString(16)}${i.toString(16)}${i.toString(16)}${i.toString(16)}${i.toString(16)}${i.toString(16)}`
  }
  return slots
}

function makeTheme(id = 't1', name = 'Test Theme'): Theme {
  return {
    id,
    name,
    base: validBase16(),
    importedAt: '2026-06-06T00:00:00.000Z',
  }
}

describe('Theme IPC handlers', () => {
  beforeEach(async () => {
    handlers.clear()
    storedThemes = []
    storedActiveId = null
    vi.clearAllMocks()
    const { registerThemeHandlers } = await import('../../../main/ipc/themes')
    registerThemeHandlers()
  })

  describe(CHANNELS.THEMES_LIST, () => {
    it('returns themes and activeThemeId from the store', async () => {
      storedThemes = [makeTheme()]
      storedActiveId = 't1'
      const handler = handlers.get(CHANNELS.THEMES_LIST)!

      const result = await handler({})

      expect(result).toEqual({ themes: storedThemes, activeThemeId: 't1' })
    })

    it('returns empty list + null when store is empty', async () => {
      const handler = handlers.get(CHANNELS.THEMES_LIST)!

      const result = await handler({})

      expect(result).toEqual({ themes: [], activeThemeId: null })
    })
  })

  describe(CHANNELS.THEMES_ADD, () => {
    it('persists the theme with a generated id + importedAt timestamp', async () => {
      const handler = handlers.get(CHANNELS.THEMES_ADD)!
      const payload: ThemeImportPayload = {
        scheme: 'Dracula',
        author: 'Zeno Rocha',
        base: validBase16(),
      }

      const result = (await handler({}, payload)) as Theme

      expect(result.id).toBeTruthy()
      expect(result.name).toBe('Dracula')
      expect(result.author).toBe('Zeno Rocha')
      expect(result.importedAt).toBeTruthy()
      expect(storedThemes).toHaveLength(1)
    })

    it('appends to an existing list without disturbing others', async () => {
      storedThemes = [makeTheme('existing', 'Existing')]
      const handler = handlers.get(CHANNELS.THEMES_ADD)!

      await handler({}, { scheme: 'New', base: validBase16() } as ThemeImportPayload)

      expect(storedThemes).toHaveLength(2)
      expect(storedThemes[0].id).toBe('existing')
    })
  })

  describe(CHANNELS.THEMES_REMOVE, () => {
    it('removes the theme by id', async () => {
      storedThemes = [makeTheme('t1'), makeTheme('t2')]
      const handler = handlers.get(CHANNELS.THEMES_REMOVE)!

      await handler({}, 't1')

      expect(storedThemes).toHaveLength(1)
      expect(storedThemes[0].id).toBe('t2')
    })

    it('resets activeThemeId to null when removing the active theme', async () => {
      storedThemes = [makeTheme('t1')]
      storedActiveId = 't1'
      const handler = handlers.get(CHANNELS.THEMES_REMOVE)!

      await handler({}, 't1')

      expect(storedActiveId).toBeNull()
    })

    it('is a no-op when the id is not in the store', async () => {
      storedThemes = [makeTheme('t1')]
      const handler = handlers.get(CHANNELS.THEMES_REMOVE)!

      await handler({}, 'unknown')

      expect(storedThemes).toHaveLength(1)
    })
  })

  describe(CHANNELS.THEMES_SET_ACTIVE, () => {
    it('persists a non-null theme id', async () => {
      const handler = handlers.get(CHANNELS.THEMES_SET_ACTIVE)!

      await handler({}, 't1')

      expect(storedActiveId).toBe('t1')
    })

    it('persists null to reset to the built-in default', async () => {
      storedActiveId = 't1'
      const handler = handlers.get(CHANNELS.THEMES_SET_ACTIVE)!

      await handler({}, null)

      expect(storedActiveId).toBeNull()
    })
  })

  describe(CHANNELS.THEMES_OPEN_FILE_DIALOG, () => {
    it('parses a valid JSON Base16 file', async () => {
      const themeBody = { scheme: 'Test JSON', author: 'Alice', ...validBase16() }
      mockShowOpenDialog.mockResolvedValueOnce({
        canceled: false,
        filePaths: ['/tmp/test.json'],
      })
      mockReadFileSync.mockReturnValueOnce(JSON.stringify(themeBody))
      const handler = handlers.get(CHANNELS.THEMES_OPEN_FILE_DIALOG)!

      const result = (await handler({})) as ThemeImportPayload

      expect(result.scheme).toBe('Test JSON')
      expect(result.author).toBe('Alice')
      expect(result.base.base00).toBe('000000')
      expect(Object.keys(result.base)).toHaveLength(16)
    })

    it('parses a valid YAML Base16 file', async () => {
      const yaml = `scheme: "Test YAML"
author: "Bob"
${Array.from({ length: 16 }, (_, i) => {
  const k = `base0${i.toString(16).toUpperCase()}`
  const v = `${i.toString(16)}${i.toString(16)}${i.toString(16)}${i.toString(16)}${i.toString(16)}${i.toString(16)}`
  return `${k}: "${v}"`
}).join('\n')}
`
      mockShowOpenDialog.mockResolvedValueOnce({
        canceled: false,
        filePaths: ['/tmp/test.yaml'],
      })
      mockReadFileSync.mockReturnValueOnce(yaml)
      const handler = handlers.get(CHANNELS.THEMES_OPEN_FILE_DIALOG)!

      const result = (await handler({})) as ThemeImportPayload

      expect(result.scheme).toBe('Test YAML')
      expect(result.author).toBe('Bob')
      expect(Object.keys(result.base)).toHaveLength(16)
    })

    it('returns a structured error when a required slot is missing', async () => {
      const incomplete = { scheme: 'Bad', base00: '000000' } // missing base01-base0F
      mockShowOpenDialog.mockResolvedValueOnce({
        canceled: false,
        filePaths: ['/tmp/bad.json'],
      })
      mockReadFileSync.mockReturnValueOnce(JSON.stringify(incomplete))
      const handler = handlers.get(CHANNELS.THEMES_OPEN_FILE_DIALOG)!

      const result = (await handler({})) as { error: string }

      expect(result.error).toMatch(/base16/i)
    })

    it('returns a structured error when the file cannot be parsed', async () => {
      mockShowOpenDialog.mockResolvedValueOnce({
        canceled: false,
        filePaths: ['/tmp/garbage.json'],
      })
      mockReadFileSync.mockReturnValueOnce('{ this is: not valid json: at all }')
      const handler = handlers.get(CHANNELS.THEMES_OPEN_FILE_DIALOG)!

      const result = (await handler({})) as { error: string }

      expect(result.error).toBeTruthy()
    })

    it('returns null payload when the user cancels the dialog', async () => {
      mockShowOpenDialog.mockResolvedValueOnce({
        canceled: true,
        filePaths: [],
      })
      const handler = handlers.get(CHANNELS.THEMES_OPEN_FILE_DIALOG)!

      const result = await handler({})

      expect(result).toBeNull()
    })

    it('normalizes hex strings to lowercase and strips leading #', async () => {
      const themeBody = {
        scheme: 'Norm',
        ...Object.fromEntries(
          Array.from({ length: 16 }, (_, i) => {
            const k = `base0${i.toString(16).toUpperCase()}`
            // Mix of upper/lower-case + with-#/without-#
            const v = i % 2 === 0 ? `#FF${i.toString(16)}${i.toString(16)}${i.toString(16)}${i.toString(16)}` : `aa${i.toString(16)}${i.toString(16)}${i.toString(16)}${i.toString(16)}`
            return [k, v]
          })
        ),
      }
      mockShowOpenDialog.mockResolvedValueOnce({
        canceled: false,
        filePaths: ['/tmp/n.json'],
      })
      mockReadFileSync.mockReturnValueOnce(JSON.stringify(themeBody))
      const handler = handlers.get(CHANNELS.THEMES_OPEN_FILE_DIALOG)!

      const result = (await handler({})) as ThemeImportPayload

      for (const v of Object.values(result.base)) {
        expect(v).toMatch(/^[0-9a-f]{6}$/)
      }
    })
  })
})
```

- [ ] **Step 3.2: Run tests to verify they fail (handler module doesn't exist yet)**

```bash
npx vitest run src/__tests__/main/ipc/themes.test.ts
```

Expected: failure — `Cannot find module '../../../main/ipc/themes'` (or similar).

- [ ] **Step 3.3: Commit (failing tests)**

```bash
git add src/__tests__/main/ipc/themes.test.ts
git commit -m "test(themes): add failing IPC handler tests"
```

---

## Task 4: IPC handler implementation

**Files:**
- Create: `src/main/ipc/themes.ts`
- Modify: `src/main/ipc/index.ts`

- [ ] **Step 4.1: Implement the themes IPC handlers**

Create `src/main/ipc/themes.ts`:

```ts
import { ipcMain, dialog } from 'electron'
import { readFileSync } from 'fs'
import { randomUUID } from 'crypto'
import { basename, extname } from 'path'
import yaml from 'js-yaml'
import { CHANNELS } from '../../shared/ipc'
import type { Theme, ThemeImportPayload } from '../../shared/types'
import { store } from '../db/store'

const BASE16_SLOTS = Array.from({ length: 16 }, (_, i) =>
  `base0${i.toString(16).toUpperCase()}`
)

function normalizeHex(input: unknown): string | null {
  if (typeof input !== 'string') return null
  const stripped = input.replace(/^#/, '').toLowerCase()
  return /^[0-9a-f]{6}$/.test(stripped) ? stripped : null
}

function parseThemeFile(content: string, filePath: string): ThemeImportPayload | { error: string } {
  let parsed: unknown
  try {
    // js-yaml handles JSON as a YAML subset, so one path works for both.
    parsed = yaml.load(content)
  } catch (err) {
    return { error: `Could not parse file: ${(err as Error).message}` }
  }
  if (!parsed || typeof parsed !== 'object') {
    return { error: 'Theme file is empty or not an object.' }
  }
  const obj = parsed as Record<string, unknown>
  const base: Record<string, string> = {}
  for (const slot of BASE16_SLOTS) {
    const norm = normalizeHex(obj[slot])
    if (!norm) {
      return { error: `Not a valid Base16 theme: missing or invalid "${slot}".` }
    }
    base[slot] = norm
  }
  const scheme =
    typeof obj.scheme === 'string' && obj.scheme.trim()
      ? obj.scheme.trim()
      : basename(filePath, extname(filePath))
  const author = typeof obj.author === 'string' ? obj.author.trim() : undefined
  return { scheme, author, base }
}

export function registerThemeHandlers(): void {
  ipcMain.handle(CHANNELS.THEMES_LIST, async () => ({
    themes: store.get('themes'),
    activeThemeId: store.get('activeThemeId'),
  }))

  ipcMain.handle(CHANNELS.THEMES_OPEN_FILE_DIALOG, async () => {
    const res = await dialog.showOpenDialog({
      title: 'Import Base16 Theme',
      properties: ['openFile'],
      filters: [{ name: 'Base16 Theme', extensions: ['json', 'yaml', 'yml'] }],
    })
    if (res.canceled || res.filePaths.length === 0) return null
    const filePath = res.filePaths[0]
    let content: string
    try {
      content = readFileSync(filePath, 'utf-8')
    } catch (err) {
      return { error: `Could not read file: ${(err as Error).message}` }
    }
    return parseThemeFile(content, filePath)
  })

  ipcMain.handle(CHANNELS.THEMES_ADD, async (_event, req: ThemeImportPayload) => {
    const themes = store.get('themes')
    const newTheme: Theme = {
      id: randomUUID(),
      name: req.scheme,
      author: req.author,
      base: req.base,
      importedAt: new Date().toISOString(),
    }
    store.set('themes', [...themes, newTheme])
    return newTheme
  })

  ipcMain.handle(CHANNELS.THEMES_REMOVE, async (_event, id: string) => {
    const themes = store.get('themes')
    store.set('themes', themes.filter((t) => t.id !== id))
    if (store.get('activeThemeId') === id) {
      store.set('activeThemeId', null)
    }
  })

  ipcMain.handle(CHANNELS.THEMES_SET_ACTIVE, async (_event, id: string | null) => {
    store.set('activeThemeId', id)
  })
}
```

- [ ] **Step 4.2: Register the handlers in `src/main/ipc/index.ts`**

```ts
import { registerConnectionHandlers } from './connections'
import { registerCatalogHandlers } from './catalog'
import { registerQueryHandlers } from './query'
import { registerSavedQueryHandlers } from './savedQueries'
import { registerHistoryHandlers } from './history'
import { registerExportHandlers } from './export'
import { registerThemeHandlers } from './themes'

export function registerIpcHandlers(): void {
  registerConnectionHandlers()
  registerCatalogHandlers()
  registerQueryHandlers()
  registerSavedQueryHandlers()
  registerHistoryHandlers()
  registerExportHandlers()
  registerThemeHandlers()
}
```

- [ ] **Step 4.3: Run themes tests — verify all pass**

```bash
npx vitest run src/__tests__/main/ipc/themes.test.ts
```

Expected: all ~11 tests pass.

- [ ] **Step 4.4: Run the full test suite to catch regressions**

```bash
npx vitest run
```

Expected: all tests pass.

- [ ] **Step 4.5: Verify typecheck**

```bash
npx tsc --noEmit
```

Expected: no output.

- [ ] **Step 4.6: Commit**

```bash
git add src/main/ipc/themes.ts src/main/ipc/index.ts
git commit -m "feat(themes): IPC handlers for list/add/remove/set-active/open-file"
```

---

## Task 5: applyTheme utility tests (TDD — failing first)

**Files:**
- Create: `src/__tests__/renderer/lib/applyTheme.test.ts`

- [ ] **Step 5.1: Write the test file**

```ts
/**
 * applyTheme.test.ts
 * Tests the pure token-mapping + CSS injection utility.
 */
import { describe, it, expect, beforeEach } from 'vitest'
import type { Theme } from '../../../shared/types'

let applyTheme: typeof import('../../../renderer/src/lib/applyTheme').applyTheme
let hexToRgb: typeof import('../../../renderer/src/lib/applyTheme').hexToRgb
let blend: typeof import('../../../renderer/src/lib/applyTheme').blend

beforeEach(async () => {
  ;({ applyTheme, hexToRgb, blend } = await import('../../../renderer/src/lib/applyTheme'))
  // Reset DOM between tests
  document.head.innerHTML = ''
  document.documentElement.className = ''
})

function makeTheme(overrides: Partial<Theme['base']> = {}): Theme {
  const base: Record<string, string> = {}
  for (let i = 0; i <= 0x0f; i++) {
    const k = `base0${i.toString(16).toUpperCase()}`
    base[k] = `${i.toString(16)}${i.toString(16)}${i.toString(16)}${i.toString(16)}${i.toString(16)}${i.toString(16)}`
  }
  return {
    id: 't1',
    name: 'Test',
    base: { ...base, ...overrides },
    importedAt: '2026-06-06T00:00:00.000Z',
  }
}

describe('hexToRgb', () => {
  it('parses a 6-char hex string', () => {
    expect(hexToRgb('ff0000')).toEqual([255, 0, 0])
    expect(hexToRgb('00ff00')).toEqual([0, 255, 0])
    expect(hexToRgb('1a2b3c')).toEqual([26, 43, 60])
  })

  it('strips a leading # and is case-insensitive', () => {
    expect(hexToRgb('#FFFFFF')).toEqual([255, 255, 255])
    expect(hexToRgb('#AbCdEf')).toEqual([171, 205, 239])
  })
})

describe('blend', () => {
  it('returns the bg colour at alpha 0', () => {
    expect(blend([100, 100, 100], [200, 200, 200], 0)).toBe('100 100 100')
  })

  it('returns the fg colour at alpha 1', () => {
    expect(blend([100, 100, 100], [200, 200, 200], 1)).toBe('200 200 200')
  })

  it('linearly interpolates at alpha 0.5', () => {
    expect(blend([0, 0, 0], [200, 100, 50], 0.5)).toBe('100 50 25')
  })

  it('rounds to the nearest integer', () => {
    expect(blend([0, 0, 0], [101, 101, 101], 0.5)).toBe('51 51 51') // 50.5 → 51
  })
})

describe('applyTheme', () => {
  it('injects a <style id="aperture-theme"> tag with :root variables', () => {
    const theme = makeTheme()

    applyTheme(theme)

    const styleEl = document.getElementById('aperture-theme') as HTMLStyleElement | null
    expect(styleEl).not.toBeNull()
    expect(styleEl!.tagName).toBe('STYLE')
    expect(styleEl!.textContent).toMatch(/:root\s*\{/)
  })

  it('maps base09 to --c-accent and base0B to --c-state-ok', () => {
    // base09 = 099999 → 9 153 153 ;  base0B = 0bbbbb → 11 187 187
    const theme = makeTheme()

    applyTheme(theme)

    const css = document.getElementById('aperture-theme')!.textContent!
    expect(css).toMatch(/--c-accent:\s*9 153 153/)
    expect(css).toMatch(/--c-state-ok:\s*11 187 187/)
  })

  it('replaces existing style content on a second call (no duplicate tags)', () => {
    applyTheme(makeTheme())
    applyTheme(makeTheme({ base09: 'ffaa00' }))

    expect(document.querySelectorAll('#aperture-theme')).toHaveLength(1)
    expect(document.getElementById('aperture-theme')!.textContent!).toMatch(/--c-accent:\s*255 170 0/)
  })

  it('removes the style tag when called with null', () => {
    applyTheme(makeTheme())
    expect(document.getElementById('aperture-theme')).not.toBeNull()

    applyTheme(null)

    expect(document.getElementById('aperture-theme')).toBeNull()
  })

  it('removes the .dark class from <html> when applying an imported theme', () => {
    document.documentElement.classList.add('dark')

    applyTheme(makeTheme())

    expect(document.documentElement.classList.contains('dark')).toBe(false)
  })

  it('emits derived subtle tokens via blend, not raw colours', () => {
    // base00 = 000000 (background), base09 = 099999 (accent)
    // accent-subtle = blend([0,0,0], [9,153,153], 0.14) ≈ "1 21 21"
    applyTheme(makeTheme())

    const css = document.getElementById('aperture-theme')!.textContent!
    expect(css).toMatch(/--c-accent-subtle:\s*1 21 21/)
  })

  it('emits all ~30 expected tokens', () => {
    applyTheme(makeTheme())
    const css = document.getElementById('aperture-theme')!.textContent!
    const expected = [
      '--c-bg', '--c-sidebar', '--c-surface', '--c-elevated',
      '--c-border', '--c-border-2',
      '--c-text', '--c-text-2', '--c-text-3', '--c-text-4',
      '--c-accent', '--c-accent-hover', '--c-accent-subtle', '--c-accent-sub-2', '--c-accent-text',
      '--c-state-ok', '--c-state-ok-subtle',
      '--c-state-warn', '--c-state-warn-subtle',
      '--c-state-err', '--c-state-err-subtle',
      '--c-cat-blue', '--c-cat-blue-subtle',
      '--c-cat-purple', '--c-cat-green',
    ]
    for (const tok of expected) {
      expect(css).toContain(tok)
    }
  })
})
```

- [ ] **Step 5.2: Run tests to verify failure**

```bash
npx vitest run src/__tests__/renderer/lib/applyTheme.test.ts
```

Expected: failure — `Cannot find module '../../../renderer/src/lib/applyTheme'`.

- [ ] **Step 5.3: Commit (failing tests)**

```bash
git add src/__tests__/renderer/lib/applyTheme.test.ts
git commit -m "test(themes): add failing applyTheme tests"
```

---

## Task 6: applyTheme implementation

**Files:**
- Create: `src/renderer/src/lib/applyTheme.ts`

- [ ] **Step 6.1: Write the utility**

```ts
/**
 * applyTheme.ts
 * Pure token mapping + CSS injection for imported Base16 themes.
 *
 * Maps the 16 standard Base16 slots (base00–base0F) onto Aperture's full
 * design-token palette (~30 CSS custom properties), deriving the "subtle"
 * background variants via linear blending toward base00.
 *
 * Pass `null` to remove an imported override and restore the built-in
 * palette defined in index.css.
 */
import type { Theme } from '../../../shared/types'

const STYLE_TAG_ID = 'aperture-theme'

export type RGB = [number, number, number]

export function hexToRgb(hex: string): RGB {
  const clean = hex.replace(/^#/, '')
  return [
    parseInt(clean.slice(0, 2), 16),
    parseInt(clean.slice(2, 4), 16),
    parseInt(clean.slice(4, 6), 16),
  ]
}

/** Mix bg and fg at the given alpha (0 = bg, 1 = fg). Returns "R G B" string. */
export function blend(bg: RGB, fg: RGB, alpha: number): string {
  return [0, 1, 2]
    .map((i) => Math.round(bg[i] * (1 - alpha) + fg[i] * alpha))
    .join(' ')
}

/** "R G B" string from a hex (no leading #). */
function rgbString(hex: string): string {
  return hexToRgb(hex).join(' ')
}

/** Build the `:root { ... }` CSS block. Pure — no DOM access. */
function buildCss(theme: Theme): string {
  const b = theme.base
  const bg = hexToRgb(b.base00)
  const c09 = hexToRgb(b.base09) // accent (orange)
  const c0A = hexToRgb(b.base0A) // warn (yellow)
  const c0B = hexToRgb(b.base0B) // ok (green)
  const c08 = hexToRgb(b.base08) // err (red)
  const c0D = hexToRgb(b.base0D) // blue (functions)
  const c0F = hexToRgb(b.base0F) // deprecated (used to blend hover)

  const lines: string[] = [
    `:root {`,
    // Backgrounds
    `  --c-bg: ${rgbString(b.base00)};`,
    `  --c-sidebar: ${rgbString(b.base01)};`,
    `  --c-surface: ${rgbString(b.base02)};`,
    `  --c-elevated: ${rgbString(b.base02)};`,
    // Borders
    `  --c-border: ${rgbString(b.base03)};`,
    `  --c-border-2: ${rgbString(b.base04)};`,
    // Text
    `  --c-text: ${rgbString(b.base05)};`,
    `  --c-text-2: ${rgbString(b.base06)};`,
    `  --c-text-3: ${rgbString(b.base04)};`,
    `  --c-text-4: ${rgbString(b.base03)};`,
    // Accent
    `  --c-accent: ${rgbString(b.base09)};`,
    `  --c-accent-hover: ${blend(c09, c0F, 0.35)};`,
    `  --c-accent-subtle: ${blend(bg, c09, 0.14)};`,
    `  --c-accent-sub-2: ${blend(bg, c09, 0.22)};`,
    `  --c-accent-text: ${rgbString(b.base09)};`,
    // Status — ok/warn/err
    `  --c-state-ok: ${rgbString(b.base0B)};`,
    `  --c-state-ok-subtle: ${blend(bg, c0B, 0.18)};`,
    `  --c-state-warn: ${rgbString(b.base0A)};`,
    `  --c-state-warn-subtle: ${blend(bg, c0A, 0.18)};`,
    `  --c-state-err: ${rgbString(b.base08)};`,
    `  --c-state-err-subtle: ${blend(bg, c08, 0.18)};`,
    // Categorical
    `  --c-cat-blue: ${rgbString(b.base0D)};`,
    `  --c-cat-blue-subtle: ${blend(bg, c0D, 0.16)};`,
    `  --c-cat-purple: ${rgbString(b.base0E)};`,
    `  --c-cat-green: ${rgbString(b.base0B)};`,
    `}`,
  ]
  return lines.join('\n')
}

/**
 * Apply a theme by injecting a <style id="aperture-theme"> override into <head>.
 * Passing `null` removes the override and restores the built-in index.css palette.
 *
 * Also removes the `.dark` class from <html> when applying an imported theme,
 * so the built-in dark overrides do not combine with the imported palette.
 */
export function applyTheme(theme: Theme | null): void {
  const existing = document.getElementById(STYLE_TAG_ID)
  if (theme === null) {
    if (existing) existing.remove()
    return
  }
  const css = buildCss(theme)
  if (existing) {
    existing.textContent = css
  } else {
    const styleEl = document.createElement('style')
    styleEl.id = STYLE_TAG_ID
    styleEl.textContent = css
    document.head.appendChild(styleEl)
  }
  document.documentElement.classList.remove('dark')
}
```

- [ ] **Step 6.2: Run tests — verify all pass**

```bash
npx vitest run src/__tests__/renderer/lib/applyTheme.test.ts
```

Expected: all ~13 tests pass.

- [ ] **Step 6.3: Verify typecheck**

```bash
npx tsc --noEmit
```

Expected: no output.

- [ ] **Step 6.4: Commit**

```bash
git add src/renderer/src/lib/applyTheme.ts
git commit -m "feat(themes): applyTheme utility — Base16 → CSS variables"
```

---

## Task 7: themeStore tests (TDD — failing first)

**Files:**
- Create: `src/__tests__/renderer/store/themeStore.test.ts`

- [ ] **Step 7.1: Write the test file**

```ts
/**
 * themeStore.test.ts
 * Tests the Zustand theme store.
 */
import { describe, it, expect, vi, beforeEach } from 'vitest'
import { CHANNELS } from '../../../shared/ipc'
import type { Theme, ThemeImportPayload } from '../../../shared/types'

const invoke = () => window.api.invoke as ReturnType<typeof vi.fn>

// Spy on applyTheme via module mock
const mockApplyTheme = vi.fn()
vi.mock('../../../renderer/src/lib/applyTheme', () => ({
  applyTheme: (theme: Theme | null) => mockApplyTheme(theme),
}))

let useThemeStore: typeof import('../../../renderer/src/store/themeStore').useThemeStore

beforeEach(async () => {
  vi.resetModules()
  mockApplyTheme.mockReset()
  ;({ useThemeStore } = await import('../../../renderer/src/store/themeStore'))
})

function makeTheme(id = 't1', name = 'Test'): Theme {
  const base: Record<string, string> = {}
  for (let i = 0; i <= 0x0f; i++) {
    const k = `base0${i.toString(16).toUpperCase()}`
    base[k] = '000000'
  }
  return { id, name, base, importedAt: '2026-06-06T00:00:00.000Z' }
}

describe('themeStore', () => {
  describe('initial state', () => {
    it('starts empty with no active theme', () => {
      const { themes, activeThemeId } = useThemeStore.getState()
      expect(themes).toEqual([])
      expect(activeThemeId).toBeNull()
    })
  })

  describe('load', () => {
    it('populates themes + activeThemeId and applies the active theme', async () => {
      const themes = [makeTheme('t1'), makeTheme('t2', 'Other')]
      invoke().mockResolvedValueOnce({ themes, activeThemeId: 't1' })

      await useThemeStore.getState().load()

      expect(useThemeStore.getState().themes).toEqual(themes)
      expect(useThemeStore.getState().activeThemeId).toBe('t1')
      expect(mockApplyTheme).toHaveBeenCalledWith(themes[0])
    })

    it('does not apply a theme when activeThemeId is null', async () => {
      invoke().mockResolvedValueOnce({ themes: [makeTheme()], activeThemeId: null })

      await useThemeStore.getState().load()

      expect(mockApplyTheme).not.toHaveBeenCalled()
    })
  })

  describe('importFromFile', () => {
    it('opens the dialog and persists the returned payload', async () => {
      const payload: ThemeImportPayload = { scheme: 'Dracula', base: makeTheme().base }
      const persisted = makeTheme('new-id', 'Dracula')
      invoke()
        .mockResolvedValueOnce(payload) // THEMES_OPEN_FILE_DIALOG
        .mockResolvedValueOnce(persisted) // THEMES_ADD

      const result = await useThemeStore.getState().importFromFile()

      expect(result).toEqual({ theme: persisted })
      expect(useThemeStore.getState().themes).toContainEqual(persisted)
    })

    it('returns the error from main without persisting when invalid', async () => {
      invoke().mockResolvedValueOnce({ error: 'Not a valid Base16 theme' })

      const result = await useThemeStore.getState().importFromFile()

      expect(result).toEqual({ error: 'Not a valid Base16 theme' })
      expect(useThemeStore.getState().themes).toEqual([])
    })

    it('returns null when the dialog is cancelled', async () => {
      invoke().mockResolvedValueOnce(null)

      const result = await useThemeStore.getState().importFromFile()

      expect(result).toBeNull()
      expect(useThemeStore.getState().themes).toEqual([])
    })
  })

  describe('remove', () => {
    it('removes the theme and clears active selection when it was active', async () => {
      const themes = [makeTheme('t1'), makeTheme('t2')]
      invoke().mockResolvedValueOnce({ themes, activeThemeId: 't1' })
      await useThemeStore.getState().load()
      mockApplyTheme.mockReset()
      invoke().mockResolvedValueOnce(undefined) // THEMES_REMOVE

      await useThemeStore.getState().remove('t1')

      const state = useThemeStore.getState()
      expect(state.themes).toHaveLength(1)
      expect(state.themes[0].id).toBe('t2')
      expect(state.activeThemeId).toBeNull()
      expect(mockApplyTheme).toHaveBeenCalledWith(null)
    })

    it('keeps active selection when removing a non-active theme', async () => {
      const themes = [makeTheme('t1'), makeTheme('t2')]
      invoke().mockResolvedValueOnce({ themes, activeThemeId: 't1' })
      await useThemeStore.getState().load()
      mockApplyTheme.mockReset()
      invoke().mockResolvedValueOnce(undefined)

      await useThemeStore.getState().remove('t2')

      const state = useThemeStore.getState()
      expect(state.activeThemeId).toBe('t1')
      expect(mockApplyTheme).not.toHaveBeenCalled()
    })
  })

  describe('setActive', () => {
    it('persists the new active id and applies the chosen theme', async () => {
      const themes = [makeTheme('t1'), makeTheme('t2')]
      invoke().mockResolvedValueOnce({ themes, activeThemeId: null })
      await useThemeStore.getState().load()
      mockApplyTheme.mockReset()
      invoke().mockResolvedValueOnce(undefined) // THEMES_SET_ACTIVE

      await useThemeStore.getState().setActive('t2')

      expect(useThemeStore.getState().activeThemeId).toBe('t2')
      expect(invoke()).toHaveBeenCalledWith(CHANNELS.THEMES_SET_ACTIVE, 't2')
      expect(mockApplyTheme).toHaveBeenCalledWith(themes[1])
    })

    it('passes null to applyTheme when setting active to null', async () => {
      const themes = [makeTheme('t1')]
      invoke().mockResolvedValueOnce({ themes, activeThemeId: 't1' })
      await useThemeStore.getState().load()
      mockApplyTheme.mockReset()
      invoke().mockResolvedValueOnce(undefined)

      await useThemeStore.getState().setActive(null)

      expect(useThemeStore.getState().activeThemeId).toBeNull()
      expect(mockApplyTheme).toHaveBeenCalledWith(null)
    })
  })
})
```

- [ ] **Step 7.2: Run tests to verify failure**

```bash
npx vitest run src/__tests__/renderer/store/themeStore.test.ts
```

Expected: failure — `Cannot find module '../../../renderer/src/store/themeStore'`.

- [ ] **Step 7.3: Commit (failing tests)**

```bash
git add src/__tests__/renderer/store/themeStore.test.ts
git commit -m "test(themes): add failing themeStore tests"
```

---

## Task 8: themeStore implementation

**Files:**
- Create: `src/renderer/src/store/themeStore.ts`

- [ ] **Step 8.1: Write the store**

```ts
import { create } from 'zustand'
import { CHANNELS } from '@shared/ipc'
import type { Theme, ThemeImportPayload } from '@shared/types'
import { applyTheme } from '../lib/applyTheme'

type ImportResult =
  | { theme: Theme }
  | { error: string }
  | null

interface ThemeState {
  themes: Theme[]
  activeThemeId: string | null
  /** Loaded once at boot. */
  load: () => Promise<void>
  /** Open the native file picker, parse + validate, and persist on success. */
  importFromFile: () => Promise<ImportResult>
  /** Remove an imported theme. Clears active selection if it was the active one. */
  remove: (id: string) => Promise<void>
  /** Apply a theme (or null = built-in). Persists the choice. */
  setActive: (id: string | null) => Promise<void>
}

export const useThemeStore = create<ThemeState>((set, get) => ({
  themes: [],
  activeThemeId: null,

  load: async () => {
    const { themes, activeThemeId } = await window.api.invoke(CHANNELS.THEMES_LIST)
    set({ themes, activeThemeId })
    if (activeThemeId) {
      const active = themes.find((t) => t.id === activeThemeId)
      if (active) applyTheme(active)
    }
  },

  importFromFile: async () => {
    const dialogResult = await window.api.invoke(CHANNELS.THEMES_OPEN_FILE_DIALOG)
    if (dialogResult === null) return null
    if ('error' in dialogResult) return { error: dialogResult.error }
    const persisted = await window.api.invoke(CHANNELS.THEMES_ADD, dialogResult)
    set((s) => ({ themes: [...s.themes, persisted] }))
    return { theme: persisted }
  },

  remove: async (id) => {
    await window.api.invoke(CHANNELS.THEMES_REMOVE, id)
    const wasActive = get().activeThemeId === id
    set((s) => ({
      themes: s.themes.filter((t) => t.id !== id),
      activeThemeId: wasActive ? null : s.activeThemeId,
    }))
    if (wasActive) applyTheme(null)
  },

  setActive: async (id) => {
    await window.api.invoke(CHANNELS.THEMES_SET_ACTIVE, id)
    set({ activeThemeId: id })
    if (id === null) {
      applyTheme(null)
      return
    }
    const theme = get().themes.find((t) => t.id === id)
    applyTheme(theme ?? null)
  },
}))
```

- [ ] **Step 8.2: Run themeStore tests — verify all pass**

```bash
npx vitest run src/__tests__/renderer/store/themeStore.test.ts
```

Expected: all ~9 tests pass.

- [ ] **Step 8.3: Run the full test suite**

```bash
npx vitest run
```

Expected: all tests pass.

- [ ] **Step 8.4: Verify typecheck**

```bash
npx tsc --noEmit
```

Expected: no output.

- [ ] **Step 8.5: Commit**

```bash
git add src/renderer/src/store/themeStore.ts
git commit -m "feat(themes): Zustand themeStore — load/import/remove/setActive"
```

---

## Task 9: SettingsModal component

**Files:**
- Create: `src/renderer/src/components/settings/SettingsModal.tsx`

- [ ] **Step 9.1: Build the modal**

```tsx
import { useEffect, useRef, useState } from 'react'
import { createPortal } from 'react-dom'
import { X, Plus, Trash2, Palette } from 'lucide-react'
import { useThemeStore } from '../../store/themeStore'
import type { Theme } from '@shared/types'

interface SettingsModalProps {
  open: boolean
  onClose: () => void
}

export default function SettingsModal({ open, onClose }: SettingsModalProps) {
  const { themes, activeThemeId, importFromFile, remove, setActive } = useThemeStore()
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

  return createPortal(
    <div
      className="fixed inset-0 bg-black/40 z-[9999] flex items-center justify-center"
      onClick={onClose}
    >
      <div
        onClick={(e) => e.stopPropagation()}
        className="bg-app-surface border border-app-border rounded-xl shadow-app-card w-[640px] max-h-[80vh] flex overflow-hidden"
      >
        {/* Left nav */}
        <div className="w-[140px] bg-app-sidebar border-r border-app-border p-3 shrink-0">
          <div className="app-section-label mb-3">Settings</div>
          <button className="w-full flex items-center gap-2 px-2 py-1.5 rounded-md text-ui bg-app-elevated text-app-accent-text font-semibold">
            <Palette size={13} />
            Themes
          </button>
        </div>

        {/* Content */}
        <div className="flex-1 flex flex-col min-w-0">
          <div className="flex items-center justify-between px-4 py-3 border-b border-app-border">
            <div className="text-ui-md font-semibold text-app-text">Theme Library</div>
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
            {/* Built-in default — always first, not deletable */}
            <ThemeCard
              builtin
              active={activeThemeId === null}
              swatchColors={['#FAF7F1', '#C8633B', '#2E8B6A', '#2E6FB8']}
              name="Aperture Default"
              author="built-in"
              onClick={() => setActive(null)}
            />

            {themes.map((theme) => (
              <ThemeCard
                key={theme.id}
                active={activeThemeId === theme.id}
                swatchColors={[
                  `#${theme.base.base00}`,
                  `#${theme.base.base09}`,
                  `#${theme.base.base0B}`,
                  `#${theme.base.base0D}`,
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
        </div>
      </div>
    </div>,
    document.body
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
    <div
      onClick={onClick}
      className={`group relative cursor-pointer rounded-lg p-3 transition-colors ${
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
        <div className="absolute top-2 right-2 app-dot app-dot--ok" style={{ backgroundColor: 'rgb(var(--c-accent))' }} />
      )}

      {!builtin && onDelete && (
        <>
          {confirmingDelete ? (
            <div
              className="absolute top-2 right-2 flex items-center gap-1 bg-app-surface rounded px-1 py-0.5 shadow-app-card"
              onClick={(e) => e.stopPropagation()}
            >
              <button
                onClick={onCancelDelete}
                className="text-ui-xs px-1.5 py-0.5 text-app-text-2 hover:text-app-text"
              >
                No
              </button>
              <button
                onClick={onConfirmDelete}
                className="text-ui-xs px-1.5 py-0.5 rounded bg-app-err-subtle text-app-err"
              >
                Yes
              </button>
            </div>
          ) : (
            <button
              onClick={(e) => {
                e.stopPropagation()
                onDelete()
              }}
              className="absolute top-2 right-2 opacity-0 group-hover:opacity-100 p-1 rounded text-app-text-3 hover:text-app-err hover:bg-app-err-subtle/60 transition-all"
              title="Delete theme"
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

- [ ] **Step 9.2: Verify typecheck**

```bash
npx tsc --noEmit
```

Expected: no output.

- [ ] **Step 9.3: Run the full test suite (sanity check no regressions)**

```bash
npx vitest run
```

Expected: all tests pass.

- [ ] **Step 9.4: Commit**

```bash
git add src/renderer/src/components/settings/SettingsModal.tsx
git commit -m "feat(themes): SettingsModal with theme card grid"
```

---

## Task 10: Wire SettingsModal + remove light/dark toggle

**Files:**
- Modify: `src/renderer/src/App.tsx`
- Modify: `src/renderer/src/components/layout/TitleBar.tsx`
- Modify: `src/renderer/src/components/command/CommandPalette.tsx`

- [ ] **Step 10.1: Update `src/renderer/src/App.tsx`**

Replace the file with:

```tsx
import { useState, useEffect, useRef } from 'react'
import TitleBar from './components/layout/TitleBar'
import Sidebar from './components/layout/Sidebar'
import Editor from './pages/Editor'
import ConnectionModal from './components/connections/ConnectionModal'
import ShortcutCheatsheet from './components/command/ShortcutCheatsheet'
import SettingsModal from './components/settings/SettingsModal'
import { useConnectionStore } from './store/connectionStore'
import { useSavedQueryStore } from './store/savedQueryStore'
import { useHistoryStore } from './store/historyStore'
import { useThemeStore } from './store/themeStore'
import type { Connection } from '@shared/types'
import type { CommandPaletteHandle } from './components/command/CommandPalette'

type ModalState = null | { mode: 'add' } | { mode: 'edit'; connection: Connection }

export default function App() {
  const [modal, setModal] = useState<ModalState>(null)
  const { connections, load } = useConnectionStore()
  const loadSavedQueries = useSavedQueryStore((s) => s.load)
  const loadHistory = useHistoryStore((s) => s.load)
  const loadThemes = useThemeStore((s) => s.load)
  const paletteRef = useRef<CommandPaletteHandle>(null)
  const [cheatsheetOpen, setCheatsheetOpen] = useState(false)
  const [settingsOpen, setSettingsOpen] = useState(false)

  useEffect(() => {
    // Eager-load every persistent store the ⌘K palette searches over,
    // plus the theme library so the active theme is applied before first paint.
    load()
    loadSavedQueries()
    loadHistory()
    loadThemes()
  }, [load, loadSavedQueries, loadHistory, loadThemes])

  // Global ⌘K — focuses the palette input
  // Global ⌘/ — toggles shortcut cheatsheet
  useEffect(() => {
    const handler = (e: KeyboardEvent) => {
      if ((e.metaKey || e.ctrlKey) && (e.key === 'k' || e.key === 'K')) {
        e.preventDefault()
        paletteRef.current?.focus()
        return
      }
      if ((e.metaKey || e.ctrlKey) && e.key === '/') {
        e.preventDefault()
        setCheatsheetOpen((v) => !v)
      }
    }
    window.addEventListener('keydown', handler)
    return () => window.removeEventListener('keydown', handler)
  }, [])

  return (
    <div className="flex flex-col h-screen bg-app-bg text-app-text">
      <TitleBar
        onAddConnection={() => setModal({ mode: 'add' })}
        onEditConnection={(conn) => setModal({ mode: 'edit', connection: conn })}
        onOpenSettings={() => setSettingsOpen(true)}
        onShowShortcuts={() => setCheatsheetOpen(true)}
        paletteRef={paletteRef}
      />
      <div className="flex flex-1 overflow-hidden">
        <Sidebar onAddConnection={() => setModal({ mode: 'add' })} />
        <main className="flex-1 overflow-hidden">
          {connections.length === 0 ? (
            <EmptyState onAddConnection={() => setModal({ mode: 'add' })} />
          ) : (
            <Editor />
          )}
        </main>
      </div>
      {modal && (
        <ConnectionModal
          onClose={() => setModal(null)}
          initialConnection={modal.mode === 'edit' ? modal.connection : undefined}
        />
      )}
      <ShortcutCheatsheet open={cheatsheetOpen} onClose={() => setCheatsheetOpen(false)} />
      <SettingsModal open={settingsOpen} onClose={() => setSettingsOpen(false)} />
    </div>
  )
}

function EmptyState({ onAddConnection }: { onAddConnection: () => void }) {
  return (
    <div className="h-full flex flex-col items-center justify-center gap-5 text-app-text-2">
      <div className="flex flex-col items-center gap-2">
        <div className="w-12 h-12 rounded-2xl bg-app-accent-subtle flex items-center justify-center">
          <svg
            width="24" height="24" viewBox="0 0 24 24"
            fill="none" stroke="currentColor" strokeWidth="1.5"
            className="text-app-accent-text"
          >
            <ellipse cx="12" cy="5" rx="9" ry="3" />
            <path d="M21 12c0 1.66-4 3-9 3s-9-1.34-9-3" />
            <path d="M3 5v14c0 1.66 4 3 9 3s9-1.34 9-3V5" />
          </svg>
        </div>
        <p className="text-sm font-medium text-app-text">No connections yet</p>
        <p className="text-xs text-app-text-3">Connect to BigQuery, Postgres, or Snowflake to get started</p>
      </div>
      <button
        onClick={onAddConnection}
        className="px-4 py-2 bg-app-accent text-white rounded-lg hover:bg-app-accent-hover transition-colors text-sm font-medium"
      >
        Add Connection
      </button>
    </div>
  )
}
```

- [ ] **Step 10.2: Update `src/renderer/src/components/layout/TitleBar.tsx`**

Replace the `Sun, Moon` import line:

```ts
import { Settings, Plus, ChevronDown, Trash2, Pencil } from 'lucide-react'
```

Replace the `TitleBarProps` interface:

```ts
interface TitleBarProps {
  onAddConnection: () => void
  onEditConnection: (conn: Connection) => void
  onOpenSettings: () => void
  onShowShortcuts?: () => void
  /** Receives the palette's imperative `focus()` so a global ⌘K can target it. */
  paletteRef?: RefObject<CommandPaletteHandle>
}
```

Replace the destructured function signature:

```ts
export default function TitleBar({ onAddConnection, onEditConnection, onOpenSettings, onShowShortcuts, paletteRef }: TitleBarProps) {
```

Replace the Sun/Moon toggle button (the block ending with `{isDark ? <Sun size={14} /> : <Moon size={14} />}`) with:

```tsx
        {/* Settings button */}
        <button
          onClick={onOpenSettings}
          title="Settings"
          style={{ WebkitAppRegion: 'no-drag' } as React.CSSProperties}
          className="p-1.5 rounded-md text-app-text-2 hover:text-app-text hover:bg-app-elevated transition-colors"
        >
          <Settings size={14} />
        </button>
```

Update the `<CommandPalette>` rendering to remove `onToggleTheme` and add `onOpenSettings` (CommandPalette signature changes in Step 10.3):

```tsx
        <CommandPalette
          ref={paletteRef}
          onAddConnection={onAddConnection}
          onOpenSettings={onOpenSettings}
          onShowShortcuts={onShowShortcuts}
        />
```

- [ ] **Step 10.3: Update `src/renderer/src/components/command/CommandPalette.tsx`**

Locate the component's props interface. Remove `onToggleTheme?: () => void` and add `onOpenSettings?: () => void`. Update the destructure.

In the static actions list (search for `'action:toggle-theme'` or similar), replace the toggle-theme item with a settings item:

```ts
{
  id: 'action:settings',
  kind: 'action',
  label: 'Settings',
  icon: 'settings',
  action: onOpenSettings,
},
```

If the existing palette uses string-keyed icon names (e.g. `'sun'`/`'moon'`), make sure `'settings'` is wired up to the `Settings` Lucide icon in the icon-rendering switch. Add the import `Settings` from `lucide-react` if not already present.

- [ ] **Step 10.4: Verify typecheck**

```bash
npx tsc --noEmit
```

Expected: no output. (If errors mention a CommandPalette test that referenced `onToggleTheme`, fix the test in the same file.)

- [ ] **Step 10.5: Run the full test suite — fix any test that referenced the removed toggle**

```bash
npx vitest run
```

Expected: all tests pass. If any pre-existing test referenced `isDark`/`onToggleTheme`/the sun-moon button, update that test to use `onOpenSettings`/the settings button instead.

- [ ] **Step 10.6: Commit**

```bash
git add src/renderer/src/App.tsx src/renderer/src/components/layout/TitleBar.tsx src/renderer/src/components/command/CommandPalette.tsx
git commit -m "feat(themes): wire SettingsModal, remove light/dark toggle"
```

---

## Task 11: Coverage verification

**Files:** none modified.

- [ ] **Step 11.1: Run coverage**

```bash
npx vitest run --coverage
```

Expected: all tests pass; overall coverage ≥ 70% (project currently ~84%); new files (`themes.ts`, `applyTheme.ts`, `themeStore.ts`) at or near 100%.

- [ ] **Step 11.2: If any new module is below 70%, add targeted tests**

Review the coverage table; for any new file under threshold, add a test for the uncovered branch and re-run. (Most likely fully covered by Tasks 3/5/7.)

---

## Task 12: Documentation

**Files:**
- Modify: `CHANGELOG.md`
- Modify: `CLAUDE.md`

- [ ] **Step 12.1: Add to `CHANGELOG.md`**

In the `## [Unreleased]` section (create the section if it doesn't exist), under `### Added`:

```
- **Theme import (Base16)** — a new Settings modal (⚙ icon in the title bar, or "Settings" in the ⌘K palette) lets users import community Base16 theme files (JSON or YAML) into a managed theme library. The library shows each theme as a card with a colour-swatch preview; clicking a card applies it instantly. The previous light/dark toggle is removed — each Base16 theme is a complete, self-contained palette, so users get a light look by importing a light theme (e.g. Solarized Light, GitHub Light) and a dark look by importing a dark theme (e.g. Dracula, Nord, Gruvbox). The built-in Aperture Default is always present at the top of the library and is the fallback when no imported theme is active. Imports are validated as proper Base16 (all 16 base00–base0F slots present and parseable as hex); invalid files surface an inline error in the modal.
```

- [ ] **Step 12.2: Add to `CLAUDE.md`**

Insert a new change-log entry at the top of the "Entries go below this line, newest first" section (above the most recent entry):

```
### [2026-06-06] Feature: Theme import (Base16)

**Type:** Change
**Context:** The app shipped with exactly two hardcoded themes (light, dark) and a Sun/Moon toggle. Users wanted to bring their own colour schemes — specifically community themes from the Base16 ecosystem (Dracula, Nord, Gruvbox, Catppuccin, Solarized…).
**Problem / Change:**
- No way to import or manage custom palettes.
- Hardcoded light/dark toggle was redundant once arbitrary palettes are possible (each Base16 theme is already a complete self-contained palette, dark or light).
- No UI scaffolding for app settings beyond a flat title-bar toggle.

**Solution / Outcome:**
- **Base16 → Aperture token mapping**: pure `applyTheme(theme | null)` utility (`src/renderer/src/lib/applyTheme.ts`) deterministically derives Aperture's full ~30-token CSS-variable palette from the 16 Base16 slots. Direct mappings cover the 25 named tokens; the 5 "subtle" variants are computed via linear blending toward `base00` (e.g. `--c-accent-subtle = blend(base00, base09, 0.14)`). Output is injected as a `<style id="aperture-theme">` block that overrides `index.css`'s `:root`. Calling `applyTheme(null)` removes the override and restores the built-in palette.
- **Persistent storage**: `themes: Theme[]` and `activeThemeId: string | null` added to `StoreData` in `aperture-store.json`. Five new IPC channels (`THEMES_LIST`, `THEMES_OPEN_FILE_DIALOG`, `THEMES_ADD`, `THEMES_REMOVE`, `THEMES_SET_ACTIVE`). Handlers in `src/main/ipc/themes.ts` validate Base16 files (parse with `js-yaml` — handles JSON as a subset — verify all 16 `base0X` slots are 6-char hex). Validation errors return a structured `{ error: string }` payload instead of throwing across the IPC boundary.
- **Zustand store**: `useThemeStore` in `src/renderer/src/store/themeStore.ts` mirrors the `connectionStore` shape (`load`, `importFromFile`, `remove`, `setActive`). `load()` is called at app boot in `App.tsx` and applies the active theme before first paint.
- **Settings modal**: new `SettingsModal.tsx` (portal-rendered, ⌘+/Escape to close, click outside to close) with a left-nav (currently just "Themes" — architected for future sections) and a 3-column card grid. Each card shows 4 representative colour swatches + name + author. Active theme has a terracotta border + accent dot. Built-in "Aperture Default" card is always first and not deletable; clicking it sets `activeThemeId` to `null`. Imported cards get a trash icon on hover with an inline "Delete? No / Yes" confirm + 3 s auto-dismiss (matching the existing connection-delete pattern).
- **Removed light/dark toggle**: `Sun`/`Moon` button in title bar replaced with a `Settings` (gear) button. `App.tsx`'s `isDark` state, the `useEffect` managing the `.dark` class + `localStorage['theme']`, and the `onToggleTheme`/`isDark` prop chain are all gone. `index.css`'s `:root`/`.dark` blocks remain untouched (they are the built-in palette), and `html { @apply dark }` stays — dark is the permanent built-in default. Users get a light look by importing a light Base16 theme. The `CommandPalette` "Toggle theme" action is replaced with a "Settings" action that opens the modal.
- **Tests** (~22 new): `themes.test.ts` (11 IPC handler tests covering list/add/remove/set-active + file-dialog happy paths + invalid/cancelled paths + hex normalisation), `applyTheme.test.ts` (13 tests covering `hexToRgb`, `blend` math, style-tag lifecycle, `.dark` removal, derived-token correctness, full token-set coverage), `themeStore.test.ts` (9 tests covering initial state, load with/without active, importFromFile happy/error/cancelled paths, remove with/without active, setActive with id/null).

**Files affected:**
- `package.json` — added `js-yaml` + `@types/js-yaml`
- `src/shared/types.ts` — `Theme`, `ThemeImportPayload`
- `src/shared/ipc.ts` — 5 `THEMES_*` channels + IpcMap entries
- `src/main/db/store.ts` — `themes`, `activeThemeId` on `StoreData`
- `src/main/ipc/themes.ts` — created (5 handlers + Base16 file parser)
- `src/main/ipc/index.ts` — register themes handlers
- `src/renderer/src/lib/applyTheme.ts` — created
- `src/renderer/src/store/themeStore.ts` — created
- `src/renderer/src/components/settings/SettingsModal.tsx` — created
- `src/renderer/src/App.tsx` — removed toggle, mount themes, render SettingsModal
- `src/renderer/src/components/layout/TitleBar.tsx` — gear icon replaces Sun/Moon
- `src/renderer/src/components/command/CommandPalette.tsx` — Settings action
- `src/__tests__/main/ipc/themes.test.ts` — created
- `src/__tests__/renderer/lib/applyTheme.test.ts` — created
- `src/__tests__/renderer/store/themeStore.test.ts` — created
- `CHANGELOG.md` — Unreleased entry
- `docs/superpowers/specs/2026-06-06-theme-import-design.md` — design spec
- `docs/superpowers/plans/2026-06-06-theme-import.md` — implementation plan
```

- [ ] **Step 12.3: Commit**

```bash
git add CHANGELOG.md CLAUDE.md
git commit -m "docs: changelog + CLAUDE.md entries for theme import"
```

---

## Task 13: Manual verification + PR

**Files:** none modified.

- [ ] **Step 13.1: Launch the dev app and run through the verification checklist from the spec**

```bash
just dev
```

Verify in the running app:
1. **Settings opens**: click the ⚙ gear in the title bar → modal opens centered. Press Escape → closes. Click outside → closes. Open ⌘K → type "Settings" → action appears → Enter → modal opens.
2. **Built-in default is shown + active**: the first card is "Aperture Default" with a terracotta border + active dot. Looks identical to today's dark theme.
3. **Import valid theme**: click "Import…" → native file picker opens with `.json/.yaml/.yml` filter. Pick a known-good Base16 file (e.g. download `dracula.yaml` from base16-tinted-theming/schemes). The new card appears with swatches matching the theme's colours; theme is *not* auto-activated.
4. **Apply imported theme**: click the new card → entire UI re-skins instantly (background, accent, status colours, sidebar all change to the new palette). The active border + dot move to the new card.
5. **Switch back to default**: click "Aperture Default" → app returns to the built-in look.
6. **Delete**: hover an imported card → trash icon appears → click → "Delete? No / Yes" inline confirm → click "Yes" → card removed. If it was the active theme, the app returns to the default look.
7. **Import invalid theme**: pick a `.json` file that's not a Base16 theme (e.g. `package.json`) → red error banner appears at the top of the modal ("Not a valid Base16 theme: missing or invalid "base00"."). No card added.
8. **Cancel dialog**: click "Import…" → press Cancel in the native dialog → no error, modal returns to idle.
9. **Restart persistence**: kill the app (⌘Q) → relaunch → the imported themes are still in the library; the previously active theme is re-applied at boot before any paint flash.

- [ ] **Step 13.2: Push and open PR**

```bash
git push -u origin feat/theme-import
gh pr create --title "feat: import Base16 community themes" --body "$(cat <<'EOF'
## Summary

- **Import Base16 themes** — a new Settings modal lets users import community Base16 theme files (JSON or YAML) from disk into a managed theme library. Hundreds of existing community themes (Dracula, Nord, Gruvbox, Catppuccin, Solarized, Tokyo Night, …) work out of the box.
- **Card-grid theme library** — opens via the ⚙ icon in the title bar or the "Settings" action in ⌘K. Each card shows colour swatches + name + author. Click a card to apply instantly; hover an imported card for a trash icon with an inline delete confirm.
- **Replaces the light/dark toggle entirely** — every Base16 theme is a complete self-contained palette, so the Sun/Moon button is gone. Users get a light look by importing a light Base16 theme; the built-in "Aperture Default" card is always present as the fallback.

## Architecture

- 5 new IPC channels (list / open-file-dialog / add / remove / set-active) following the existing CONNECTIONS_* pattern
- Pure `applyTheme(theme | null)` utility maps 16 Base16 slots to Aperture's ~30 CSS custom properties; subtle variants are derived via linear blending toward base00
- Themes persisted in the existing `aperture-store.json` via the main process
- `index.css` `:root`/`.dark` blocks are unchanged — they are the built-in palette

## Spec & Plan

- Spec: `docs/superpowers/specs/2026-06-06-theme-import-design.md`
- Plan: `docs/superpowers/plans/2026-06-06-theme-import.md`

## Test plan

- [x] ~33 new unit tests (themes IPC, applyTheme, themeStore)
- [x] Coverage maintained ≥ 70%
- [x] TypeScript compiles cleanly
- [ ] Manual: open Settings → Aperture Default shows as active
- [ ] Manual: import a known-good Base16 theme → card appears with correct swatches
- [ ] Manual: click an imported card → UI re-skins instantly
- [ ] Manual: import an invalid file → inline error, no card added
- [ ] Manual: delete an active theme → falls back to Aperture Default
- [ ] Manual: restart app → imported themes persist; active theme re-applied before first paint

🤖 Generated with [Claude Code](https://claude.com/claude-code)
EOF
)"
```

Expected: PR URL returned.

---

## Self-Review Notes

- **Spec coverage**: every spec section maps to a task — data model (Task 2), IPC contract (Tasks 3–4), token mapping (Tasks 5–6), Settings UI (Task 9), toggle removal (Task 10), tests (Tasks 3/5/7 + Task 11), file summary (Task 12).
- **Type consistency**: `Theme`, `ThemeImportPayload`, `useThemeStore` shape, `applyTheme(Theme | null)`, and channel names are used identically across tasks.
- **Placeholders**: none — every code block is complete.
- **No external blockers**: `js-yaml` is the only new dependency.
