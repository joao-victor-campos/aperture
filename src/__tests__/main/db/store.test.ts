/**
 * store.test.ts
 * Tests the lightweight JSON persistence layer (src/main/db/store.ts).
 * Uses a temp directory per test so tests never touch the real userData path.
 */
import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest'
import { mkdtempSync, rmSync, writeFileSync, readFileSync, existsSync } from 'fs'
import { join } from 'path'
import { tmpdir } from 'os'
import type { Connection } from '../../../shared/types'

let storeDir = ''
let cipherAvailable = true

// Mock electron: app.getPath returns our temp dir; safeStorage is a reversible
// fake ("sealed:<plain>") whose availability each test can toggle.
vi.mock('electron', () => ({
  app: { getPath: (_name: string) => storeDir },
  safeStorage: {
    isEncryptionAvailable: () => cipherAvailable,
    encryptString: (plain: string) => Buffer.from(`sealed:${plain}`, 'utf-8'),
    decryptString: (buf: Buffer) => {
      const s = buf.toString('utf-8')
      if (!s.startsWith('sealed:')) throw new Error('decryption failed')
      return s.slice('sealed:'.length)
    },
  },
}))

// Helper: a minimal valid Connection object
function makeConn(id = 'c1'): Connection {
  return { id, name: 'Test', engine: 'bigquery', projectId: 'my-project', credentialType: 'adc', createdAt: '2024-01-01T00:00:00.000Z' }
}

describe('store', () => {
  beforeEach(() => {
    storeDir = mkdtempSync(join(tmpdir(), 'aperture-store-'))
    cipherAvailable = true
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

describe('store — secret encryption at rest', () => {
  const STORE = () => join(storeDir, 'aperture-store.json')
  const BAK = () => join(storeDir, 'aperture-store.json.bak')

  function pgConn(password = 'hunter2'): Connection {
    return {
      id: 'p1', name: 'PG', engine: 'postgres', createdAt: '2024-01-01T00:00:00.000Z',
      host: 'localhost', port: 5432, database: 'db', user: 'u', password,
    }
  }
  const sealed = (plain: string) =>
    'enc:v1:' + Buffer.from(`sealed:${plain}`, 'utf-8').toString('base64')

  beforeEach(() => {
    // Fresh temp dir + module registry per test: without this, the module-level
    // `data` cache and on-disk fixtures leak across tests in this block (the
    // store module is only re-imported, not re-loaded, unless the cache is reset).
    storeDir = mkdtempSync(join(tmpdir(), 'aperture-store-'))
    cipherAvailable = true
    vi.resetModules()
  })

  afterEach(() => {
    rmSync(storeDir, { recursive: true, force: true })
  })

  it('writes passwords encrypted on disk but returns them decrypted in memory', async () => {
    const { store } = await import('../../../main/db/store')

    store.set('connections', [pgConn()])

    const onDisk = JSON.parse(readFileSync(STORE(), 'utf-8'))
    expect(onDisk.connections[0].password).toBe(sealed('hunter2'))
    expect((store.get('connections')[0] as { password: string }).password).toBe('hunter2')
  })

  it('round-trips the apiKey through a module reload (encrypt → disk → decrypt)', async () => {
    const { store: s1 } = await import('../../../main/db/store')
    s1.set('aiConfig', { apiKey: 'sk-ant-secret', model: 'm', inlineCompletionEnabled: false })

    vi.resetModules()
    const { store: s2 } = await import('../../../main/db/store')

    expect(s2.get('aiConfig').apiKey).toBe('sk-ant-secret')
    const onDisk = JSON.parse(readFileSync(STORE(), 'utf-8'))
    expect(onDisk.aiConfig.apiKey).toBe(sealed('sk-ant-secret'))
  })

  it('migrates a legacy plaintext store on load: .bak written, file re-persisted encrypted', async () => {
    writeFileSync(STORE(), JSON.stringify({ connections: [pgConn()] }, null, 2))

    const { store } = await import('../../../main/db/store')
    // any read triggers the lazy load + migration
    expect((store.get('connections')[0] as { password: string }).password).toBe('hunter2')

    const bak = JSON.parse(readFileSync(BAK(), 'utf-8'))
    expect(bak.connections[0].password).toBe('hunter2')
    const migrated = JSON.parse(readFileSync(STORE(), 'utf-8'))
    expect(migrated.connections[0].password).toBe(sealed('hunter2'))
  })

  it('is idempotent: a fully-encrypted store loads without writing a .bak or touching the file', async () => {
    const encryptedFile = JSON.stringify({ connections: [{ ...pgConn(), password: sealed('hunter2') }] }, null, 2)
    writeFileSync(STORE(), encryptedFile)

    const { store } = await import('../../../main/db/store')
    expect((store.get('connections')[0] as { password: string }).password).toBe('hunter2')

    expect(existsSync(BAK())).toBe(false)
    expect(readFileSync(STORE(), 'utf-8')).toBe(encryptedFile)
  })

  it('never overwrites an existing .bak', async () => {
    writeFileSync(BAK(), '{"sentinel":true}')
    writeFileSync(STORE(), JSON.stringify({ connections: [pgConn()] }, null, 2))

    const { store } = await import('../../../main/db/store')
    store.get('connections')

    expect(readFileSync(BAK(), 'utf-8')).toBe('{"sentinel":true}')
  })

  it('keeps plaintext and skips migration when encryption is unavailable, warning once', async () => {
    cipherAvailable = false
    const warnSpy = vi.spyOn(console, 'warn').mockImplementation(() => {})
    writeFileSync(STORE(), JSON.stringify({ connections: [pgConn()] }, null, 2))

    const { store } = await import('../../../main/db/store')
    expect((store.get('connections')[0] as { password: string }).password).toBe('hunter2')
    store.set('connections', [pgConn('other')])

    expect(existsSync(BAK())).toBe(false)
    const onDisk = JSON.parse(readFileSync(STORE(), 'utf-8'))
    expect(onDisk.connections[0].password).toBe('other')
    expect(warnSpy).toHaveBeenCalledTimes(1)
    warnSpy.mockRestore()
  })

  it('migrates only the plaintext values in a mixed store', async () => {
    writeFileSync(STORE(), JSON.stringify({
      connections: [pgConn(), { ...pgConn(), id: 'p2', password: sealed('already') }],
    }, null, 2))

    const { store } = await import('../../../main/db/store')
    const conns = store.get('connections') as Array<{ password: string }>
    expect(conns[0].password).toBe('hunter2')
    expect(conns[1].password).toBe('already')

    // After migration both values are encrypted; the pre-encrypted one is not
    // double-wrapped (the deterministic fake cipher makes this assertable).
    const migrated = JSON.parse(readFileSync(STORE(), 'utf-8'))
    expect(migrated.connections[0].password).toBe(sealed('hunter2'))
    expect(migrated.connections[1].password).toBe(sealed('already'))
  })

  it('resets an undecryptable value to "" without losing the rest of the store', async () => {
    const warnSpy = vi.spyOn(console, 'warn').mockImplementation(() => {})
    const corrupt = 'enc:v1:' + Buffer.from('garbage', 'utf-8').toString('base64')
    writeFileSync(STORE(), JSON.stringify({
      connections: [{ ...pgConn(), password: corrupt }],
      savedQueries: [{ id: 'q1', folderId: null, title: 'Q', sql: 'SELECT 1', createdAt: '2024-01-01', updatedAt: '2024-01-01' }],
    }, null, 2))

    const { store } = await import('../../../main/db/store')
    expect((store.get('connections')[0] as { password: string }).password).toBe('')
    expect(store.get('savedQueries')).toHaveLength(1)
    warnSpy.mockRestore()
  })
})
