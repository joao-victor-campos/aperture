/**
 * catalogStore.test.ts
 * Tests the Zustand catalog store (src/renderer/src/store/catalogStore.ts).
 */
import { describe, it, expect, vi, beforeEach } from 'vitest'
import { CHANNELS } from '../../../shared/ipc'
import type { Dataset, Table, TableField } from '../../../shared/types'

const invoke = () => window.api.invoke as ReturnType<typeof vi.fn>

let useCatalogStore: typeof import('../../../renderer/src/store/catalogStore').useCatalogStore

beforeEach(async () => {
  vi.resetModules()
  ;({ useCatalogStore } = await import('../../../renderer/src/store/catalogStore'))
})

// ── Sample data ───────────────────────────────────────────────────────────────
const dataset: Dataset = { id: 'ds1', projectId: 'proj', name: 'ds1' }
const table: Table = { id: 'tbl1', datasetId: 'ds1', projectId: 'proj', name: 'tbl1', type: 'TABLE' }
const field: TableField = { name: 'id', type: 'INTEGER', mode: 'REQUIRED' }

describe('catalogStore', () => {
  describe('initial state', () => {
    it('starts empty with no loading state', () => {
      const state = useCatalogStore.getState()
      expect(state.datasetsByConnection).toEqual({})
      expect(state.tablesByDataset).toEqual({})
      expect(state.expandedDatasets.size).toBe(0)
    })
  })

  describe('loadDatasets', () => {
    it('fetches and stores datasets keyed by connectionId', async () => {
      // Arrange
      invoke().mockResolvedValueOnce([dataset])

      // Act
      await useCatalogStore.getState().loadDatasets('conn-1')

      // Assert
      expect(useCatalogStore.getState().datasetsByConnection['conn-1']).toEqual([dataset])
      expect(invoke()).toHaveBeenCalledWith(CHANNELS.CATALOG_DATASETS, 'conn-1')
    })

    it('sets and then clears the isLoading flag', async () => {
      // Arrange — capture loading state during the call
      let loadingDuringCall = false
      invoke().mockImplementationOnce(() => {
        loadingDuringCall = useCatalogStore.getState().isLoading['conn-1']
        return Promise.resolve([dataset])
      })

      // Act
      await useCatalogStore.getState().loadDatasets('conn-1')

      // Assert
      expect(loadingDuringCall).toBe(true)
      expect(useCatalogStore.getState().isLoading['conn-1']).toBe(false)
    })
  })

  describe('loadTables', () => {
    it('fetches and stores tables keyed by "connectionId:datasetId"', async () => {
      // Arrange
      invoke().mockResolvedValueOnce([table])

      // Act
      await useCatalogStore.getState().loadTables('conn-1', 'ds1')

      // Assert
      expect(useCatalogStore.getState().tablesByDataset['conn-1:ds1']).toEqual([table])
      expect(invoke()).toHaveBeenCalledWith(CHANNELS.CATALOG_TABLES, { connectionId: 'conn-1', datasetId: 'ds1' })
    })
  })

  describe('loadSchema', () => {
    it('calls the TABLE_SCHEMA channel with all required params and returns fields', async () => {
      // Arrange
      invoke().mockResolvedValueOnce([field])

      // Act
      const result = await useCatalogStore.getState().loadSchema('conn-1', 'proj', 'ds1', 'tbl1')

      // Assert
      expect(result).toEqual([field])
      expect(invoke()).toHaveBeenCalledWith(CHANNELS.CATALOG_TABLE_SCHEMA, {
        connectionId: 'conn-1', projectId: 'proj', datasetId: 'ds1', tableId: 'tbl1'
      })
    })

    it('returns cached without re-invoking for a full (non-coarse) key', async () => {
      // Arrange: first load populates the cache (not via warmCatalog, so not coarse)
      invoke().mockResolvedValueOnce([field])
      await useCatalogStore.getState().loadSchema('conn-1', 'proj', 'ds1', 'tbl1')
      invoke().mockClear()

      // Act: second call should short-circuit
      const result = await useCatalogStore.getState().loadSchema('conn-1', 'proj', 'ds1', 'tbl1')

      // Assert
      expect(result).toEqual([field])
      expect(invoke()).not.toHaveBeenCalled()
    })

    it('re-fetches a coarse warmed key and removes it from coarseSchemaKeys', async () => {
      // Arrange: warm the catalog so ds1/t1 is populated coarsely
      const ds1: Dataset = { id: 'ds1', projectId: 'proj', name: 'ds1' }
      const t1: Table = { id: 't1', datasetId: 'ds1', projectId: 'proj', name: 't1', type: 'TABLE' }
      const coarseFields: TableField[] = [{ name: 'id', type: 'INT64', mode: 'NULLABLE' }]
      const fullFields: TableField[] = [
        { name: 'id', type: 'INT64', mode: 'REQUIRED' },
        { name: 'desc', type: 'STRING', mode: 'NULLABLE' },
      ]

      invoke().mockImplementation((channel: string, arg: unknown) => {
        if (channel === CHANNELS.CATALOG_DATASETS) return Promise.resolve([ds1])
        if (channel === CHANNELS.CATALOG_TABLES) return Promise.resolve([t1])
        if (channel === CHANNELS.CATALOG_DATASET_COLUMNS) return Promise.resolve({ t1: coarseFields })
        return Promise.resolve(undefined)
      })
      await useCatalogStore.getState().warmCatalog('conn-1')

      // Verify coarse key is tracked
      const cacheKey = 'conn-1:ds1:t1'
      expect(useCatalogStore.getState().coarseSchemaKeys.has(cacheKey)).toBe(true)
      expect(useCatalogStore.getState().schemaCache[cacheKey]).toEqual(coarseFields)

      // Now wire up the full-fidelity response for TABLE_SCHEMA
      invoke().mockImplementation((channel: string) => {
        if (channel === CHANNELS.CATALOG_TABLE_SCHEMA) return Promise.resolve(fullFields)
        return Promise.resolve(undefined)
      })

      // Act: loadSchema should re-fetch (not return cached coarse)
      const result = await useCatalogStore.getState().loadSchema('conn-1', 'proj', 'ds1', 't1')

      // Assert: full fields returned, key removed from coarseSchemaKeys
      expect(result).toEqual(fullFields)
      expect(invoke()).toHaveBeenCalledWith(CHANNELS.CATALOG_TABLE_SCHEMA, {
        connectionId: 'conn-1', projectId: 'proj', datasetId: 'ds1', tableId: 't1'
      })
      expect(useCatalogStore.getState().schemaCache[cacheKey]).toEqual(fullFields)
      expect(useCatalogStore.getState().coarseSchemaKeys.has(cacheKey)).toBe(false)

      // Second call should now short-circuit (key no longer coarse)
      invoke().mockClear()
      const cached = await useCatalogStore.getState().loadSchema('conn-1', 'proj', 'ds1', 't1')
      expect(cached).toEqual(fullFields)
      expect(invoke()).not.toHaveBeenCalled()
    })
  })

  describe('toggleDataset', () => {
    it('adds a datasetId to expandedDatasets when it is not already there', () => {
      // Act
      useCatalogStore.getState().toggleDataset('ds1')

      // Assert
      expect(useCatalogStore.getState().expandedDatasets.has('ds1')).toBe(true)
    })

    it('removes a datasetId from expandedDatasets when it was already expanded', () => {
      // Arrange
      useCatalogStore.getState().toggleDataset('ds1') // expand

      // Act
      useCatalogStore.getState().toggleDataset('ds1') // collapse

      // Assert
      expect(useCatalogStore.getState().expandedDatasets.has('ds1')).toBe(false)
    })

    it('toggles multiple datasets independently', () => {
      // Act
      useCatalogStore.getState().toggleDataset('ds1')
      useCatalogStore.getState().toggleDataset('ds2')
      useCatalogStore.getState().toggleDataset('ds1') // collapse ds1

      // Assert
      const { expandedDatasets } = useCatalogStore.getState()
      expect(expandedDatasets.has('ds1')).toBe(false)
      expect(expandedDatasets.has('ds2')).toBe(true)
    })
  })

  describe('warmCatalog', () => {
    const ds1: Dataset = { id: 'ds1', projectId: 'proj', name: 'ds1' }
    const ds2: Dataset = { id: 'ds2', projectId: 'proj', name: 'ds2' }
    const t1: Table = { id: 't1', datasetId: 'ds1', projectId: 'proj', name: 't1', type: 'TABLE' }
    const cols1: Record<string, TableField[]> = { t1: [{ name: 'id', type: 'INT64', mode: 'NULLABLE' }] }

    // Route invoke by channel so concurrency/order doesn't matter
    function routeInvoke(map: {
      datasets: Dataset[]
      tables: Record<string, Table[]>
      columns: Record<string, Record<string, TableField[]>>
    }) {
      invoke().mockImplementation((channel: string, arg: unknown) => {
        if (channel === CHANNELS.CATALOG_DATASETS) return Promise.resolve(map.datasets)
        if (channel === CHANNELS.CATALOG_TABLES) {
          const { datasetId } = arg as { datasetId: string }
          return Promise.resolve(map.tables[datasetId] ?? [])
        }
        if (channel === CHANNELS.CATALOG_DATASET_COLUMNS) {
          const { datasetId } = arg as { datasetId: string }
          return Promise.resolve(map.columns[datasetId] ?? {})
        }
        return Promise.resolve(undefined)
      })
    }

    it('reaches a warmed indexed state with dataset/table counts, a timestamp, and no failures', async () => {
      // Arrange
      const t2: Table = { id: 't2', datasetId: 'ds2', projectId: 'proj', name: 't2', type: 'TABLE' }
      const t3: Table = { id: 't3', datasetId: 'ds2', projectId: 'proj', name: 't3', type: 'VIEW' }
      routeInvoke({
        datasets: [ds1, ds2],
        tables: { ds1: [t1], ds2: [t2, t3] },
        columns: { ds1: cols1, ds2: {} },
      })
      const nowSpy = vi.spyOn(Date, 'now').mockReturnValue(1752500000000)

      // Act
      await useCatalogStore.getState().warmCatalog('conn-1')

      // Assert
      expect(useCatalogStore.getState().warmState['conn-1']).toEqual({
        phase: 'warmed',
        indexedAt: 1752500000000,
        datasetCount: 2,
        tableCount: 3,
        failedDatasets: [],
      })
      nowSpy.mockRestore()
    })

    it('reports live progress (done/total) while warming', async () => {
      // Arrange — hold ds2's tables fetch open so we can observe mid-warm state
      let releaseDs2!: () => void
      const ds2Gate = new Promise<Table[]>((resolve) => {
        releaseDs2 = () => resolve([])
      })
      invoke().mockImplementation((channel: string, arg: unknown) => {
        if (channel === CHANNELS.CATALOG_DATASETS) return Promise.resolve([ds1, ds2])
        if (channel === CHANNELS.CATALOG_TABLES) {
          const { datasetId } = arg as { datasetId: string }
          return datasetId === 'ds1' ? Promise.resolve([t1]) : ds2Gate
        }
        if (channel === CHANNELS.CATALOG_DATASET_COLUMNS) return Promise.resolve({})
        return Promise.resolve(undefined)
      })

      // Act
      const warm = useCatalogStore.getState().warmCatalog('conn-1')

      // Assert — ds1 finished, ds2 still in flight
      await vi.waitFor(() => {
        expect(useCatalogStore.getState().warmState['conn-1']).toEqual({
          phase: 'warming',
          datasetsDone: 1,
          datasetsTotal: 2,
        })
      })
      releaseDs2()
      await warm
      expect(useCatalogStore.getState().warmState['conn-1']?.phase).toBe('warmed')
    })

    it('populates tablesByDataset and schemaCache for every dataset', async () => {
      routeInvoke({ datasets: [ds1], tables: { ds1: [t1] }, columns: { ds1: cols1 } })

      await useCatalogStore.getState().warmCatalog('conn-1')

      const s = useCatalogStore.getState()
      expect(s.tablesByDataset['conn-1:ds1']).toEqual([t1])
      expect(s.schemaCache['conn-1:ds1:t1']).toEqual(cols1.t1)
      expect(s.warmState['conn-1']?.phase).toBe('warmed')
    })

    it('skips re-warming an already-warmed connection unless forced', async () => {
      routeInvoke({ datasets: [ds1], tables: { ds1: [t1] }, columns: { ds1: cols1 } })
      await useCatalogStore.getState().warmCatalog('conn-1')
      invoke().mockClear()

      await useCatalogStore.getState().warmCatalog('conn-1')
      expect(invoke()).not.toHaveBeenCalled()

      await useCatalogStore.getState().warmCatalog('conn-1', { force: true })
      expect(invoke()).toHaveBeenCalledWith(CHANNELS.CATALOG_DATASETS, 'conn-1')
    })

    it('surfaces a persistently failing dataset in failedDatasets and counts only successes', async () => {
      // Arrange — ds1's tables fetch fails on every attempt; ds2 succeeds
      const t2: Table = { id: 't2', datasetId: 'ds2', projectId: 'proj', name: 't2', type: 'TABLE' }
      invoke().mockImplementation((channel: string, arg: unknown) => {
        if (channel === CHANNELS.CATALOG_DATASETS) return Promise.resolve([ds1, ds2])
        if (channel === CHANNELS.CATALOG_TABLES) {
          const { datasetId } = arg as { datasetId: string }
          if (datasetId === 'ds1') return Promise.reject(new Error('permission denied'))
          return Promise.resolve([t2])
        }
        if (channel === CHANNELS.CATALOG_DATASET_COLUMNS) return Promise.resolve({})
        return Promise.resolve(undefined)
      })

      // Act
      await useCatalogStore.getState().warmCatalog('conn-1')

      // Assert
      const status = useCatalogStore.getState().warmState['conn-1']
      expect(status).toEqual({
        phase: 'warmed',
        indexedAt: expect.any(Number),
        datasetCount: 1,
        tableCount: 1,
        failedDatasets: [{ id: 'ds1', name: 'ds1', error: 'permission denied' }],
      })
    })

    it('heals a transient dataset failure via one automatic retry pass', async () => {
      // Arrange — ds1's tables fetch fails on the first attempt only
      let tablesAttempts = 0
      invoke().mockImplementation((channel: string) => {
        if (channel === CHANNELS.CATALOG_DATASETS) return Promise.resolve([ds1])
        if (channel === CHANNELS.CATALOG_TABLES) {
          tablesAttempts += 1
          if (tablesAttempts === 1) return Promise.reject(new Error('network blip'))
          return Promise.resolve([t1])
        }
        if (channel === CHANNELS.CATALOG_DATASET_COLUMNS) return Promise.resolve(cols1)
        return Promise.resolve(undefined)
      })

      // Act
      await useCatalogStore.getState().warmCatalog('conn-1')

      // Assert — healed: indexed data present, no failure surfaced
      expect(useCatalogStore.getState().warmState['conn-1']).toEqual({
        phase: 'warmed',
        indexedAt: expect.any(Number),
        datasetCount: 1,
        tableCount: 1,
        failedDatasets: [],
      })
      expect(useCatalogStore.getState().tablesByDataset['conn-1:ds1']).toEqual([t1])
    })

    it('lands in a failed state without throwing when the dataset list cannot be fetched', async () => {
      // Arrange — the very first call (CATALOG_DATASETS) rejects
      invoke().mockRejectedValueOnce(new Error('connection refused'))

      // Act + Assert — resolves (no unhandled rejection), and is NOT stamped warmed
      await expect(useCatalogStore.getState().warmCatalog('conn-1')).resolves.toBeUndefined()
      expect(useCatalogStore.getState().warmState['conn-1']).toEqual({
        phase: 'failed',
        error: 'connection refused',
      })
    })

    it('retryFailedDatasets re-attempts only the failed datasets and updates the summary', async () => {
      // Arrange — warm with ds1 persistently failing, ds2 healthy
      const t2: Table = { id: 't2', datasetId: 'ds2', projectId: 'proj', name: 't2', type: 'TABLE' }
      invoke().mockImplementation((channel: string, arg: unknown) => {
        if (channel === CHANNELS.CATALOG_DATASETS) return Promise.resolve([ds1, ds2])
        if (channel === CHANNELS.CATALOG_TABLES) {
          const { datasetId } = arg as { datasetId: string }
          if (datasetId === 'ds1') return Promise.reject(new Error('permission denied'))
          return Promise.resolve([t2])
        }
        if (channel === CHANNELS.CATALOG_DATASET_COLUMNS) return Promise.resolve({})
        return Promise.resolve(undefined)
      })
      await useCatalogStore.getState().warmCatalog('conn-1')
      const before = useCatalogStore.getState().warmState['conn-1']
      expect(before?.phase === 'warmed' && before.failedDatasets).toEqual([
        { id: 'ds1', name: 'ds1', error: 'permission denied' },
      ])

      // The backend recovers; reset call history
      invoke().mockClear()
      routeInvoke({
        datasets: [ds1, ds2],
        tables: { ds1: [t1], ds2: [t2] },
        columns: { ds1: cols1, ds2: {} },
      })

      // Act
      await useCatalogStore.getState().retryFailedDatasets('conn-1')

      // Assert — only ds1 was re-fetched, and never the dataset list
      const calls = invoke().mock.calls as [string, { datasetId?: string }?][]
      expect(calls.some(([ch]) => ch === CHANNELS.CATALOG_DATASETS)).toBe(false)
      expect(
        calls.filter(([ch]) => ch === CHANNELS.CATALOG_TABLES).map(([, arg]) => arg?.datasetId)
      ).toEqual(['ds1'])
      expect(useCatalogStore.getState().warmState['conn-1']).toEqual({
        phase: 'warmed',
        indexedAt: expect.any(Number),
        datasetCount: 2,
        tableCount: 2,
        failedDatasets: [],
      })
      expect(useCatalogStore.getState().tablesByDataset['conn-1:ds1']).toEqual([t1])
    })

    it('keeps a dataset in failedDatasets when the manual retry fails again', async () => {
      // Arrange — ds1 fails on every attempt, before and after retry
      invoke().mockImplementation((channel: string) => {
        if (channel === CHANNELS.CATALOG_DATASETS) return Promise.resolve([ds1])
        if (channel === CHANNELS.CATALOG_TABLES) return Promise.reject(new Error('still broken'))
        if (channel === CHANNELS.CATALOG_DATASET_COLUMNS) return Promise.resolve({})
        return Promise.resolve(undefined)
      })
      await useCatalogStore.getState().warmCatalog('conn-1')

      // Act
      await useCatalogStore.getState().retryFailedDatasets('conn-1')

      // Assert
      expect(useCatalogStore.getState().warmState['conn-1']).toEqual({
        phase: 'warmed',
        indexedAt: expect.any(Number),
        datasetCount: 0,
        tableCount: 0,
        failedDatasets: [{ id: 'ds1', name: 'ds1', error: 'still broken' }],
      })
    })

    it('retryFailedDatasets is a no-op when nothing failed', async () => {
      // Arrange — clean warm
      routeInvoke({ datasets: [ds1], tables: { ds1: [t1] }, columns: { ds1: cols1 } })
      await useCatalogStore.getState().warmCatalog('conn-1')
      invoke().mockClear()

      // Act
      await useCatalogStore.getState().retryFailedDatasets('conn-1')

      // Assert
      expect(invoke()).not.toHaveBeenCalled()
      expect(useCatalogStore.getState().warmState['conn-1']?.phase).toBe('warmed')
    })

    it('a forced re-warm replaces a failure-carrying summary with a clean one', async () => {
      // Arrange — first warm has ds1 persistently failing
      invoke().mockImplementation((channel: string) => {
        if (channel === CHANNELS.CATALOG_DATASETS) return Promise.resolve([ds1])
        if (channel === CHANNELS.CATALOG_TABLES) return Promise.reject(new Error('flaky'))
        if (channel === CHANNELS.CATALOG_DATASET_COLUMNS) return Promise.resolve({})
        return Promise.resolve(undefined)
      })
      await useCatalogStore.getState().warmCatalog('conn-1')
      const broken = useCatalogStore.getState().warmState['conn-1']
      expect(broken?.phase === 'warmed' && broken.failedDatasets.length).toBe(1)

      // The backend recovers; refresh button forces a full re-warm
      routeInvoke({ datasets: [ds1], tables: { ds1: [t1] }, columns: { ds1: cols1 } })

      // Act
      await useCatalogStore.getState().warmCatalog('conn-1', { force: true })

      // Assert
      expect(useCatalogStore.getState().warmState['conn-1']).toEqual({
        phase: 'warmed',
        indexedAt: expect.any(Number),
        datasetCount: 1,
        tableCount: 1,
        failedDatasets: [],
      })
    })

    it('swallows per-dataset errors and still warms the rest', async () => {
      invoke().mockImplementation((channel: string, arg: unknown) => {
        if (channel === CHANNELS.CATALOG_DATASETS) return Promise.resolve([ds1, ds2])
        if (channel === CHANNELS.CATALOG_TABLES) {
          const { datasetId } = arg as { datasetId: string }
          if (datasetId === 'ds1') return Promise.reject(new Error('permission denied'))
          return Promise.resolve([{ ...t1, datasetId: 'ds2', id: 't2', name: 't2' }])
        }
        if (channel === CHANNELS.CATALOG_DATASET_COLUMNS) return Promise.resolve({})
        return Promise.resolve(undefined)
      })

      await expect(useCatalogStore.getState().warmCatalog('conn-1')).resolves.toBeUndefined()
      expect(useCatalogStore.getState().tablesByDataset['conn-1:ds2']).toBeDefined()
      expect(useCatalogStore.getState().tablesByDataset['conn-1:ds1']).toBeUndefined()
      expect(useCatalogStore.getState().warmState['conn-1']?.phase).toBe('warmed')
    })
  })
})
