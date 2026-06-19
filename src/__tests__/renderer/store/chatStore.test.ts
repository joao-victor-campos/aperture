import { describe, it, expect, vi, beforeEach } from 'vitest'
import { CHANNELS } from '@shared/ipc'
import type { ChatThread } from '@shared/types'
import { useChatStore, applyChatStreamPush } from '../../../renderer/src/store/chatStore'

function resetStore() {
  useChatStore.setState({
    threads: [],
    activeThreadId: null,
    streamingText: '',
    isStreaming: false,
    pendingConfirm: null,
    error: null,
  })
}

beforeEach(() => {
  resetStore()
  vi.mocked(window.api.invoke).mockReset()
})

describe('chatStore thread CRUD', () => {
  it('loadThreads populates from IPC', async () => {
    const t: ChatThread = { id: 'a', title: 'T', connectionId: 'c1', messages: [], createdAt: 'x', updatedAt: 'x' }
    vi.mocked(window.api.invoke).mockResolvedValue([t])
    await useChatStore.getState().loadThreads()
    expect(window.api.invoke).toHaveBeenCalledWith(CHANNELS.CHAT_THREADS_LIST, undefined)
    expect(useChatStore.getState().threads).toEqual([t])
  })

  it('newThread creates and activates a thread bound to the connection', () => {
    const id = useChatStore.getState().newThread('c1')
    const s = useChatStore.getState()
    expect(s.activeThreadId).toBe(id)
    const t = s.threads.find((x) => x.id === id)!
    expect(t.connectionId).toBe('c1')
    expect(t.messages).toEqual([])
  })

  it('renameThread updates title and persists', async () => {
    vi.mocked(window.api.invoke).mockResolvedValue(undefined)
    const id = useChatStore.getState().newThread('c1')
    await useChatStore.getState().renameThread(id, 'My thread')
    expect(useChatStore.getState().threads.find((t) => t.id === id)!.title).toBe('My thread')
    expect(window.api.invoke).toHaveBeenCalledWith(CHANNELS.CHAT_THREADS_SAVE, expect.objectContaining({ title: 'My thread' }))
  })

  it('deleteThread removes it and clears active when it was active', async () => {
    vi.mocked(window.api.invoke).mockResolvedValue(undefined)
    const id = useChatStore.getState().newThread('c1')
    await useChatStore.getState().deleteThread(id)
    expect(useChatStore.getState().threads).toHaveLength(0)
    expect(useChatStore.getState().activeThreadId).toBeNull()
    expect(window.api.invoke).toHaveBeenCalledWith(CHANNELS.CHAT_THREADS_DELETE, id)
  })

  it('selectThread sets the active id', () => {
    const id = useChatStore.getState().newThread('c1')
    useChatStore.getState().newThread('c2')
    useChatStore.getState().selectThread(id)
    expect(useChatStore.getState().activeThreadId).toBe(id)
  })
})

describe('chatStore AI_CHAT_STREAM push listener', () => {
  it('applyChatStreamPush appends delta to streamingText', () => {
    useChatStore.setState({ streamingText: 'hello ' })
    applyChatStreamPush({ requestId: 'r1', delta: 'world' })
    expect(useChatStore.getState().streamingText).toBe('hello world')
  })
})
