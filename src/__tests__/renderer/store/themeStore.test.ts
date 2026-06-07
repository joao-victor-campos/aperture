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

    it('does not apply when activeThemeId is set but theme is missing from list (stale state)', async () => {
      invoke().mockResolvedValueOnce({ themes: [makeTheme('t1')], activeThemeId: 'stale-id' })

      await useThemeStore.getState().load()

      expect(useThemeStore.getState().activeThemeId).toBe('stale-id')
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

    it('falls back to applyTheme(null) when the id is not in the themes list', async () => {
      const themes = [makeTheme('t1')]
      invoke().mockResolvedValueOnce({ themes, activeThemeId: null })
      await useThemeStore.getState().load()
      mockApplyTheme.mockReset()
      invoke().mockResolvedValueOnce(undefined)

      await useThemeStore.getState().setActive('unknown-id')

      expect(mockApplyTheme).toHaveBeenCalledWith(null)
    })
  })
})
