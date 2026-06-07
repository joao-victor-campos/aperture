import { create } from 'zustand'
import { CHANNELS } from '@shared/ipc'
import type { Theme } from '@shared/types'
import { applyTheme, applyBuiltinLight } from '../lib/applyTheme'

/** Sentinel ID for the built-in Aperture Light theme. */
export const APERTURE_LIGHT_ID = 'aperture-light'

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
    if (activeThemeId === null) {
      // Bootstrap already applied dark default
      return
    }
    if (activeThemeId === APERTURE_LIGHT_ID) {
      applyBuiltinLight()
      return
    }
    const active = themes.find((t) => t.id === activeThemeId)
    if (active) applyTheme(active)
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
    if (id === APERTURE_LIGHT_ID) {
      applyBuiltinLight()
      return
    }
    const theme = get().themes.find((t) => t.id === id)
    applyTheme(theme ?? null)
  },
}))
