import { ipcMain, app, type BrowserWindow } from 'electron'
import { CHANNELS } from '../../shared/ipc'
import { checkForUpdate } from '../updates/checkForUpdate'

export function registerUpdateHandlers(): void {
  ipcMain.handle(CHANNELS.UPDATES_CHECK, async () => {
    return checkForUpdate(app.getVersion(), process.arch)
  })
}

/**
 * Runs a check and pushes the result to the renderer over UPDATES_STATUS.
 * Used by the scheduler in main/index.ts. No-ops if the window is gone, and
 * checkForUpdate never throws, so this is safe to fire-and-forget.
 */
export async function pushUpdateStatus(window: BrowserWindow | null): Promise<void> {
  if (!window || window.isDestroyed()) return
  const status = await checkForUpdate(app.getVersion(), process.arch)
  if (!window.isDestroyed()) {
    window.webContents.send(CHANNELS.UPDATES_STATUS, status)
  }
}
