import { create } from 'zustand'
import { CHANNELS } from '@shared/ipc'
import type { Dataset, FailedDataset, Table, TableField, WarmStatus } from '@shared/types'

interface CatalogState {
  datasetsByConnection: Record<string, Dataset[]>
  tablesByDataset: Record<string, Table[]>
  schemaCache: Record<string, TableField[]>   // key: "${connectionId}:${datasetId}:${tableId}"
  coarseSchemaKeys: Set<string>              // schemaCache keys populated coarsely by warmCatalog
  expandedDatasets: Set<string>
  isLoading: Record<string, boolean>
  warmState: Record<string, WarmStatus>
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
  retryFailedDatasets: (connectionId: string) => Promise<void>
}

const WARM_CONCURRENCY = 5

async function runCapped<T>(items: T[], limit: number, fn: (item: T) => Promise<void>): Promise<void> {
  const queue = [...items]
  const workers = Array.from({ length: Math.min(limit, queue.length) }, async () => {
    while (queue.length) await fn(queue.shift()!)
  })
  await Promise.all(workers)
}

export const useCatalogStore = create<CatalogState>((set, get) => {
  const bumpProgress =
    (connectionId: string) =>
    (s: CatalogState): Record<string, WarmStatus> => {
      const current = s.warmState[connectionId]
      if (current?.phase !== 'warming') return s.warmState
      return {
        ...s.warmState,
        [connectionId]: {
          ...current,
          datasetsDone: Math.min(current.datasetsDone + 1, current.datasetsTotal)
        }
      }
    }

  const warmDataset = async (connectionId: string, ds: Dataset): Promise<FailedDataset | null> => {
    try {
      const [tables, columns] = await Promise.all([
        window.api.invoke(CHANNELS.CATALOG_TABLES, { connectionId, datasetId: ds.id }),
        window.api.invoke(CHANNELS.CATALOG_DATASET_COLUMNS, { connectionId, datasetId: ds.id })
      ])
      // One merged commit per dataset to limit editor reconfigure churn.
      set((s) => {
        const schemaPatch: Record<string, TableField[]> = {}
        const nextCoarse = new Set(s.coarseSchemaKeys)
        for (const [tableId, fields] of Object.entries(columns)) {
          const key = `${connectionId}:${ds.id}:${tableId}`
          schemaPatch[key] = fields
          nextCoarse.add(key)
        }
        return {
          tablesByDataset: { ...s.tablesByDataset, [`${connectionId}:${ds.id}`]: tables },
          schemaCache: { ...s.schemaCache, ...schemaPatch },
          coarseSchemaKeys: nextCoarse,
          warmState: bumpProgress(connectionId)(s),
        }
      })
      return null
    } catch (err) {
      // Record datasets we can't read (permission/regional errors) — never skip silently.
      set((s) => ({ warmState: bumpProgress(connectionId)(s) }))
      return {
        id: ds.id,
        name: ds.name,
        error: err instanceof Error ? err.message : String(err)
      }
    }
  }

  const runPass = async (connectionId: string, targets: Dataset[]): Promise<FailedDataset[]> => {
    const failures: FailedDataset[] = []
    await runCapped(targets, WARM_CONCURRENCY, async (ds) => {
      const failure = await warmDataset(connectionId, ds)
      if (failure) failures.push(failure)
    })
    return failures
  }

  const commitWarmedSummary = (connectionId: string, failed: FailedDataset[]): void => {
    const done = get()
    const datasets = done.datasetsByConnection[connectionId] ?? []
    const failedIds = new Set(failed.map((f) => f.id))
    const indexed = datasets.filter((ds) => !failedIds.has(ds.id))
    const tableCount = indexed.reduce(
      (n, ds) => n + (done.tablesByDataset[`${connectionId}:${ds.id}`]?.length ?? 0),
      0
    )
    set((s) => ({
      warmState: {
        ...s.warmState,
        [connectionId]: {
          phase: 'warmed',
          indexedAt: Date.now(),
          datasetCount: indexed.length,
          tableCount,
          failedDatasets: failed
        }
      }
    }))
  }

  return {
    datasetsByConnection: {},
    tablesByDataset: {},
    schemaCache: {},
    coarseSchemaKeys: new Set(),
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
      const { schemaCache, coarseSchemaKeys } = get()
      const cached = schemaCache[cacheKey]
      if (cached && !coarseSchemaKeys.has(cacheKey)) return cached
      const fields = await window.api.invoke(CHANNELS.CATALOG_TABLE_SCHEMA, {
        connectionId,
        projectId,
        datasetId,
        tableId
      })
      set((s) => {
        const nextCoarse = new Set(s.coarseSchemaKeys)
        nextCoarse.delete(cacheKey)
        return { schemaCache: { ...s.schemaCache, [cacheKey]: fields }, coarseSchemaKeys: nextCoarse }
      })
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
      if (!opts?.force && state.warmState[connectionId]?.phase === 'warmed') return
      if (state.warmState[connectionId]?.phase === 'warming') return
      set((s) => ({
        warmState: {
          ...s.warmState,
          [connectionId]: { phase: 'warming', datasetsDone: 0, datasetsTotal: 0 }
        }
      }))

      try {
        const datasets = await window.api.invoke(CHANNELS.CATALOG_DATASETS, connectionId)
        set((s) => ({
          datasetsByConnection: { ...s.datasetsByConnection, [connectionId]: datasets },
          warmState: {
            ...s.warmState,
            [connectionId]: { phase: 'warming', datasetsDone: 0, datasetsTotal: datasets.length }
          }
        }))

        let failed = await runPass(connectionId, datasets)
        if (failed.length > 0) {
          // One automatic retry pass so transient blips heal without user intervention.
          const failedIds = new Set(failed.map((f) => f.id))
          failed = await runPass(
            connectionId,
            datasets.filter((ds) => failedIds.has(ds.id))
          )
        }

        commitWarmedSummary(connectionId, failed)
      } catch (err) {
        // The dataset list itself was unreachable — an honest failure, never a fake "warmed".
        set((s) => ({
          warmState: {
            ...s.warmState,
            [connectionId]: {
              phase: 'failed',
              error: err instanceof Error ? err.message : String(err)
            }
          }
        }))
      }
    },

    retryFailedDatasets: async (connectionId) => {
      const status = get().warmState[connectionId]
      if (status?.phase !== 'warmed' || status.failedDatasets.length === 0) return
      const datasets = get().datasetsByConnection[connectionId] ?? []
      const failedIds = new Set(status.failedDatasets.map((f) => f.id))
      const targets = datasets.filter((ds) => failedIds.has(ds.id))
      set((s) => ({
        warmState: {
          ...s.warmState,
          [connectionId]: { phase: 'warming', datasetsDone: 0, datasetsTotal: targets.length }
        }
      }))

      const failed = await runPass(connectionId, targets)
      commitWarmedSummary(connectionId, failed)
    },
  }
})
