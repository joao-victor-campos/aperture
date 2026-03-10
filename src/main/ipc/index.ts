import { registerConnectionHandlers } from './connections'
import { registerCatalogHandlers } from './catalog'
import { registerQueryHandlers } from './query'

export function registerIpcHandlers(): void {
  registerConnectionHandlers()
  registerCatalogHandlers()
  registerQueryHandlers()
}
