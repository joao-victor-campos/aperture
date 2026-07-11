import { create } from 'zustand'

const KEY = 'aperture-prefs'

interface PersistedPrefs {
  limitGuardEnabled: boolean
}

const DEFAULTS: PersistedPrefs = {
  limitGuardEnabled: true,
}

function readPrefs(): PersistedPrefs {
  try {
    const raw = localStorage.getItem(KEY)
    if (!raw) return DEFAULTS
    const parsed = JSON.parse(raw) as Partial<PersistedPrefs>
    return {
      limitGuardEnabled:
        typeof parsed.limitGuardEnabled === 'boolean'
          ? parsed.limitGuardEnabled
          : DEFAULTS.limitGuardEnabled,
    }
  } catch {
    return DEFAULTS
  }
}

function writePrefs(prefs: PersistedPrefs): void {
  try {
    localStorage.setItem(KEY, JSON.stringify(prefs))
  } catch {
    // ignore write failures (private mode, quota) — in-memory state still updates
  }
}

interface PreferencesState {
  /** Warn before running a SELECT/WITH without a LIMIT. */
  limitGuardEnabled: boolean
  setLimitGuardEnabled: (value: boolean) => void
}

export const usePreferencesStore = create<PreferencesState>((set) => ({
  limitGuardEnabled: readPrefs().limitGuardEnabled,

  setLimitGuardEnabled: (value) => {
    set({ limitGuardEnabled: value })
    writePrefs({ limitGuardEnabled: value })
  },
}))
