import type { Table } from '@shared/types'

export interface TableLocation {
  projectId: string
  datasetId: string
  tableId: string
}

/**
 * Build a case-insensitive lookup from table reference names to catalog ids,
 * for tables already loaded under the given connection. Both the bare name
 * (`users`) and the qualified name (`dataset.users`) are registered (lowercased).
 * Keys collide last-write-wins; that's acceptable for prefetch resolution.
 */
export function buildTableLookup(
  connectionId: string,
  tablesByDataset: Record<string, Table[]>,
): Map<string, TableLocation> {
  const map = new Map<string, TableLocation>()
  const prefix = `${connectionId}:`
  for (const [key, tables] of Object.entries(tablesByDataset)) {
    if (!key.startsWith(prefix)) continue
    for (const tbl of tables) {
      const loc: TableLocation = {
        projectId: tbl.projectId,
        datasetId: tbl.datasetId,
        tableId: tbl.id,
      }
      map.set(tbl.name.toLowerCase(), loc)
      map.set(`${tbl.datasetId}.${tbl.name}`.toLowerCase(), loc)
    }
  }
  return map
}
