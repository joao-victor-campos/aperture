import { create } from 'zustand'
import { CHANNELS } from '@shared/ipc'
import type { HistoryEntry } from '@shared/types'

interface HistoryState {
  entries: HistoryEntry[]
  loaded: boolean
  /** Idempotent: no-op if already loaded. Used for eager bootstrap in App.tsx. */
  load: () => Promise<void>
  /** Forces a fresh fetch. Used after running a new query. */
  reload: () => Promise<void>
  clearAll: () => Promise<void>
}

export const useHistoryStore = create<HistoryState>((set, get) => ({
  entries: [],
  loaded: false,

  load: async () => {
    if (get().loaded) return
    const entries = await window.api.invoke(CHANNELS.HISTORY_LIST, undefined)
    set({ entries, loaded: true })
  },

  reload: async () => {
    const entries = await window.api.invoke(CHANNELS.HISTORY_LIST, undefined)
    set({ entries, loaded: true })
  },

  clearAll: async () => {
    await window.api.invoke(CHANNELS.HISTORY_CLEAR, undefined)
    set({ entries: [] })
  },
}))
