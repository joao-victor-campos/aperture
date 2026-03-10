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
})
