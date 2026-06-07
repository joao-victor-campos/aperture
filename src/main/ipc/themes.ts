import { ipcMain, dialog } from 'electron'
import { readFileSync } from 'fs'
import { randomUUID } from 'crypto'
import { basename, extname } from 'path'
import yaml from 'js-yaml'
import { CHANNELS } from '../../shared/ipc'
import type { Theme, ThemeImportPayload } from '../../shared/types'
import { store } from '../db/store'

const BASE16_SLOTS = Array.from({ length: 16 }, (_, i) =>
  `base0${i.toString(16)}`
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
  // Accept both `base0A` (uppercase, official spec) and `base0a` (lowercase,
  // common in community-distributed YAML files). Normalize keys to lowercase
  // before the slot lookup so either case works.
  const rawObj = parsed as Record<string, unknown>
  const obj: Record<string, unknown> = {}
  for (const [k, v] of Object.entries(rawObj)) {
    obj[k.toLowerCase()] = v
  }
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
  const author = typeof obj.author === 'string' ? (obj.author.trim() || undefined) : undefined
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
