import { ipcMain } from 'electron'
import { randomUUID } from 'crypto'
import { store } from '../db/store'
import { CHANNELS } from '../../shared/ipc'
import type { SavedQuery, Folder } from '../../shared/types'

export function registerSavedQueryHandlers(): void {
  // ── Saved queries ─────────────────────────────────────────────────────────

  ipcMain.handle(CHANNELS.SAVED_QUERY_LIST, async () => {
    return store.get('savedQueries')
  })

  ipcMain.handle(
    CHANNELS.SAVED_QUERY_SAVE,
    async (_event, req: Omit<SavedQuery, 'id' | 'createdAt' | 'updatedAt'>) => {
      const now = new Date().toISOString()
      const saved: SavedQuery = { ...req, id: randomUUID(), createdAt: now, updatedAt: now }
      store.set('savedQueries', [...store.get('savedQueries'), saved])
      return saved
    }
  )

  ipcMain.handle(CHANNELS.SAVED_QUERY_UPDATE, async (_event, req: SavedQuery) => {
    const updated: SavedQuery = { ...req, updatedAt: new Date().toISOString() }
    store.set(
      'savedQueries',
      store.get('savedQueries').map((q) => (q.id === req.id ? updated : q))
    )
    return updated
  })

  ipcMain.handle(CHANNELS.SAVED_QUERY_DELETE, async (_event, id: string) => {
    store.set(
      'savedQueries',
      store.get('savedQueries').filter((q) => q.id !== id)
    )
  })

  // ── Folders ───────────────────────────────────────────────────────────────

  ipcMain.handle(CHANNELS.FOLDER_LIST, async () => {
    return store.get('folders')
  })

  ipcMain.handle(
    CHANNELS.FOLDER_CREATE,
    async (_event, req: Omit<Folder, 'id' | 'createdAt'>) => {
      const folder: Folder = { ...req, id: randomUUID(), createdAt: new Date().toISOString() }
      store.set('folders', [...store.get('folders'), folder])
      return folder
    }
  )

  ipcMain.handle(CHANNELS.FOLDER_UPDATE, async (_event, req: Folder) => {
    store.set(
      'folders',
      store.get('folders').map((f) => (f.id === req.id ? req : f))
    )
    return req
  })

  ipcMain.handle(CHANNELS.FOLDER_DELETE, async (_event, id: string) => {
    // Remove the folder and move its queries to the uncategorized (null) folder.
    store.set(
      'folders',
      store.get('folders').filter((f) => f.id !== id)
    )
    store.set(
      'savedQueries',
      store.get('savedQueries').map((q) => (q.folderId === id ? { ...q, folderId: null } : q))
    )
  })
}
