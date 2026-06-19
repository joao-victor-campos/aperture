import { describe, it, expect, vi, beforeEach } from 'vitest'
import { CHANNELS } from '../../../shared/ipc'
import type { ChatThread } from '../../../shared/types'

type Handler = (event: unknown, req?: unknown) => unknown
const handlers = new Map<string, Handler>()

vi.mock('electron', () => ({
  ipcMain: { handle: (channel: string, fn: Handler) => handlers.set(channel, fn) },
}))

const storeData: { chatThreads: ChatThread[] } = { chatThreads: [] }
vi.mock('../../../main/db/store', () => ({
  store: {
    get: (k: string) => storeData[k as 'chatThreads'],
    set: (k: string, v: unknown) => { storeData[k as 'chatThreads'] = v as ChatThread[] },
  },
}))

import { registerChatThreadHandlers } from '../../../main/ipc/chatThreads'

function thread(id: string): ChatThread {
  return { id, title: 'T', connectionId: 'c1', messages: [], createdAt: 'now', updatedAt: 'now' }
}

beforeEach(() => {
  handlers.clear()
  storeData.chatThreads = []
  registerChatThreadHandlers()
})

describe('CHAT_THREADS_LIST', () => {
  it('returns stored threads', async () => {
    storeData.chatThreads = [thread('a')]
    const res = await handlers.get(CHANNELS.CHAT_THREADS_LIST)!({})
    expect(res).toEqual([thread('a')])
  })
})

describe('CHAT_THREADS_SAVE', () => {
  it('inserts a new thread', async () => {
    const res = await handlers.get(CHANNELS.CHAT_THREADS_SAVE)!({}, thread('a'))
    expect(res).toEqual(thread('a'))
    expect(storeData.chatThreads).toHaveLength(1)
  })

  it('updates an existing thread in place', async () => {
    storeData.chatThreads = [thread('a')]
    const updated = { ...thread('a'), title: 'Renamed' }
    await handlers.get(CHANNELS.CHAT_THREADS_SAVE)!({}, updated)
    expect(storeData.chatThreads).toHaveLength(1)
    expect(storeData.chatThreads[0].title).toBe('Renamed')
  })
})

describe('CHAT_THREADS_DELETE', () => {
  it('removes the thread by id', async () => {
    storeData.chatThreads = [thread('a'), thread('b')]
    await handlers.get(CHANNELS.CHAT_THREADS_DELETE)!({}, 'a')
    expect(storeData.chatThreads.map((t) => t.id)).toEqual(['b'])
  })
})
