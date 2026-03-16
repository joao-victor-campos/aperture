import { create } from 'zustand'
import { CHANNELS } from '@shared/ipc'
import type { Dataset, Table, TableField } from '@shared/types'

interface CatalogState {
  datasetsByConnection: Record<string, Dataset[]>
  tablesByDataset: Record<string, Table[]>
  schemaCache: Record<string, TableField[]>   // key: "${connectionId}:${datasetId}:${tableId}"
  expandedDatasets: Set<string>
  isLoading: Record<string, boolean>
  loadDatasets: (connectionId: string) => Promise<void>
  loadTables: (connectionId: string, datasetId: string) => Promise<void>
  loadSchema: (
    connectionId: string,
    projectId: string,
    datasetId: string,
    tableId: string
  ) => Promise<TableField[]>
  toggleDataset: (datasetId: string) => void
}

export const useCatalogStore = create<CatalogState>((set, get) => ({
  datasetsByConnection: {},
  tablesByDataset: {},
  schemaCache: {},
  expandedDatasets: new Set(),
  isLoading: {},

  loadDatasets: async (connectionId) => {
    set((s) => ({ isLoading: { ...s.isLoading, [connectionId]: true } }))
    const datasets = await window.api.invoke(CHANNELS.CATALOG_DATASETS, connectionId)
    set((s) => ({
      datasetsByConnection: { ...s.datasetsByConnection, [connectionId]: datasets },
      isLoading: { ...s.isLoading, [connectionId]: false }
    }))
  },

  loadTables: async (connectionId, datasetId) => {
    const key = `${connectionId}:${datasetId}`
    set((s) => ({ isLoading: { ...s.isLoading, [key]: true } }))
    const tables = await window.api.invoke(CHANNELS.CATALOG_TABLES, { connectionId, datasetId })
    set((s) => ({
      tablesByDataset: { ...s.tablesByDataset, [key]: tables },
      isLoading: { ...s.isLoading, [key]: false }
    }))
  },

  loadSchema: async (connectionId, projectId, datasetId, tableId) => {
    const cacheKey = `${connectionId}:${datasetId}:${tableId}`
    const cached = get().schemaCache[cacheKey]
    if (cached) return cached
    const fields = await window.api.invoke(CHANNELS.CATALOG_TABLE_SCHEMA, {
      connectionId,
      projectId,
      datasetId,
      tableId
    })
    set((s) => ({ schemaCache: { ...s.schemaCache, [cacheKey]: fields } }))
    return fields
  },

  toggleDataset: (datasetId) => {
    const next = new Set(get().expandedDatasets)
    if (next.has(datasetId)) {
      next.delete(datasetId)
    } else {
      next.add(datasetId)
    }
    set({ expandedDatasets: next })
  }
}))
