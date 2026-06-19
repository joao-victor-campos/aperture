import { create } from 'zustand'
import { CHANNELS } from '@shared/ipc'
import type { ChatThread, ChatMessage } from '@shared/types'

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

// Resolver for the in-flight run_query confirmation (approve/reject). Used by the
// agent loop in the next task.
export let confirmResolver: ((approved: boolean) => void) | null = null

export function setConfirmResolver(fn: ((approved: boolean) => void) | null): void {
  confirmResolver = fn
}

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

  // sendMessage + approveRun/rejectRun implemented in the next task.
  sendMessage: async (_text: string) => {
    /* implemented in Task 14 */
  },
  approveRun: () => {
    /* implemented in Task 14 */
  },
  rejectRun: () => {
    /* implemented in Task 14 */
  },
}))

// ── AI_CHAT_STREAM push listener ────────────────────────────────────────────
/** Exported for direct unit testing (clearMocks wipes the import-time on() call). */
export function applyChatStreamPush(data: unknown): void {
  const { delta } = data as { requestId: string; delta: string }
  useChatStore.setState((s) => ({ streamingText: s.streamingText + delta }))
}

window.api.on(CHANNELS.AI_CHAT_STREAM, applyChatStreamPush)
