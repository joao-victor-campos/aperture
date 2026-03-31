/**
 * connections.test.ts
 * Tests the IPC connection handlers (src/main/ipc/connections.ts).
 * ipcMain, store, and bigquery are fully mocked.
 */
import { describe, it, expect, vi, beforeEach } from 'vitest'
import { CHANNELS } from '../../../shared/ipc'
import type { Connection } from '../../../shared/types'

// ── Capture ipcMain.handle registrations ────────────────────────────────────
type Handler = (event: unknown, req?: unknown) => unknown
const handlers = new Map<string, Handler>()

vi.mock('electron', () => ({
  ipcMain: {
    handle: (channel: string, fn: Handler) => handlers.set(channel, fn)
  }
}))

// ── Mock: adapter registry (engine dispatch) ────────────────────────────────
const bigAdapter = {
  testConnection: vi.fn(),
  invalidateClient: vi.fn()
}

const pgAdapter = {
  testConnection: vi.fn(),
  invalidateClient: vi.fn()
}

vi.mock('../../../main/db/adapterRegistry', () => ({
  getAdapterForEngine: (engine: 'bigquery' | 'postgres') => (engine === 'bigquery' ? bigAdapter : pgAdapter),
  getAdapterForConnection: (connection: Connection) =>
    connection.engine === 'bigquery' ? bigAdapter : pgAdapter
}))

// ── Mock: store ──────────────────────────────────────────────────────────────
const storedConnections: Connection[] = []

vi.mock('../../../main/db/store', () => ({
  store: {
    get: vi.fn((_key: string) => storedConnections),
    set: vi.fn((_key: string, value: Connection[]) => {
      storedConnections.splice(0, storedConnections.length, ...value)
    })
  }
}))

// ── Helpers ──────────────────────────────────────────────────────────────────
function makeConn(id = 'c1'): Connection {
  return {
    id,
    name: 'Prod',
    engine: 'bigquery',
    projectId: 'proj',
    credentialType: 'adc',
    createdAt: '2024-01-01T00:00:00Z'
  }
}

describe('Connection IPC handlers', () => {
  beforeEach(async () => {
    handlers.clear()
    storedConnections.splice(0) // clear array in-place
    vi.clearAllMocks()

    const { registerConnectionHandlers } = await import('../../../main/ipc/connections')
    registerConnectionHandlers()
  })

  describe(CHANNELS.CONNECTIONS_LIST, () => {
    it('returns the stored connections array', async () => {
      // Arrange
      storedConnections.push(makeConn())
      const handler = handlers.get(CHANNELS.CONNECTIONS_LIST)!

      // Act
      const result = await handler({})

      // Assert
      expect(result).toHaveLength(1)
      expect((result as Connection[])[0].id).toBe('c1')
    })
  })

  describe(CHANNELS.CONNECTIONS_ADD, () => {
    it('creates a connection with a generated id and createdAt timestamp', async () => {
      // Arrange
      const handler = handlers.get(CHANNELS.CONNECTIONS_ADD)!
      const payload = { engine: 'bigquery' as const, name: 'Dev', projectId: 'dev-proj', credentialType: 'adc' as const }

      // Act
      const newConn = await handler({}, payload) as Connection

      // Assert
      expect(newConn.id).toBeDefined()
      expect(newConn.name).toBe('Dev')
      expect(newConn.createdAt).toBeDefined()
      expect(storedConnections).toHaveLength(1)
    })

    it('appends to existing connections', async () => {
      // Arrange
      storedConnections.push(makeConn('existing'))
      const handler = handlers.get(CHANNELS.CONNECTIONS_ADD)!

      // Act
      await handler({}, { engine: 'bigquery' as const, name: 'New', projectId: 'p', credentialType: 'adc' as const })

      // Assert
      expect(storedConnections).toHaveLength(2)
    })
  })

  describe(CHANNELS.CONNECTIONS_UPDATE, () => {
    it('replaces the matching connection and invalidates the client cache', async () => {
      // Arrange
      storedConnections.push(makeConn('c1'))
      const updated = { ...makeConn('c1'), name: 'Updated' }
      const handler = handlers.get(CHANNELS.CONNECTIONS_UPDATE)!

      // Act
      const result = await handler({}, updated) as Connection

      // Assert
      expect(result.name).toBe('Updated')
      expect(storedConnections[0].name).toBe('Updated')

      expect(bigAdapter.invalidateClient).toHaveBeenCalledWith('c1')
    })
  })

  describe(CHANNELS.CONNECTIONS_DELETE, () => {
    it('removes the connection by id and invalidates the client cache', async () => {
      // Arrange
      storedConnections.push(makeConn('c1'), makeConn('c2'))
      const handler = handlers.get(CHANNELS.CONNECTIONS_DELETE)!

      // Act
      await handler({}, 'c1')

      // Assert
      expect(storedConnections).toHaveLength(1)
      expect(storedConnections[0].id).toBe('c2')

      expect(bigAdapter.invalidateClient).toHaveBeenCalledWith('c1')
    })
  })

  describe(CHANNELS.CONNECTIONS_TEST, () => {
    it('returns the result from testConnection when the connection exists', async () => {
      // Arrange
      storedConnections.push(makeConn('c1'))
      bigAdapter.testConnection.mockResolvedValueOnce({ ok: true })
      const handler = handlers.get(CHANNELS.CONNECTIONS_TEST)!

      // Act
      const result = await handler({}, 'c1')

      // Assert
      expect(result).toEqual({ ok: true })
    })

    it('dispatches to the Postgres adapter for CONNECTIONS_TEST', async () => {
      // Arrange
      const pgConn: Connection = {
        id: 'conn-pg',
        name: 'PG',
        engine: 'postgres',
        host: 'localhost',
        port: 5432,
        database: 'db',
        user: 'user',
        password: 'pw',
        createdAt: '2024-01-01T00:00:00Z'
      }
      storedConnections.push(pgConn)
      pgAdapter.testConnection.mockResolvedValueOnce({ ok: true })
      const handler = handlers.get(CHANNELS.CONNECTIONS_TEST)!

      // Act
      const result = await handler({}, 'conn-pg')

      // Assert
      expect(result).toEqual({ ok: true })
      expect(pgAdapter.testConnection).toHaveBeenCalledWith(pgConn)
    })

    it('returns ok:false with error when the connection id is not found', async () => {
      // Arrange — empty store
      const handler = handlers.get(CHANNELS.CONNECTIONS_TEST)!

      // Act
      const result = await handler({}, 'non-existent') as { ok: boolean; error: string }

      // Assert
      expect(result.ok).toBe(false)
      expect(result.error).toMatch(/not found/i)
    })
  })
})
