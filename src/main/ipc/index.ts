import { registerConnectionHandlers } from './connections'
import { registerCatalogHandlers } from './catalog'
import { registerQueryHandlers } from './query'
import { registerSavedQueryHandlers } from './savedQueries'

export function registerIpcHandlers(): void {
  registerConnectionHandlers()
  registerCatalogHandlers()
  registerQueryHandlers()
  registerSavedQueryHandlers()
}
