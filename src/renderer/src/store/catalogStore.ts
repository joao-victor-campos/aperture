import { create } from 'zustand'
import { CHANNELS } from '@shared/ipc'
import type { Dataset, Table, TableField } from '@shared/types'

interface CatalogState {
  datasetsByConnection: Record<string, Dataset[]>
  tablesByDataset: Record<string, Table[]>
  schemaCache: Record<string, TableField[]>   // key: "${connectionId}:${datasetId}:${tableId}"
  expandedDatasets: Set<string>
  isLoading: Record<string, boolean>
  warmState: Record<string, 'idle' | 'warming' | 'warmed'>
  loadDatasets: (connectionId: string) => Promise<void>
  loadTables: (connectionId: string, datasetId: string) => Promise<void>
  loadSchema: (
    connectionId: string,
    projectId: string,
    datasetId: string,
    tableId: string
  ) => Promise<TableField[]>
  toggleDataset: (datasetId: string) => void
  warmCatalog: (connectionId: string, opts?: { force?: boolean }) => Promise<void>
}

const WARM_CONCURRENCY = 5

async function runCapped<T>(items: T[], limit: number, fn: (item: T) => Promise<void>): Promise<void> {
  const queue = [...items]
  const workers = Array.from({ length: Math.min(limit, queue.length) }, async () => {
    while (queue.length) await fn(queue.shift()!)
  })
  await Promise.all(workers)
}

export const useCatalogStore = create<CatalogState>((set, get) => ({
  datasetsByConnection: {},
  tablesByDataset: {},
  schemaCache: {},
  expandedDatasets: new Set(),
  isLoading: {},
  warmState: {},

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
  },

  warmCatalog: async (connectionId, opts) => {
    const state = get()
    if (!opts?.force && state.warmState[connectionId] === 'warmed') return
    if (state.warmState[connectionId] === 'warming') return
    set((s) => ({ warmState: { ...s.warmState, [connectionId]: 'warming' } }))

    try {
      const datasets = await window.api.invoke(CHANNELS.CATALOG_DATASETS, connectionId)
      set((s) => ({ datasetsByConnection: { ...s.datasetsByConnection, [connectionId]: datasets } }))

      await runCapped(datasets, WARM_CONCURRENCY, async (ds) => {
        try {
          const [tables, columns] = await Promise.all([
            window.api.invoke(CHANNELS.CATALOG_TABLES, { connectionId, datasetId: ds.id }),
            window.api.invoke(CHANNELS.CATALOG_DATASET_COLUMNS, { connectionId, datasetId: ds.id })
          ])
          // One merged commit per dataset to limit editor reconfigure churn.
          set((s) => {
            const schemaPatch: Record<string, TableField[]> = {}
            for (const [tableId, fields] of Object.entries(columns as Record<string, TableField[]>)) {
              schemaPatch[`${connectionId}:${ds.id}:${tableId}`] = fields
            }
            return {
              tablesByDataset: { ...s.tablesByDataset, [`${connectionId}:${ds.id}`]: tables },
              schemaCache: { ...s.schemaCache, ...schemaPatch }
            }
          })
        } catch {
          // Skip datasets we can't read (permission/regional errors)
        }
      })
    } finally {
      set((s) => ({ warmState: { ...s.warmState, [connectionId]: 'warmed' } }))
    }
  },
}))
