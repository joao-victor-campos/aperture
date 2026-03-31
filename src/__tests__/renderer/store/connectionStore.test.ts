/**
 * connectionStore.test.ts
 * Tests the Zustand connection store (src/renderer/src/store/connectionStore.ts).
 * window.api is stubbed in setup.ts; individual tests configure return values.
 */
import { describe, it, expect, vi, beforeEach } from 'vitest'
import { CHANNELS } from '../../../shared/ipc'
import type { Connection } from '../../../shared/types'

// ── Helpers ───────────────────────────────────────────────────────────────────
function makeConn(id: string, name = 'Conn'): Connection {
  return { id, name, engine: 'bigquery', projectId: 'proj', credentialType: 'adc', createdAt: '2024-01-01T00:00:00Z' }
}

const invoke = () => window.api.invoke as ReturnType<typeof vi.fn>

// ── Store reset helper (runs before each test) ────────────────────────────────
let useConnectionStore: typeof import('../../../renderer/src/store/connectionStore').useConnectionStore

beforeEach(async () => {
  vi.resetModules()
  // Re-import after module reset so the Zustand store starts from initial state
  ;({ useConnectionStore } = await import('../../../renderer/src/store/connectionStore'))
})

describe('connectionStore', () => {
  describe('initial state', () => {
    it('starts with no connections and no active connection', () => {
      // Assert
      const state = useConnectionStore.getState()
      expect(state.connections).toEqual([])
      expect(state.activeConnectionId).toBeNull()
      expect(state.isLoading).toBe(false)
    })
  })

  describe('load', () => {
    it('fetches connections and sets the first one as active', async () => {
      // Arrange
      const conns = [makeConn('a'), makeConn('b')]
      invoke().mockResolvedValueOnce(conns)

      // Act
      await useConnectionStore.getState().load()

      // Assert
      const { connections, activeConnectionId } = useConnectionStore.getState()
      expect(connections).toEqual(conns)
      expect(activeConnectionId).toBe('a')
      expect(invoke()).toHaveBeenCalledWith(CHANNELS.CONNECTIONS_LIST)
    })

    it('does not override an already-active connection on reload', async () => {
      // Arrange — pre-set an active id
      useConnectionStore.setState({ activeConnectionId: 'b' })
      invoke().mockResolvedValueOnce([makeConn('a'), makeConn('b')])

      // Act
      await useConnectionStore.getState().load()

      // Assert — active should stay 'b'
      expect(useConnectionStore.getState().activeConnectionId).toBe('b')
    })
  })

  describe('add', () => {
    it('inserts the new connection returned by the API', async () => {
      // Arrange
      const newConn = makeConn('new-1')
      invoke().mockResolvedValueOnce(newConn)

      // Act
      const result = await useConnectionStore.getState().add({
        engine: 'bigquery',
        name: 'New',
        projectId: 'p',
        credentialType: 'adc'
      })

      // Assert
      expect(result).toEqual(newConn)
      expect(useConnectionStore.getState().connections).toContainEqual(newConn)
    })

    it('sets the new connection as active when none was active before', async () => {
      // Arrange
      invoke().mockResolvedValueOnce(makeConn('first'))

      // Act
      await useConnectionStore.getState().add({ engine: 'bigquery', name: 'First', projectId: 'p', credentialType: 'adc' })

      // Assert
      expect(useConnectionStore.getState().activeConnectionId).toBe('first')
    })
  })

  describe('update', () => {
    it('replaces the connection with the updated version', async () => {
      // Arrange
      useConnectionStore.setState({ connections: [makeConn('c1', 'Old Name')] })
      const updated = makeConn('c1', 'New Name')
      invoke().mockResolvedValueOnce(updated)

      // Act
      await useConnectionStore.getState().update(updated)

      // Assert
      const { connections } = useConnectionStore.getState()
      expect(connections[0].name).toBe('New Name')
    })
  })

  describe('remove', () => {
    it('removes the connection and clears activeConnectionId when it was active', async () => {
      // Arrange
      useConnectionStore.setState({ connections: [makeConn('c1'), makeConn('c2')], activeConnectionId: 'c1' })
      invoke().mockResolvedValueOnce(undefined)

      // Act
      await useConnectionStore.getState().remove('c1')

      // Assert
      const { connections, activeConnectionId } = useConnectionStore.getState()
      expect(connections).toHaveLength(1)
      expect(connections[0].id).toBe('c2')
      expect(activeConnectionId).toBeNull()
    })

    it('keeps activeConnectionId when a different connection is removed', async () => {
      // Arrange
      useConnectionStore.setState({ connections: [makeConn('c1'), makeConn('c2')], activeConnectionId: 'c1' })
      invoke().mockResolvedValueOnce(undefined)

      // Act
      await useConnectionStore.getState().remove('c2')

      // Assert
      expect(useConnectionStore.getState().activeConnectionId).toBe('c1')
    })
  })

  describe('setActive', () => {
    it('updates activeConnectionId', () => {
      // Act
      useConnectionStore.getState().setActive('conn-xyz')

      // Assert
      expect(useConnectionStore.getState().activeConnectionId).toBe('conn-xyz')
    })
  })

  describe('test', () => {
    it('calls the TEST channel with the connection id', async () => {
      // Arrange
      invoke().mockResolvedValueOnce({ ok: true })

      // Act
      const result = await useConnectionStore.getState().test('c1')

      // Assert
      expect(result).toEqual({ ok: true })
      expect(invoke()).toHaveBeenCalledWith(CHANNELS.CONNECTIONS_TEST, 'c1')
    })
  })
})
