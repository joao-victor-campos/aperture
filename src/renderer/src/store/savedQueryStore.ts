import { create } from 'zustand'
import { CHANNELS } from '@shared/ipc'
import type { SavedQuery, Folder } from '@shared/types'

interface SavedQueryState {
  queries: SavedQuery[]
  folders: Folder[]
  load: () => Promise<void>
  saveQuery: (q: Omit<SavedQuery, 'id' | 'createdAt' | 'updatedAt'>) => Promise<SavedQuery>
  updateQuery: (q: SavedQuery) => Promise<void>
  deleteQuery: (id: string) => Promise<void>
  createFolder: (name: string) => Promise<Folder>
  renameFolder: (folder: Folder) => Promise<void>
  deleteFolder: (id: string) => Promise<void>
}

export const useSavedQueryStore = create<SavedQueryState>((set, get) => ({
  queries: [],
  folders: [],

  load: async () => {
    const [queries, folders] = await Promise.all([
      window.api.invoke(CHANNELS.SAVED_QUERY_LIST, undefined),
      window.api.invoke(CHANNELS.FOLDER_LIST, undefined),
    ])
    set({ queries, folders })
  },

  saveQuery: async (q) => {
    const saved = await window.api.invoke(CHANNELS.SAVED_QUERY_SAVE, q)
    set((s) => ({ queries: [...s.queries, saved] }))
    return saved
  },

  updateQuery: async (q) => {
    const updated = await window.api.invoke(CHANNELS.SAVED_QUERY_UPDATE, q)
    set((s) => ({
      queries: s.queries.map((sq) => (sq.id === updated.id ? updated : sq))
    }))
  },

  deleteQuery: async (id) => {
    await window.api.invoke(CHANNELS.SAVED_QUERY_DELETE, id)
    set((s) => ({ queries: s.queries.filter((q) => q.id !== id) }))
  },

  createFolder: async (name) => {
    const folder = await window.api.invoke(CHANNELS.FOLDER_CREATE, { name, parentId: null })
    set((s) => ({ folders: [...s.folders, folder] }))
    return folder
  },

  renameFolder: async (folder) => {
    const updated = await window.api.invoke(CHANNELS.FOLDER_UPDATE, folder)
    set((s) => ({
      folders: s.folders.map((f) => (f.id === updated.id ? updated : f))
    }))
  },

  deleteFolder: async (id) => {
    await window.api.invoke(CHANNELS.FOLDER_DELETE, id)
    set((s) => ({
      folders: s.folders.filter((f) => f.id !== id),
      // Move queries from deleted folder to uncategorized
      queries: s.queries.map((q) => (q.folderId === id ? { ...q, folderId: null } : q))
    }))
  },
}))
