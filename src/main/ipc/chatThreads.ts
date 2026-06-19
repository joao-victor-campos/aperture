import { ipcMain } from 'electron'
import { CHANNELS } from '../../shared/ipc'
import { store } from '../db/store'
import type { ChatThread } from '../../shared/types'

export function registerChatThreadHandlers(): void {
  ipcMain.handle(CHANNELS.CHAT_THREADS_LIST, async () => {
    return store.get('chatThreads')
  })

  ipcMain.handle(CHANNELS.CHAT_THREADS_SAVE, async (_event, thread: ChatThread) => {
    const threads = store.get('chatThreads')
    const idx = threads.findIndex((t) => t.id === thread.id)
    if (idx >= 0) threads[idx] = thread
    else threads.push(thread)
    store.set('chatThreads', threads)
    return thread
  })

  ipcMain.handle(CHANNELS.CHAT_THREADS_DELETE, async (_event, id: string) => {
    store.set('chatThreads', store.get('chatThreads').filter((t) => t.id !== id))
  })
}
