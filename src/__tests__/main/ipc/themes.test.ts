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
