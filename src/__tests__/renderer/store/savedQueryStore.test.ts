/**
 * savedQueryStore.test.ts
 * Tests for the savedQueryStore Zustand store (src/renderer/src/store/savedQueryStore.ts).
 */
import { describe, it, expect, beforeEach } from 'vitest'
import { CHANNELS } from '../../../shared/ipc'
import type { SavedQuery, Folder } from '../../../shared/types'

// window.api is stubbed globally in src/__tests__/setup.ts

function invoke() {
  return window.api.invoke as ReturnType<typeof vi.fn>
}

function makeQuery(id = 'q1', folderId: string | null = null): SavedQuery {
  return {
    id, title: 'Query', sql: 'SELECT 1', connectionId: 'conn-1',
    folderId, createdAt: '2024-01-01T00:00:00Z', updatedAt: '2024-01-01T00:00:00Z'
  }
}

function makeFolder(id = 'f1'): Folder {
  return { id, name: 'Folder', parentId: null, createdAt: '2024-01-01T00:00:00Z' }
}

describe('savedQueryStore', () => {
  let store: Awaited<ReturnType<typeof importStore>>

  async function importStore() {
    const { useSavedQueryStore } = await import('../../../renderer/src/store/savedQueryStore')
    return useSavedQueryStore.getState()
  }

  beforeEach(async () => {
    vi.resetModules()
    store = await importStore()
  })

  it('starts with empty queries and folders', () => {
    expect(store.queries).toEqual([])
    expect(store.folders).toEqual([])
  })

  it('load fetches queries and folders and stores them', async () => {
    const q = makeQuery('q1')
    const f = makeFolder('f1')
    invoke()
      .mockResolvedValueOnce([q])   // SAVED_QUERY_LIST
      .mockResolvedValueOnce([f])   // FOLDER_LIST

    await store.load()
    store = (await importStore())

    expect(invoke()).toHaveBeenCalledWith(CHANNELS.SAVED_QUERY_LIST, undefined)
    expect(invoke()).toHaveBeenCalledWith(CHANNELS.FOLDER_LIST, undefined)
  })

  it('saveQuery appends the returned query to the list', async () => {
    const saved = makeQuery('new-q')
    invoke().mockResolvedValueOnce(saved)

    const result = await store.saveQuery({ title: 'New', sql: 'SELECT 1', connectionId: 'c', folderId: null })
    store = await importStore()

    expect(result).toEqual(saved)
    expect(invoke()).toHaveBeenCalledWith(CHANNELS.SAVED_QUERY_SAVE, expect.any(Object))
  })

  it('deleteQuery removes the query from the list', async () => {
    // Pre-seed the store
    invoke().mockResolvedValueOnce([makeQuery('q1'), makeQuery('q2')]).mockResolvedValueOnce([])
    await store.load()

    invoke().mockResolvedValueOnce(undefined) // SAVED_QUERY_DELETE
    await store.deleteQuery('q1')
    store = await importStore()

    expect(invoke()).toHaveBeenCalledWith(CHANNELS.SAVED_QUERY_DELETE, 'q1')
  })

  it('createFolder appends the returned folder', async () => {
    const folder = makeFolder('new-f')
    invoke().mockResolvedValueOnce(folder)

    const result = await store.createFolder('Analytics')
    store = await importStore()

    expect(result).toEqual(folder)
    expect(invoke()).toHaveBeenCalledWith(CHANNELS.FOLDER_CREATE, expect.objectContaining({ name: 'Analytics' }))
  })

  it('deleteFolder removes the folder and moves its queries to null', async () => {
    // Seed store with a folder and two queries
    invoke()
      .mockResolvedValueOnce([makeQuery('q1', 'f1'), makeQuery('q2', null)])
      .mockResolvedValueOnce([makeFolder('f1')])
    await store.load()

    invoke().mockResolvedValueOnce(undefined) // FOLDER_DELETE
    await store.deleteFolder('f1')
    store = await importStore()

    expect(invoke()).toHaveBeenCalledWith(CHANNELS.FOLDER_DELETE, 'f1')
  })
})
