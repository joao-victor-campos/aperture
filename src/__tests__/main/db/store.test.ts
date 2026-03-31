/**
 * store.test.ts
 * Tests the lightweight JSON persistence layer (src/main/db/store.ts).
 * Uses a temp directory per test so tests never touch the real userData path.
 */
import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest'
import { mkdtempSync, rmSync, writeFileSync } from 'fs'
import { join } from 'path'
import { tmpdir } from 'os'
import type { Connection } from '../../../shared/types'

let storeDir = ''

// Mock electron so app.getPath('userData') returns our temp dir
vi.mock('electron', () => ({
  app: { getPath: (_name: string) => storeDir }
}))

// Helper: a minimal valid Connection object
function makeConn(id = 'c1'): Connection {
  return { id, name: 'Test', engine: 'bigquery', projectId: 'my-project', credentialType: 'adc', createdAt: '2024-01-01T00:00:00.000Z' }
}

describe('store', () => {
  beforeEach(() => {
    storeDir = mkdtempSync(join(tmpdir(), 'aperture-store-'))
    // Reset module so the in-memory cache (let data = null) starts fresh each test
    vi.resetModules()
  })

  afterEach(() => {
    rmSync(storeDir, { recursive: true, force: true })
  })

  it('returns empty arrays as defaults when no file exists', async () => {
    // Arrange / Act
    const { store } = await import('../../../main/db/store')

    // Assert
    expect(store.get('connections')).toEqual([])
    expect(store.get('savedQueries')).toEqual([])
    expect(store.get('folders')).toEqual([])
  })

  it('persists a value and retrieves it in the same session', async () => {
    // Arrange
    const { store } = await import('../../../main/db/store')
    const conn = makeConn()

    // Act
    store.set('connections', [conn])

    // Assert
    expect(store.get('connections')).toEqual([conn])
  })

  it('survives a module reload — data is written to disk and re-read', async () => {
    // Arrange — write via first module instance
    const { store: s1 } = await import('../../../main/db/store')
    s1.set('connections', [makeConn()])

    // Act — reload the module (simulates app restart)
    vi.resetModules()
    const { store: s2 } = await import('../../../main/db/store')

    // Assert — data was persisted
    expect(s2.get('connections')).toHaveLength(1)
    expect(s2.get('connections')[0].id).toBe('c1')
  })

  it('returns defaults when the stored JSON file is corrupt', async () => {
    // Arrange — write corrupt JSON
    writeFileSync(join(storeDir, 'aperture-store.json'), '<<<not json>>>')

    // Act
    const { store } = await import('../../../main/db/store')

    // Assert
    expect(store.get('connections')).toEqual([])
  })

  it('stores different keys independently', async () => {
    // Arrange
    const { store } = await import('../../../main/db/store')
    const q = { id: 'q1', folderId: null, title: 'Q', sql: 'SELECT 1', createdAt: '2024-01-01', updatedAt: '2024-01-01' }

    // Act
    store.set('savedQueries', [q])

    // Assert — connections are still empty; savedQueries has the entry
    expect(store.get('connections')).toEqual([])
    expect(store.get('savedQueries')).toEqual([q])
  })
})
