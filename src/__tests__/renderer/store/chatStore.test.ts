import { describe, it, expect, vi, beforeEach } from 'vitest'
import { CHANNELS } from '@shared/ipc'
import type { ChatThread } from '@shared/types'
import { useChatStore, applyChatStreamPush } from '../../../renderer/src/store/chatStore'
import { useConnectionStore } from '../../../renderer/src/store/connectionStore'
import { useQueryStore } from '../../../renderer/src/store/queryStore'

function setupConnection() {
  useConnectionStore.setState({
    connections: [{ id: 'c1', name: 'prod', engine: 'postgres', host: 'h', port: 5432, database: 'd', user: 'u', password: 'p', createdAt: 'x' }],
    activeConnectionId: 'c1',
    isLoading: false,
    statuses: {},
  } as never)
}

function resetStore() {
  useChatStore.setState({
    threads: [],
    activeThreadId: null,
    isPanelOpen: false,
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

describe('chatStore.applyChatStreamPush', () => {
  it('accumulates streamed deltas', () => {
    applyChatStreamPush({ requestId: 'r', delta: 'ab' })
    applyChatStreamPush({ requestId: 'r', delta: 'cd' })
    expect(useChatStore.getState().streamingText).toBe('abcd')
  })
})

describe('chatStore.sendMessage', () => {
  it('appends the user message, derives the title, and stores the final answer', async () => {
    setupConnection()
    useChatStore.getState().newThread('c1')
    vi.mocked(window.api.invoke).mockImplementation(async (channel: string) => {
      if (channel === CHANNELS.AI_CHAT_COMPLETE) {
        return { message: { role: 'assistant', content: [{ type: 'text', text: 'Hi there' }] }, stopReason: 'end_turn' }
      }
      return undefined
    })

    await useChatStore.getState().sendMessage('What tables exist?')

    const t = useChatStore.getState().threads[0]
    expect(t.title).toBe('What tables exist?')
    expect(t.messages[0]).toEqual({ role: 'user', content: [{ type: 'text', text: 'What tables exist?' }] })
    expect(t.messages.at(-1)).toEqual({ role: 'assistant', content: [{ type: 'text', text: 'Hi there' }] })
    expect(useChatStore.getState().isStreaming).toBe(false)
  })

  it('dispatches a data tool, feeds the tool_result back, and loops to a final answer', async () => {
    setupConnection()
    useChatStore.getState().newThread('c1')
    let call = 0
    vi.mocked(window.api.invoke).mockImplementation(async (channel: string) => {
      if (channel === CHANNELS.AI_CHAT_COMPLETE) {
        call += 1
        if (call === 1) {
          return { message: { role: 'assistant', content: [{ type: 'tool_use', id: 'tu1', name: 'search_tables', input: { query: 'ord' } }] }, stopReason: 'tool_use' }
        }
        return { message: { role: 'assistant', content: [{ type: 'text', text: 'Found orders' }] }, stopReason: 'end_turn' }
      }
      if (channel === CHANNELS.CATALOG_SEARCH_TABLES) return [{ datasetId: 'd', tableId: 'orders', name: 'orders', type: 'TABLE' }]
      return undefined
    })

    await useChatStore.getState().sendMessage('find orders')

    const msgs = useChatStore.getState().threads[0].messages
    expect(msgs).toHaveLength(4)
    expect(msgs[2].content[0]).toMatchObject({ type: 'tool_result', tool_use_id: 'tu1' })
    expect(msgs[3].content[0]).toEqual({ type: 'text', text: 'Found orders' })
  })

  it('open_query_tab opens an editor tab and reports success', async () => {
    setupConnection()
    useQueryStore.setState({ tabs: [], activeTabId: null } as never)
    useChatStore.getState().newThread('c1')
    let call = 0
    vi.mocked(window.api.invoke).mockImplementation(async (channel: string) => {
      if (channel === CHANNELS.AI_CHAT_COMPLETE) {
        call += 1
        if (call === 1) {
          return { message: { role: 'assistant', content: [{ type: 'tool_use', id: 'tu2', name: 'open_query_tab', input: { sql: 'SELECT 1' } }] }, stopReason: 'tool_use' }
        }
        return { message: { role: 'assistant', content: [{ type: 'text', text: 'opened' }] }, stopReason: 'end_turn' }
      }
      return undefined
    })

    await useChatStore.getState().sendMessage('draft a query')

    expect(useQueryStore.getState().tabs.some((t) => t.sql === 'SELECT 1')).toBe(true)
  })

  it('run_query waits for approval, then executes and feeds a capped sample', async () => {
    setupConnection()
    useChatStore.getState().newThread('c1')
    let call = 0
    vi.mocked(window.api.invoke).mockImplementation(async (channel: string) => {
      if (channel === CHANNELS.AI_CHAT_COMPLETE) {
        call += 1
        if (call === 1) {
          return { message: { role: 'assistant', content: [{ type: 'tool_use', id: 'tu3', name: 'run_query', input: { sql: 'SELECT 1' } }] }, stopReason: 'tool_use' }
        }
        return { message: { role: 'assistant', content: [{ type: 'text', text: 'done' }] }, stopReason: 'end_turn' }
      }
      if (channel === CHANNELS.QUERY_DRY_RUN) return { bytesProcessed: 2048 }
      if (channel === CHANNELS.QUERY_EXECUTE) return { columns: ['n'], rows: [{ n: 1 }], rowCount: 1, executionTimeMs: 5 }
      return undefined
    })

    const p = useChatStore.getState().sendMessage('run it')
    await new Promise((r) => setTimeout(r, 0))
    expect(useChatStore.getState().pendingConfirm).toMatchObject({ toolUseId: 'tu3', sql: 'SELECT 1', bytesProcessed: 2048 })

    useChatStore.getState().approveRun()
    await p

    const msgs = useChatStore.getState().threads[0].messages
    const toolResult = msgs.find((m) => m.content[0]?.type === 'tool_result')!
    expect((toolResult.content[0] as { content: string }).content).toContain('"rows"')
    expect(useChatStore.getState().pendingConfirm).toBeNull()
  })

  it('rejecting a run feeds a declined tool_result instead of executing', async () => {
    setupConnection()
    useChatStore.getState().newThread('c1')
    let call = 0
    const executeSpy = vi.fn()
    vi.mocked(window.api.invoke).mockImplementation(async (channel: string) => {
      if (channel === CHANNELS.AI_CHAT_COMPLETE) {
        call += 1
        if (call === 1) {
          return { message: { role: 'assistant', content: [{ type: 'tool_use', id: 'tu4', name: 'run_query', input: { sql: 'DELETE FROM t' } }] }, stopReason: 'tool_use' }
        }
        return { message: { role: 'assistant', content: [{ type: 'text', text: 'ok, skipped' }] }, stopReason: 'end_turn' }
      }
      if (channel === CHANNELS.QUERY_DRY_RUN) return { bytesProcessed: 0 }
      if (channel === CHANNELS.QUERY_EXECUTE) { executeSpy(); return { columns: [], rows: [], rowCount: 0, executionTimeMs: 0 } }
      return undefined
    })

    const p = useChatStore.getState().sendMessage('delete everything')
    await new Promise((r) => setTimeout(r, 0))
    useChatStore.getState().rejectRun()
    await p

    expect(executeSpy).not.toHaveBeenCalled()
    const msgs = useChatStore.getState().threads[0].messages
    const toolResult = msgs.find((m) => m.content[0]?.type === 'tool_result')!
    expect((toolResult.content[0] as { content: string }).content).toMatch(/declined/i)
  })

  it('records an error and stops when AI_CHAT_COMPLETE returns an error', async () => {
    setupConnection()
    useChatStore.getState().newThread('c1')
    vi.mocked(window.api.invoke).mockImplementation(async (channel: string) => {
      if (channel === CHANNELS.AI_CHAT_COMPLETE) {
        return { message: { role: 'assistant', content: [] }, stopReason: null, error: 'No API key configured. Add one in Settings → AI.' }
      }
      return undefined
    })

    await useChatStore.getState().sendMessage('hi')
    expect(useChatStore.getState().error).toMatch(/api key/i)
    expect(useChatStore.getState().isStreaming).toBe(false)
  })
})

describe('chatStore.sendMessage — connection awareness', () => {
  it('creates a thread on first send when none is active', async () => {
    setupConnection()
    expect(useChatStore.getState().activeThreadId).toBeNull()
    vi.mocked(window.api.invoke).mockImplementation(async (channel: string) => {
      if (channel === CHANNELS.AI_CHAT_COMPLETE) {
        return { message: { role: 'assistant', content: [{ type: 'text', text: 'hi' }] }, stopReason: 'end_turn' }
      }
      return undefined
    })

    await useChatStore.getState().sendMessage('hello')

    expect(useChatStore.getState().threads).toHaveLength(1)
    expect(useChatStore.getState().threads[0].messages[0]).toMatchObject({ role: 'user' })
  })

  it('targets the CURRENT active connection, re-binding the thread', async () => {
    // Thread was created against c1, but the user has since switched to c2.
    useConnectionStore.setState({
      connections: [
        { id: 'c1', name: 'old', engine: 'postgres', host: 'h', port: 5432, database: 'd', user: 'u', password: 'p', createdAt: 'x' },
        { id: 'c2', name: 'graph', engine: 'neo4j', uri: 'neo4j://h', username: 'u', password: 'p', createdAt: 'x' },
      ],
      activeConnectionId: 'c2',
      isLoading: false,
      statuses: {},
    } as never)
    useChatStore.getState().newThread('c1') // bound to c1 at creation

    const seen: Array<{ channel: string; arg: unknown }> = []
    let aiCalls = 0
    vi.mocked(window.api.invoke).mockImplementation(async (channel: string, arg: unknown) => {
      seen.push({ channel, arg })
      if (channel === CHANNELS.AI_CHAT_COMPLETE) {
        aiCalls += 1
        if (aiCalls === 1) {
          return { message: { role: 'assistant', content: [{ type: 'tool_use', id: 'tu1', name: 'list_datasets', input: {} }] }, stopReason: 'tool_use' }
        }
        return { message: { role: 'assistant', content: [{ type: 'text', text: 'done' }] }, stopReason: 'end_turn' }
      }
      if (channel === CHANNELS.CATALOG_DATASETS) return []
      return undefined
    })

    await useChatStore.getState().sendMessage('what labels exist?')

    // Thread re-bound to the current connection.
    expect(useChatStore.getState().threads[0].connectionId).toBe('c2')
    // The data tool was dispatched against c2, not c1.
    expect(seen.some((s) => s.channel === CHANNELS.CATALOG_DATASETS && s.arg === 'c2')).toBe(true)
  })

  it('sets an error and does not call the model when no connection is active', async () => {
    useConnectionStore.setState({ connections: [], activeConnectionId: null, isLoading: false, statuses: {} } as never)
    await useChatStore.getState().sendMessage('hi')
    expect(useChatStore.getState().error).toMatch(/connect to a database/i)
    expect(window.api.invoke).not.toHaveBeenCalledWith(CHANNELS.AI_CHAT_COMPLETE, expect.anything())
  })
})

describe('chatStore panel + requestFix', () => {
  it('openPanel / closePanel / togglePanel control isPanelOpen', () => {
    expect(useChatStore.getState().isPanelOpen).toBe(false)
    useChatStore.getState().openPanel()
    expect(useChatStore.getState().isPanelOpen).toBe(true)
    useChatStore.getState().closePanel()
    expect(useChatStore.getState().isPanelOpen).toBe(false)
    useChatStore.getState().togglePanel()
    expect(useChatStore.getState().isPanelOpen).toBe(true)
  })

  it('requestFix opens the panel and sends a message containing the SQL and error', async () => {
    setupConnection()
    vi.mocked(window.api.invoke).mockImplementation(async (channel: string) => {
      if (channel === CHANNELS.AI_CHAT_COMPLETE) {
        return { message: { role: 'assistant', content: [{ type: 'text', text: 'fixed' }] }, stopReason: 'end_turn' }
      }
      return undefined
    })

    useChatStore.getState().requestFix('SELECT * FROM nope', 'Table nope not found')

    // Panel opens and the user message (appended synchronously) carries both.
    expect(useChatStore.getState().isPanelOpen).toBe(true)
    const firstMsg = useChatStore.getState().threads[0].messages[0]
    const text = (firstMsg.content[0] as { text: string }).text
    expect(text).toContain('SELECT * FROM nope')
    expect(text).toContain('Table nope not found')

    // Let the fire-and-forget agent loop settle (invoke is mocked).
    await new Promise((r) => setTimeout(r, 0))
  })
})
