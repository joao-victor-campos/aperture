import { ipcMain } from 'electron'
import { CHANNELS } from '../../shared/ipc'
import { store } from '../db/store'

export function registerHistoryHandlers(): void {
  ipcMain.handle(CHANNELS.HISTORY_LIST, () => {
    return store.get('historyEntries')
  })

  ipcMain.handle(CHANNELS.HISTORY_CLEAR, () => {
    store.set('historyEntries', [])
  })
}
