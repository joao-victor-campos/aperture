/**
 * savedQueries.test.ts
 * Tests the saved query + folder IPC handlers (src/main/ipc/savedQueries.ts).
 */
import { describe, it, expect, vi, beforeEach } from 'vitest'
import { CHANNELS } from '../../../shared/ipc'
import type { SavedQuery, Folder } from '../../../shared/types'

// ── Capture ipcMain.handle registrations ─────────────────────────────────────
type Handler = (event: unknown, req?: unknown) => unknown
const handlers = new Map<string, Handler>()

vi.mock('electron', () => ({
  ipcMain: {
    handle: (channel: string, fn: Handler) => handlers.set(channel, fn)
  }
}))

// ── Mock: store ───────────────────────────────────────────────────────────────
type StoreData = { savedQueries: SavedQuery[]; folders: Folder[] }
const storeData: StoreData = { savedQueries: [], folders: [] }

vi.mock('../../../main/db/store', () => ({
  store: {
    get: vi.fn((key: keyof StoreData) => storeData[key]),
    set: vi.fn((key: keyof StoreData, val: SavedQuery[] | Folder[]) => {
      (storeData[key] as typeof val) = val
    })
  }
}))

// ── Helpers ───────────────────────────────────────────────────────────────────
function makeQuery(id = 'q1', folderId: string | null = null): SavedQuery {
  return {
    id, title: 'My query', sql: 'SELECT 1', connectionId: 'conn-1',
    folderId, createdAt: '2024-01-01T00:00:00Z', updatedAt: '2024-01-01T00:00:00Z'
  }
}

function makeFolder(id = 'f1'): Folder {
  return { id, name: 'My folder', parentId: null, createdAt: '2024-01-01T00:00:00Z' }
}

describe('SavedQuery IPC handlers', () => {
  beforeEach(async () => {
    handlers.clear()
    storeData.savedQueries = []
    storeData.folders = []
    vi.clearAllMocks()

    const { registerSavedQueryHandlers } = await import('../../../main/ipc/savedQueries')
    registerSavedQueryHandlers()
  })

  // ── SAVED_QUERY_LIST ──────────────────────────────────────────────────────
  it('SAVED_QUERY_LIST returns the stored queries', async () => {
    storeData.savedQueries.push(makeQuery())
    const result = await handlers.get(CHANNELS.SAVED_QUERY_LIST)!({})
    expect((result as SavedQuery[]).length).toBe(1)
  })

  // ── SAVED_QUERY_SAVE ──────────────────────────────────────────────────────
  it('SAVED_QUERY_SAVE creates a query with id, createdAt, updatedAt', async () => {
    const payload = { title: 'New', sql: 'SELECT 2', connectionId: 'c1', folderId: null }
    const result = await handlers.get(CHANNELS.SAVED_QUERY_SAVE)!({}, payload) as SavedQuery

    expect(result.id).toBeDefined()
    expect(result.createdAt).toBeDefined()
    expect(result.updatedAt).toBeDefined()
    expect(storeData.savedQueries).toHaveLength(1)
  })

  // ── SAVED_QUERY_UPDATE ────────────────────────────────────────────────────
  it('SAVED_QUERY_UPDATE replaces the query and bumps updatedAt', async () => {
    const q = makeQuery('q1')
    storeData.savedQueries.push(q)
    const updated = { ...q, title: 'Renamed', updatedAt: q.updatedAt }

    const result = await handlers.get(CHANNELS.SAVED_QUERY_UPDATE)!({}, updated) as SavedQuery

    expect(result.title).toBe('Renamed')
    expect(result.updatedAt).not.toBe(q.updatedAt) // bumped
    expect(storeData.savedQueries[0].title).toBe('Renamed')
  })

  // ── SAVED_QUERY_DELETE ────────────────────────────────────────────────────
  it('SAVED_QUERY_DELETE removes the query by id', async () => {
    storeData.savedQueries.push(makeQuery('q1'), makeQuery('q2'))
    await handlers.get(CHANNELS.SAVED_QUERY_DELETE)!({}, 'q1')

    expect(storeData.savedQueries).toHaveLength(1)
    expect(storeData.savedQueries[0].id).toBe('q2')
  })

  // ── FOLDER_LIST ───────────────────────────────────────────────────────────
  it('FOLDER_LIST returns the stored folders', async () => {
    storeData.folders.push(makeFolder())
    const result = await handlers.get(CHANNELS.FOLDER_LIST)!({})
    expect((result as Folder[]).length).toBe(1)
  })

  // ── FOLDER_CREATE ─────────────────────────────────────────────────────────
  it('FOLDER_CREATE creates a folder with id and createdAt', async () => {
    const result = await handlers.get(CHANNELS.FOLDER_CREATE)!({}, { name: 'Reports', parentId: null }) as Folder

    expect(result.id).toBeDefined()
    expect(result.name).toBe('Reports')
    expect(result.createdAt).toBeDefined()
    expect(storeData.folders).toHaveLength(1)
  })

  // ── FOLDER_UPDATE ─────────────────────────────────────────────────────────
  it('FOLDER_UPDATE renames a folder', async () => {
    storeData.folders.push(makeFolder('f1'))
    const updated = { ...makeFolder('f1'), name: 'Analytics' }

    const result = await handlers.get(CHANNELS.FOLDER_UPDATE)!({}, updated) as Folder

    expect(result.name).toBe('Analytics')
    expect(storeData.folders[0].name).toBe('Analytics')
  })

  // ── FOLDER_DELETE ─────────────────────────────────────────────────────────
  it('FOLDER_DELETE removes the folder and moves its queries to null folder', async () => {
    storeData.folders.push(makeFolder('f1'), makeFolder('f2'))
    storeData.savedQueries.push(makeQuery('q1', 'f1'), makeQuery('q2', 'f2'))

    await handlers.get(CHANNELS.FOLDER_DELETE)!({}, 'f1')

    expect(storeData.folders).toHaveLength(1)
    expect(storeData.folders[0].id).toBe('f2')
    // q1 should be moved to uncategorized
    expect(storeData.savedQueries.find((q) => q.id === 'q1')?.folderId).toBeNull()
    // q2 should remain in f2
    expect(storeData.savedQueries.find((q) => q.id === 'q2')?.folderId).toBe('f2')
  })
})
