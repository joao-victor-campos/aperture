import { useEffect } from 'react'
import { useCatalogStore } from '../store/catalogStore'
import { extractTableRefs } from '../lib/extractTableRefs'
import { buildTableLookup } from '../lib/buildTableLookup'

const DEBOUNCE_MS = 250
const MAX_CONCURRENT = 5

/** Run async tasks with a concurrency cap; resolves when all settle. */
async function runCapped<T>(items: T[], limit: number, fn: (item: T) => Promise<void>): Promise<void> {
  const queue = [...items]
  const workers = Array.from({ length: Math.min(limit, queue.length) }, async () => {
    while (queue.length) {
      const item = queue.shift()!
      await fn(item)
    }
  })
  await Promise.all(workers)
}

/**
 * Debounced background prefetch of column schemas for tables referenced in `sql`.
 * Resolves referenced names against already-loaded catalog table lists and calls
 * loadSchema for any not yet cached. Per-table errors are swallowed so one
 * inaccessible table never blocks completion for the rest. No-ops when there is
 * no connection or SQL.
 */
export function useSchemaPrefetch(sql: string, connectionId: string | undefined): void {
  // Subscribe to the table-list map so the resolver picks up newly expanded
  // datasets; read schemaCache + loadSchema lazily from the store to avoid
  // re-running on every cache write.
  const tablesByDataset = useCatalogStore((s) => s.tablesByDataset)

  useEffect(() => {
    if (!connectionId || !sql.trim()) return
    const handle = setTimeout(() => {
      const refs = extractTableRefs(sql)
      if (refs.length === 0) return
      const lookup = buildTableLookup(connectionId, tablesByDataset)
      const { schemaCache, loadSchema } = useCatalogStore.getState()
      const targets = refs
        .map((r) => lookup.get(r.name.toLowerCase()))
        .filter((loc): loc is NonNullable<typeof loc> => !!loc)
        .filter((loc) => !schemaCache[`${connectionId}:${loc.datasetId}:${loc.tableId}`])
      const seen = new Set<string>()
      const unique = targets.filter((loc) => {
        const k = `${loc.datasetId}:${loc.tableId}`
        if (seen.has(k)) return false
        seen.add(k)
        return true
      })
      if (unique.length === 0) return
      void runCapped(unique, MAX_CONCURRENT, (loc) =>
        loadSchema(connectionId, loc.projectId, loc.datasetId, loc.tableId)
          .then(() => undefined)
          .catch(() => undefined),
      )
    }, DEBOUNCE_MS)
    return () => clearTimeout(handle)
  }, [sql, connectionId, tablesByDataset])
}
