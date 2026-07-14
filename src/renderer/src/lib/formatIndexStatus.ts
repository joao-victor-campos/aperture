import type { WarmStatus } from '@shared/types'

/**
 * Maps the catalog warm-up's indexed state to the sidebar status line.
 * Returns null when there is nothing to show (never warmed / idle).
 */
export function formatIndexStatus(status: WarmStatus | undefined): string | null {
  if (!status) return null
  if (status.phase === 'warming') {
    if (status.datasetsTotal === 0) return 'Indexing catalog…'
    return `Indexing catalog… ${status.datasetsDone}/${status.datasetsTotal}`
  }
  if (status.phase === 'failed') {
    return 'Catalog indexing failed'
  }
  if (status.phase === 'warmed') {
    const at = new Date(status.indexedAt)
    const hhmm = `${String(at.getHours()).padStart(2, '0')}:${String(at.getMinutes()).padStart(2, '0')}`
    const datasets = `${status.datasetCount} ${status.datasetCount === 1 ? 'dataset' : 'datasets'}`
    const tables = `${status.tableCount} ${status.tableCount === 1 ? 'table' : 'tables'}`
    const failures =
      status.failedDatasets.length > 0 ? ` · ${status.failedDatasets.length} failed` : ''
    return `Indexed ${datasets} · ${tables} · ${hhmm}${failures}`
  }
  return null
}
