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

    it('populates tablesByDataset and schemaCache for every dataset', async () => {
      routeInvoke({ datasets: [ds1], tables: { ds1: [t1] }, columns: { ds1: cols1 } })

      await useCatalogStore.getState().warmCatalog('conn-1')

      const s = useCatalogStore.getState()
      expect(s.tablesByDataset['conn-1:ds1']).toEqual([t1])
      expect(s.schemaCache['conn-1:ds1:t1']).toEqual(cols1.t1)
      expect(s.warmState['conn-1']).toBe('warmed')
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
      expect(useCatalogStore.getState().warmState['conn-1']).toBe('warmed')
    })
  })
})
