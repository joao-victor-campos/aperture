import { describe, it, expect, beforeEach, vi } from 'vitest'

const KEY = 'aperture-prefs'

async function freshStore() {
  vi.resetModules()
  const mod = await import('../../../renderer/src/store/preferencesStore')
  return mod.usePreferencesStore
}

describe('preferencesStore', () => {
  beforeEach(() => {
    localStorage.clear()
  })

  it('defaults limitGuardEnabled to true', async () => {
    const store = await freshStore()
    expect(store.getState().limitGuardEnabled).toBe(true)
  })

  it('setLimitGuardEnabled updates state', async () => {
    const store = await freshStore()
    store.getState().setLimitGuardEnabled(false)
    expect(store.getState().limitGuardEnabled).toBe(false)
  })

  it('persists to localStorage and re-reads on init', async () => {
    const first = await freshStore()
    first.getState().setLimitGuardEnabled(false)
    expect(JSON.parse(localStorage.getItem(KEY)!)).toEqual({ limitGuardEnabled: false })

    const second = await freshStore()
    expect(second.getState().limitGuardEnabled).toBe(false)
  })

  it('falls back to the default on a corrupt value', async () => {
    localStorage.setItem(KEY, '{not json')
    const store = await freshStore()
    expect(store.getState().limitGuardEnabled).toBe(true)
  })
})
