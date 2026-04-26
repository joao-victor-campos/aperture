import { registerConnectionHandlers } from './connections'
import { registerCatalogHandlers } from './catalog'
import { registerQueryHandlers } from './query'
import { registerSavedQueryHandlers } from './savedQueries'
import { registerHistoryHandlers } from './history'
import { registerExportHandlers } from './export'

export function registerIpcHandlers(): void {
  registerConnectionHandlers()
  registerCatalogHandlers()
  registerQueryHandlers()
  registerSavedQueryHandlers()
  registerHistoryHandlers()
  registerExportHandlers()
}
