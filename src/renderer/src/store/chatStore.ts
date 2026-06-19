import { create } from 'zustand'
import { CHANNELS } from '@shared/ipc'
import type {
  ChatThread,
  ChatMessage,
  ChatContentBlock,
  ChatToolUseBlock,
  AiCompleteResponse,
} from '@shared/types'
import { useConnectionStore } from './connectionStore'
import { useQueryStore } from './queryStore'
import { TOOL_DEFS, runDataTool } from '../ai/tools'
import { capResult } from '../ai/capResult'
import { buildSystemPrompt } from '../ai/systemPrompt'

export interface PendingConfirm {
  toolUseId: string
  sql: string
  bytesProcessed: number
}

interface ChatState {
  threads: ChatThread[]
  activeThreadId: string | null
  /** Accumulated streamed text for the in-flight assistant turn. */
  streamingText: string
  isStreaming: boolean
  pendingConfirm: PendingConfirm | null
  error: string | null

  loadThreads: () => Promise<void>
  newThread: (connectionId: string) => string
  selectThread: (id: string) => void
  renameThread: (id: string, title: string) => Promise<void>
  deleteThread: (id: string) => Promise<void>
  sendMessage: (text: string) => Promise<void>
  approveRun: () => void
  rejectRun: () => void
}

function now(): string {
  return new Date().toISOString()
}

/** Persist a thread to the main store. */
async function persist(thread: ChatThread): Promise<void> {
  await window.api.invoke(CHANNELS.CHAT_THREADS_SAVE, thread)
}

function patchThread(
  threads: ChatThread[],
  id: string,
  fn: (t: ChatThread) => ChatThread,
): ChatThread[] {
  return threads.map((t) => (t.id === id ? fn(t) : t))
}

// Resolver for the in-flight run_query confirmation (approve/reject).
// Assigned by dispatchTool when it raises a confirmation; read/cleared by
// approveRun/rejectRun.
let confirmResolver: ((approved: boolean) => void) | null = null

export const useChatStore = create<ChatState>((set, get) => ({
  threads: [],
  activeThreadId: null,
  streamingText: '',
  isStreaming: false,
  pendingConfirm: null,
  error: null,

  loadThreads: async () => {
    const threads = await window.api.invoke(CHANNELS.CHAT_THREADS_LIST, undefined)
    set({ threads })
  },

  newThread: (connectionId) => {
    const id = crypto.randomUUID()
    const thread: ChatThread = {
      id,
      title: 'New chat',
      connectionId,
      messages: [] as ChatMessage[],
      createdAt: now(),
      updatedAt: now(),
    }
    set((s) => ({ threads: [thread, ...s.threads], activeThreadId: id }))
    return id
  },

  selectThread: (id) => set({ activeThreadId: id }),

  renameThread: async (id, title) => {
    set((s) => ({
      threads: patchThread(s.threads, id, (t) => ({ ...t, title, updatedAt: now() })),
    }))
    const t = get().threads.find((x) => x.id === id)
    if (t) await persist(t)
  },

  deleteThread: async (id) => {
    await window.api.invoke(CHANNELS.CHAT_THREADS_DELETE, id)
    set((s) => ({
      threads: s.threads.filter((t) => t.id !== id),
      activeThreadId: s.activeThreadId === id ? null : s.activeThreadId,
    }))
  },

  sendMessage: async (text) => {
    // Always operate on the CURRENT active connection so the agent stays in sync
    // with whatever the user is connected to right now (not the connection that
    // happened to be active when the thread was created).
    const connState = useConnectionStore.getState()
    const connectionId = connState.activeConnectionId
    const conn = connState.connections.find((c) => c.id === connectionId)
    if (!connectionId || !conn) {
      set({ error: 'Connect to a database before chatting.' })
      return
    }

    // Lazily create a thread on first send; this avoids auto-creating empty
    // threads on panel open (which duplicated under StrictMode).
    let threadId = get().activeThreadId
    if (!threadId || !get().threads.find((t) => t.id === threadId)) {
      threadId = get().newThread(connectionId)
    }

    const userMsg: ChatMessage = { role: 'user', content: [{ type: 'text', text }] }
    set((s) => ({
      error: null,
      threads: patchThread(s.threads, threadId!, (t) => ({
        ...t,
        // Re-bind to the current connection so tools target it.
        connectionId,
        title: t.messages.length === 0 ? text.slice(0, 40) : t.title,
        messages: [...t.messages, userMsg],
        updatedAt: now(),
      })),
    }))

    const system = buildSystemPrompt(conn.name, conn.engine)

    for (let turn = 0; turn < 16; turn++) {
      const requestId = crypto.randomUUID()
      set({ isStreaming: true, streamingText: '' })

      const messages = get().threads.find((t) => t.id === threadId)!.messages
      const res: AiCompleteResponse = await window.api.invoke(CHANNELS.AI_CHAT_COMPLETE, {
        requestId, system, messages, tools: TOOL_DEFS,
      })

      set({ isStreaming: false, streamingText: '' })

      if (res.error) {
        set({ error: res.error })
        return
      }

      set((s) => ({
        threads: patchThread(s.threads, threadId, (t) => ({
          ...t, messages: [...t.messages, res.message], updatedAt: now(),
        })),
      }))

      const toolUses = res.message.content.filter(
        (b): b is ChatToolUseBlock => b.type === 'tool_use'
      )
      if (toolUses.length === 0) {
        await persist(get().threads.find((t) => t.id === threadId)!)
        return
      }

      const resultBlocks: ChatContentBlock[] = []
      for (const tu of toolUses) {
        const content = await dispatchTool(tu, connectionId, set)
        resultBlocks.push({ type: 'tool_result', tool_use_id: tu.id, content })
      }

      set((s) => ({
        threads: patchThread(s.threads, threadId, (t) => ({
          ...t, messages: [...t.messages, { role: 'user', content: resultBlocks }], updatedAt: now(),
        })),
      }))
    }

    await persist(get().threads.find((t) => t.id === threadId)!)
  },

  approveRun: () => {
    const r = confirmResolver
    confirmResolver = null
    set({ pendingConfirm: null })
    r?.(true)
  },

  rejectRun: () => {
    const r = confirmResolver
    confirmResolver = null
    set({ pendingConfirm: null })
    r?.(false)
  },
}))

type SetFn = (partial: Partial<ChatState> | ((s: ChatState) => Partial<ChatState>)) => void

/**
 * Execute one tool_use and return its tool_result content string.
 * - data tools  → runDataTool (IPC)
 * - open_query_tab → opens an editor tab (renderer-native)
 * - run_query   → dry-run for estimate, await user approval, then execute
 */
async function dispatchTool(
  tu: ChatToolUseBlock,
  connectionId: string,
  set: SetFn
): Promise<string> {
  try {
    if (tu.name === 'open_query_tab') {
      const sql = String((tu.input as { sql?: unknown }).sql ?? '')
      useQueryStore.getState().openTab({ sql, connectionId })
      return 'Opened a new editor tab with the SQL.'
    }

    if (tu.name === 'run_query') {
      const sql = String((tu.input as { sql?: unknown }).sql ?? '')
      let bytesProcessed = 0
      try {
        const dry = await window.api.invoke(CHANNELS.QUERY_DRY_RUN, { connectionId, sql })
        bytesProcessed = dry.bytesProcessed ?? 0
      } catch { /* estimate is optional */ }

      const approved = await new Promise<boolean>((resolve) => {
        confirmResolver = resolve
        set({ pendingConfirm: { toolUseId: tu.id, sql, bytesProcessed } })
      })

      if (!approved) return 'The user declined to run this query.'

      const result = await window.api.invoke(CHANNELS.QUERY_EXECUTE, {
        connectionId, sql, tabId: `chat-${tu.id}`,
      })
      return capResult(result)
    }

    return await runDataTool(tu.name, tu.input, { connectionId })
  } catch (err) {
    return `Tool error: ${err instanceof Error ? err.message : String(err)}`
  }
}

// ── AI_CHAT_STREAM push listener ────────────────────────────────────────────
/** Exported for direct unit testing (clearMocks wipes the import-time on() call). */
export function applyChatStreamPush(data: unknown): void {
  const { delta } = data as { requestId: string; delta: string }
  useChatStore.setState((s) => ({ streamingText: s.streamingText + delta }))
}

window.api.on(CHANNELS.AI_CHAT_STREAM, applyChatStreamPush)
