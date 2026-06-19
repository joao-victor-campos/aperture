# AI Chat Companion Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Add an agentic, Anthropic-powered chat companion to Aperture that explores the active connection's catalog, drafts SQL into editor tabs, and runs queries with per-run confirmation, with multiple saved threads.

**Architecture:** The main process owns the Anthropic client + API key behind a thin `LlmProvider` interface (one new privileged op: `AI_CHAT_COMPLETE`, with token streaming over the `AI_CHAT_STREAM` push channel). The renderer's `chatStore` orchestrates the agent loop — it dispatches tool calls to existing IPC channels (catalog/query) and to renderer-native actions (open tab, run-confirmation), feeding tool results back until the model returns a final answer. Threads persist in `store.ts`.

**Tech Stack:** Electron + TypeScript, React + Zustand + Tailwind (renderer), `@anthropic-ai/sdk` (new), Vitest (tests). Reuses existing typed IPC (`src/shared/ipc.ts`), DB adapters, and the `QUERY_LOG`-style push pattern.

**Reference spec:** `docs/superpowers/specs/2026-06-19-ai-chat-companion-design.md`

---

## Conventions & ground rules (read once)

- **Coverage gate (70%)** measures only `src/main/db/**`, `src/main/ipc/**`, `src/renderer/src/store/**` (see `vitest.config.ts`). The new **coverage-gated** files are: `src/main/ipc/ai.ts`, `src/main/ipc/chatThreads.ts`, `src/renderer/src/store/chatStore.ts`. They MUST be well-tested. New files under `src/main/ai/**` and `src/renderer/src/ai/**` sit OUTSIDE the include set (like `src/main/updates/**` and `src/renderer/src/lib/**`) — we still test the logic ones, but they don't affect the gate.
- **Components are not unit-tested in this codebase** (no React Testing Library is installed). UI tasks end in a typecheck + manual smoke step, matching the existing pattern.
- **Run the full suite** with `npm test`. Typecheck with `npm run typecheck`.
- **Commit after every task.** Branch is already `claude/...` (never commit to `master`).
- Message/content block shapes intentionally mirror Anthropic's wire format so mapping is near-identity.

---

## File structure (created / modified)

**Shared**
- `src/shared/types.ts` (modify) — `ChatRole`, `ChatTextBlock`, `ChatToolUseBlock`, `ChatToolResultBlock`, `ChatContentBlock`, `ChatMessage`, `ChatThread`, `AiToolDef`, `AiCompleteRequest`, `AiCompleteResponse`, `AiConfigStatus`, `AiConfigSet`
- `src/shared/ipc.ts` (modify) — channels + `IpcMap` entries

**Main**
- `src/main/db/store.ts` (modify) — `chatThreads`, `aiConfig` on `StoreData`
- `src/main/ai/llmProvider.ts` (create) — `LlmProvider` interface + registry
- `src/main/ai/anthropicProvider.ts` (create) — Anthropic impl + message/tool mappers
- `src/main/ipc/ai.ts` (create) — `AI_CHAT_COMPLETE` + `AI_CONFIG_GET/SET` handlers
- `src/main/ipc/chatThreads.ts` (create) — `CHAT_THREADS_LIST/SAVE/DELETE` handlers
- `src/main/ipc/index.ts` (modify) — register the two new handler groups

**Renderer**
- `src/renderer/src/ai/capResult.ts` (create) — pure result-capping helper
- `src/renderer/src/ai/systemPrompt.ts` (create) — pure system-prompt builder
- `src/renderer/src/ai/tools.ts` (create) — `TOOL_DEFS` + `runDataTool`
- `src/renderer/src/store/chatStore.ts` (create) — threads, agent loop, confirmation, streaming
- `src/renderer/src/components/chat/ChatPanel.tsx` (create)
- `src/renderer/src/components/chat/ThreadRail.tsx` (create)
- `src/renderer/src/components/chat/MessageList.tsx` (create)
- `src/renderer/src/components/chat/MessageBubble.tsx` (create)
- `src/renderer/src/components/chat/RunConfirmCard.tsx` (create)
- `src/renderer/src/components/chat/ChatComposer.tsx` (create)
- `src/renderer/src/components/settings/SettingsModal.tsx` (modify) — AI section
- `src/renderer/src/components/layout/TitleBar.tsx` (modify) — chat toggle button
- `src/renderer/src/App.tsx` (modify) — mount `ChatPanel`, wire toggle + load threads

**Tests**
- `src/__tests__/main/ipc/chatThreads.test.ts`
- `src/__tests__/main/ipc/ai.test.ts`
- `src/__tests__/main/ai/anthropicProvider.test.ts`
- `src/__tests__/renderer/ai/capResult.test.ts`
- `src/__tests__/renderer/ai/tools.test.ts`
- `src/__tests__/renderer/store/chatStore.test.ts`

**Docs**
- `README.md`, `CHANGELOG.md`, `CLAUDE.md` (change log entry)

---

## Phase 0 — Dependency & shared contracts

### Task 1: Add the Anthropic SDK dependency

**Files:**
- Modify: `package.json`

- [ ] **Step 1: Install the SDK**

Run:
```bash
npm install @anthropic-ai/sdk@^0.32.1
```
Expected: `package.json` `dependencies` gains `"@anthropic-ai/sdk"`, lockfile updates, no errors.

- [ ] **Step 2: Verify it resolves**

Run:
```bash
node -e "require('@anthropic-ai/sdk'); console.log('ok')"
```
Expected: prints `ok`.

- [ ] **Step 3: Commit**

```bash
git add package.json package-lock.json
git commit -m "build(ai): add @anthropic-ai/sdk dependency"
```

---

### Task 2: Shared types for chat

**Files:**
- Modify: `src/shared/types.ts` (append at end of file)

- [ ] **Step 1: Append the chat types**

Add to the end of `src/shared/types.ts`:

```ts
// ── AI chat companion ───────────────────────────────────────────────────────

export type ChatRole = 'user' | 'assistant'

export interface ChatTextBlock {
  type: 'text'
  text: string
}

export interface ChatToolUseBlock {
  type: 'tool_use'
  id: string
  name: string
  input: Record<string, unknown>
}

export interface ChatToolResultBlock {
  type: 'tool_result'
  tool_use_id: string
  content: string
  isError?: boolean
}

export type ChatContentBlock = ChatTextBlock | ChatToolUseBlock | ChatToolResultBlock

export interface ChatMessage {
  role: ChatRole
  content: ChatContentBlock[]
}

export interface ChatThread {
  id: string
  title: string
  /** The connection this thread explores. Tools run against it. */
  connectionId: string
  messages: ChatMessage[]
  createdAt: string
  updatedAt: string
}

/** Tool schema in Anthropic's shape (passed straight through to the SDK). */
export interface AiToolDef {
  name: string
  description: string
  input_schema: Record<string, unknown>
}

export interface AiCompleteRequest {
  /** Correlates AI_CHAT_STREAM push events back to this turn. */
  requestId: string
  system: string
  messages: ChatMessage[]
  tools: AiToolDef[]
}

export interface AiCompleteResponse {
  /** The assistant turn (text + any tool_use blocks). */
  message: ChatMessage
  stopReason: string | null
  /** Set when the call failed (missing key, network, etc.). message is empty then. */
  error?: string
}

/** Non-secret view of the AI config returned to the renderer. */
export interface AiConfigStatus {
  configured: boolean
  /** Last 4 chars of the key, e.g. "…a1b2"; null when unconfigured. */
  maskedHint: string | null
  model: string
}

/** Payload to update AI config. Omit apiKey to change only the model. */
export interface AiConfigSet {
  apiKey?: string
  model?: string
}
```

- [ ] **Step 2: Typecheck**

Run: `npm run typecheck`
Expected: PASS (no usages yet, types compile).

- [ ] **Step 3: Commit**

```bash
git add src/shared/types.ts
git commit -m "feat(ai): add shared chat types"
```

---

### Task 3: IPC channels for chat

**Files:**
- Modify: `src/shared/ipc.ts`

- [ ] **Step 1: Add channel constants**

In `src/shared/ipc.ts`, extend the import on line 1 to include the new types:

```ts
import type { Connection, ConnectionCreate, Dataset, Table, TableField, TableSearchHit, QueryResult, SavedQuery, Folder, HistoryEntry, Theme, ThemeImportPayload, UpdateStatus, ChatThread, AiCompleteRequest, AiCompleteResponse, AiConfigStatus, AiConfigSet } from './types'
```

Then add these entries to the `CHANNELS` object (before the closing `} as const`):

```ts
  // AI chat
  AI_CHAT_COMPLETE: 'ai:chat-complete',
  AI_CONFIG_GET: 'ai:config-get',
  AI_CONFIG_SET: 'ai:config-set',
  // Push event: main → renderer (token streaming; use window.api.on)
  AI_CHAT_STREAM: 'ai:chat-stream',
  // Chat threads
  CHAT_THREADS_LIST: 'chat-threads:list',
  CHAT_THREADS_SAVE: 'chat-threads:save',
  CHAT_THREADS_DELETE: 'chat-threads:delete',
```

- [ ] **Step 2: Add IpcMap entries**

Add to the `IpcMap` interface (before the closing `}` on line ~109):

```ts
  [CHANNELS.AI_CHAT_COMPLETE]: { req: AiCompleteRequest; res: AiCompleteResponse }
  [CHANNELS.AI_CONFIG_GET]: { req: undefined; res: AiConfigStatus }
  [CHANNELS.AI_CONFIG_SET]: { req: AiConfigSet; res: AiConfigStatus }
  [CHANNELS.CHAT_THREADS_LIST]: { req: undefined; res: ChatThread[] }
  [CHANNELS.CHAT_THREADS_SAVE]: { req: ChatThread; res: ChatThread }
  [CHANNELS.CHAT_THREADS_DELETE]: { req: string; res: void }
```

(Note: `AI_CHAT_STREAM` is push-only — deliberately NOT in `IpcMap`, like `QUERY_LOG`/`UPDATES_STATUS`.)

- [ ] **Step 3: Typecheck**

Run: `npm run typecheck`
Expected: PASS.

- [ ] **Step 4: Commit**

```bash
git add src/shared/ipc.ts
git commit -m "feat(ai): add chat IPC channels"
```

---

## Phase 1 — Main process

### Task 4: Store fields for threads + AI config

**Files:**
- Modify: `src/main/db/store.ts`

- [ ] **Step 1: Extend StoreData + DEFAULTS**

In `src/main/db/store.ts`, update the import (line 4) to add `ChatThread`:

```ts
import type { Connection, SavedQuery, Folder, HistoryEntry, Theme, ChatThread } from '../../shared/types'
```

Add fields to `interface StoreData`:

```ts
  chatThreads: ChatThread[]
  aiConfig: { apiKey: string | null; model: string }
```

Add matching defaults to `DEFAULTS`:

```ts
  chatThreads: [],
  aiConfig: { apiKey: null, model: 'claude-sonnet-4-6' },
```

- [ ] **Step 2: Typecheck**

Run: `npm run typecheck`
Expected: PASS.

- [ ] **Step 3: Commit**

```bash
git add src/main/db/store.ts
git commit -m "feat(ai): persist chat threads + ai config in store"
```

---

### Task 5: Chat threads IPC handler (coverage-gated)

**Files:**
- Create: `src/main/ipc/chatThreads.ts`
- Test: `src/__tests__/main/ipc/chatThreads.test.ts`

- [ ] **Step 1: Write the failing test**

Create `src/__tests__/main/ipc/chatThreads.test.ts`:

```ts
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
```

- [ ] **Step 2: Run to verify it fails**

Run: `npm test -- chatThreads`
Expected: FAIL — cannot find module `../../../main/ipc/chatThreads`.

- [ ] **Step 3: Implement the handler**

Create `src/main/ipc/chatThreads.ts`:

```ts
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
```

- [ ] **Step 4: Run to verify it passes**

Run: `npm test -- chatThreads`
Expected: PASS (5 tests).

- [ ] **Step 5: Commit**

```bash
git add src/main/ipc/chatThreads.ts src/__tests__/main/ipc/chatThreads.test.ts
git commit -m "feat(ai): chat threads IPC handlers"
```

---

### Task 6: LLM provider interface + registry

**Files:**
- Create: `src/main/ai/llmProvider.ts`

- [ ] **Step 1: Write the interface**

Create `src/main/ai/llmProvider.ts`:

```ts
import type { ChatMessage, AiToolDef } from '../../shared/types'

export interface LlmCompleteParams {
  model: string
  system: string
  messages: ChatMessage[]
  tools: AiToolDef[]
}

export interface LlmCompleteResult {
  message: ChatMessage
  stopReason: string | null
}

/** A pluggable LLM backend. Anthropic is the only impl for v1. */
export interface LlmProvider {
  /**
   * Run one completion turn. Calls onDelta for each streamed text fragment,
   * resolves with the full assistant message (text + tool_use blocks).
   */
  complete(
    params: LlmCompleteParams,
    apiKey: string,
    onDelta: (text: string) => void
  ): Promise<LlmCompleteResult>
}

const registry: Record<string, LlmProvider> = {}

export function registerProvider(id: string, provider: LlmProvider): void {
  registry[id] = provider
}

export function getProvider(id: string): LlmProvider {
  const p = registry[id]
  if (!p) throw new Error(`Unknown LLM provider: ${id}`)
  return p
}
```

- [ ] **Step 2: Typecheck**

Run: `npm run typecheck`
Expected: PASS.

- [ ] **Step 3: Commit**

```bash
git add src/main/ai/llmProvider.ts
git commit -m "feat(ai): LlmProvider interface + registry"
```

---

### Task 7: Anthropic provider implementation

**Files:**
- Create: `src/main/ai/anthropicProvider.ts`
- Test: `src/__tests__/main/ai/anthropicProvider.test.ts`

- [ ] **Step 1: Write the failing test**

Create `src/__tests__/main/ai/anthropicProvider.test.ts`:

```ts
import { describe, it, expect, vi, beforeEach } from 'vitest'

// Mock the SDK: messages.stream returns an object with .on('text') + finalMessage().
const onText = vi.fn()
const finalMessage = vi.fn()
const streamFn = vi.fn(() => ({
  on: (evt: string, cb: (d: string) => void) => { if (evt === 'text') onText.mockImplementation(cb) },
  finalMessage,
}))

vi.mock('@anthropic-ai/sdk', () => ({
  default: class {
    messages = { stream: streamFn }
    constructor(_opts: unknown) {}
  },
}))

import { anthropicProvider } from '../../../main/ai/anthropicProvider'

beforeEach(() => {
  streamFn.mockClear()
  finalMessage.mockReset()
})

describe('anthropicProvider.complete', () => {
  it('passes model/system/messages/tools to the SDK and returns the mapped final message', async () => {
    finalMessage.mockResolvedValue({
      content: [
        { type: 'text', text: 'hello' },
        { type: 'tool_use', id: 'tu_1', name: 'search_tables', input: { query: 'orders' } },
      ],
      stop_reason: 'tool_use',
    })

    const result = await anthropicProvider.complete(
      {
        model: 'claude-sonnet-4-6',
        system: 'You are helpful',
        messages: [{ role: 'user', content: [{ type: 'text', text: 'hi' }] }],
        tools: [{ name: 'search_tables', description: 'd', input_schema: { type: 'object' } }],
      },
      'sk-test',
      () => {}
    )

    expect(streamFn).toHaveBeenCalledOnce()
    const arg = streamFn.mock.calls[0][0] as Record<string, unknown>
    expect(arg.model).toBe('claude-sonnet-4-6')
    expect(arg.system).toBe('You are helpful')
    expect(result.stopReason).toBe('tool_use')
    expect(result.message.role).toBe('assistant')
    expect(result.message.content).toEqual([
      { type: 'text', text: 'hello' },
      { type: 'tool_use', id: 'tu_1', name: 'search_tables', input: { query: 'orders' } },
    ])
  })
})
```

- [ ] **Step 2: Run to verify it fails**

Run: `npm test -- anthropicProvider`
Expected: FAIL — cannot find module.

- [ ] **Step 3: Implement the provider**

Create `src/main/ai/anthropicProvider.ts`:

```ts
import Anthropic from '@anthropic-ai/sdk'
import type { ChatContentBlock } from '../../shared/types'
import { registerProvider, type LlmProvider } from './llmProvider'

/** Map our final-message content blocks (already Anthropic-shaped) to our type. */
function toContentBlocks(content: unknown[]): ChatContentBlock[] {
  const out: ChatContentBlock[] = []
  for (const raw of content) {
    const b = raw as Record<string, unknown>
    if (b.type === 'text') {
      out.push({ type: 'text', text: String(b.text ?? '') })
    } else if (b.type === 'tool_use') {
      out.push({
        type: 'tool_use',
        id: String(b.id),
        name: String(b.name),
        input: (b.input ?? {}) as Record<string, unknown>,
      })
    }
  }
  return out
}

export const anthropicProvider: LlmProvider = {
  async complete(params, apiKey, onDelta) {
    const client = new Anthropic({ apiKey })
    const stream = client.messages.stream({
      model: params.model,
      max_tokens: 4096,
      system: params.system,
      // Our ChatMessage shape mirrors Anthropic's MessageParam.
      messages: params.messages as unknown as Anthropic.MessageParam[],
      tools: params.tools as unknown as Anthropic.Tool[],
    })
    stream.on('text', (delta: string) => onDelta(delta))
    const final = await stream.finalMessage()
    return {
      message: { role: 'assistant', content: toContentBlocks(final.content) },
      stopReason: (final.stop_reason as string | null) ?? null,
    }
  },
}

registerProvider('anthropic', anthropicProvider)
```

- [ ] **Step 4: Run to verify it passes**

Run: `npm test -- anthropicProvider`
Expected: PASS.

- [ ] **Step 5: Typecheck + commit**

Run: `npm run typecheck` → PASS
```bash
git add src/main/ai/anthropicProvider.ts src/__tests__/main/ai/anthropicProvider.test.ts
git commit -m "feat(ai): Anthropic provider implementation"
```

---

### Task 8: AI IPC handlers — config + completion (coverage-gated)

**Files:**
- Create: `src/main/ipc/ai.ts`
- Test: `src/__tests__/main/ipc/ai.test.ts`

- [ ] **Step 1: Write the failing test**

Create `src/__tests__/main/ipc/ai.test.ts`:

```ts
import { describe, it, expect, vi, beforeEach } from 'vitest'
import { CHANNELS } from '../../../shared/ipc'
import type { AiCompleteRequest } from '../../../shared/types'

type Handler = (event: unknown, req?: unknown) => unknown
const handlers = new Map<string, Handler>()
vi.mock('electron', () => ({
  ipcMain: { handle: (channel: string, fn: Handler) => handlers.set(channel, fn) },
}))

type Store = { aiConfig: { apiKey: string | null; model: string } }
const storeData: Store = { aiConfig: { apiKey: null, model: 'claude-sonnet-4-6' } }
vi.mock('../../../main/db/store', () => ({
  store: {
    get: (k: string) => storeData[k as 'aiConfig'],
    set: (k: string, v: unknown) => { storeData[k as 'aiConfig'] = v as Store['aiConfig'] },
  },
}))

const complete = vi.fn()
vi.mock('../../../main/ai/llmProvider', () => ({
  getProvider: () => ({ complete }),
}))
// Importing anthropicProvider for its registration side-effect is unnecessary here
// because we mock getProvider; stub the module so the import in ai.ts is harmless.
vi.mock('../../../main/ai/anthropicProvider', () => ({ anthropicProvider: {} }))

import { registerAiHandlers } from '../../../main/ipc/ai'

function req(): AiCompleteRequest {
  return {
    requestId: 'r1',
    system: 'sys',
    messages: [{ role: 'user', content: [{ type: 'text', text: 'hi' }] }],
    tools: [],
  }
}

beforeEach(() => {
  handlers.clear()
  storeData.aiConfig = { apiKey: null, model: 'claude-sonnet-4-6' }
  complete.mockReset()
  registerAiHandlers()
})

describe('AI_CONFIG_GET', () => {
  it('reports unconfigured when no key', async () => {
    const res = await handlers.get(CHANNELS.AI_CONFIG_GET)!({})
    expect(res).toEqual({ configured: false, maskedHint: null, model: 'claude-sonnet-4-6' })
  })

  it('masks the key when configured', async () => {
    storeData.aiConfig = { apiKey: 'sk-secret-a1b2', model: 'claude-opus-4-8' }
    const res = await handlers.get(CHANNELS.AI_CONFIG_GET)!({})
    expect(res).toEqual({ configured: true, maskedHint: '…a1b2', model: 'claude-opus-4-8' })
  })
})

describe('AI_CONFIG_SET', () => {
  it('updates key + model and returns masked status', async () => {
    const res = await handlers.get(CHANNELS.AI_CONFIG_SET)!({}, { apiKey: 'sk-xyz9', model: 'claude-haiku-4-5' })
    expect(storeData.aiConfig.apiKey).toBe('sk-xyz9')
    expect(storeData.aiConfig.model).toBe('claude-haiku-4-5')
    expect(res).toEqual({ configured: true, maskedHint: '…xyz9', model: 'claude-haiku-4-5' })
  })

  it('updates only the model when apiKey omitted', async () => {
    storeData.aiConfig = { apiKey: 'sk-keep1234', model: 'claude-sonnet-4-6' }
    await handlers.get(CHANNELS.AI_CONFIG_SET)!({}, { model: 'claude-opus-4-8' })
    expect(storeData.aiConfig.apiKey).toBe('sk-keep1234')
    expect(storeData.aiConfig.model).toBe('claude-opus-4-8')
  })
})

describe('AI_CHAT_COMPLETE', () => {
  it('returns an error response when no API key is set', async () => {
    const res = await handlers.get(CHANNELS.AI_CHAT_COMPLETE)!({}, req())
    expect((res as { error?: string }).error).toMatch(/api key/i)
    expect(complete).not.toHaveBeenCalled()
  })

  it('calls the provider and streams deltas to the sender', async () => {
    storeData.aiConfig = { apiKey: 'sk-1234', model: 'claude-sonnet-4-6' }
    complete.mockImplementation(async (_p: unknown, _k: unknown, onDelta: (t: string) => void) => {
      onDelta('he'); onDelta('llo')
      return { message: { role: 'assistant', content: [{ type: 'text', text: 'hello' }] }, stopReason: 'end_turn' }
    })
    const send = vi.fn()
    const res = await handlers.get(CHANNELS.AI_CHAT_COMPLETE)!({ sender: { send } }, req())

    expect(send).toHaveBeenNthCalledWith(1, CHANNELS.AI_CHAT_STREAM, { requestId: 'r1', delta: 'he' })
    expect(send).toHaveBeenNthCalledWith(2, CHANNELS.AI_CHAT_STREAM, { requestId: 'r1', delta: 'llo' })
    expect((res as { stopReason: string }).stopReason).toBe('end_turn')
  })

  it('returns an error response when the provider throws', async () => {
    storeData.aiConfig = { apiKey: 'sk-1234', model: 'claude-sonnet-4-6' }
    complete.mockRejectedValue(new Error('network down'))
    const res = await handlers.get(CHANNELS.AI_CHAT_COMPLETE)!({ sender: { send: vi.fn() } }, req())
    expect((res as { error?: string }).error).toBe('network down')
  })
})
```

- [ ] **Step 2: Run to verify it fails**

Run: `npm test -- ipc/ai`
Expected: FAIL — cannot find module `../../../main/ipc/ai`.

- [ ] **Step 3: Implement the handler**

Create `src/main/ipc/ai.ts`:

```ts
import { ipcMain } from 'electron'
import { CHANNELS } from '../../shared/ipc'
import { store } from '../db/store'
import { getProvider } from '../ai/llmProvider'
import type { AiCompleteRequest, AiCompleteResponse, AiConfigStatus, AiConfigSet } from '../../shared/types'
// Side-effect import: registers the 'anthropic' provider.
import '../ai/anthropicProvider'

function statusOf(cfg: { apiKey: string | null; model: string }): AiConfigStatus {
  return {
    configured: !!cfg.apiKey,
    maskedHint: cfg.apiKey ? `…${cfg.apiKey.slice(-4)}` : null,
    model: cfg.model,
  }
}

export function registerAiHandlers(): void {
  ipcMain.handle(CHANNELS.AI_CONFIG_GET, async (): Promise<AiConfigStatus> => {
    return statusOf(store.get('aiConfig'))
  })

  ipcMain.handle(CHANNELS.AI_CONFIG_SET, async (_event, req: AiConfigSet): Promise<AiConfigStatus> => {
    const cfg = store.get('aiConfig')
    const next = {
      apiKey: req.apiKey !== undefined ? req.apiKey : cfg.apiKey,
      model: req.model !== undefined ? req.model : cfg.model,
    }
    store.set('aiConfig', next)
    return statusOf(next)
  })

  ipcMain.handle(
    CHANNELS.AI_CHAT_COMPLETE,
    async (event, req: AiCompleteRequest): Promise<AiCompleteResponse> => {
      const cfg = store.get('aiConfig')
      if (!cfg.apiKey) {
        return {
          message: { role: 'assistant', content: [] },
          stopReason: null,
          error: 'No API key configured. Add one in Settings → AI.',
        }
      }
      try {
        const provider = getProvider('anthropic')
        const result = await provider.complete(
          { model: cfg.model, system: req.system, messages: req.messages, tools: req.tools },
          cfg.apiKey,
          (delta) => event.sender.send(CHANNELS.AI_CHAT_STREAM, { requestId: req.requestId, delta })
        )
        return { message: result.message, stopReason: result.stopReason }
      } catch (err) {
        return {
          message: { role: 'assistant', content: [] },
          stopReason: null,
          error: err instanceof Error ? err.message : String(err),
        }
      }
    }
  )
}
```

- [ ] **Step 4: Run to verify it passes**

Run: `npm test -- ipc/ai`
Expected: PASS (7 tests).

- [ ] **Step 5: Commit**

```bash
git add src/main/ipc/ai.ts src/__tests__/main/ipc/ai.test.ts
git commit -m "feat(ai): AI config + completion IPC handlers"
```

---

### Task 9: Register the new handler groups

**Files:**
- Modify: `src/main/ipc/index.ts`

- [ ] **Step 1: Wire up registration**

In `src/main/ipc/index.ts`, add imports after line 8:

```ts
import { registerAiHandlers } from './ai'
import { registerChatThreadHandlers } from './chatThreads'
```

Add calls inside `registerIpcHandlers()` after `registerUpdateHandlers()`:

```ts
  registerAiHandlers()
  registerChatThreadHandlers()
```

- [ ] **Step 2: Typecheck + full suite**

Run: `npm run typecheck && npm test`
Expected: PASS (all existing + new tests).

- [ ] **Step 3: Commit**

```bash
git add src/main/ipc/index.ts
git commit -m "feat(ai): register AI + chat-thread IPC handlers"
```

---

## Phase 2 — Renderer logic (pure helpers + tools)

### Task 10: Result-capping helper

**Files:**
- Create: `src/renderer/src/ai/capResult.ts`
- Test: `src/__tests__/renderer/ai/capResult.test.ts`

- [ ] **Step 1: Write the failing test**

Create `src/__tests__/renderer/ai/capResult.test.ts`:

```ts
import { describe, it, expect } from 'vitest'
import { capResult } from '../../../renderer/src/ai/capResult'
import type { QueryResult } from '../../../shared/types'

function make(rowCount: number): QueryResult {
  return {
    columns: ['id', 'name'],
    rows: Array.from({ length: rowCount }, (_, i) => ({ id: i, name: `n${i}` })),
    rowCount,
    executionTimeMs: 10,
  }
}

describe('capResult', () => {
  it('includes all rows when under the cap', () => {
    const out = capResult(make(3), 50)
    expect(out).toContain('"columns"')
    const parsed = JSON.parse(out)
    expect(parsed.rows).toHaveLength(3)
    expect(parsed.truncated).toBe(false)
  })

  it('caps rows and flags truncation when over the cap', () => {
    const out = capResult(make(120), 50)
    const parsed = JSON.parse(out)
    expect(parsed.rows).toHaveLength(50)
    expect(parsed.truncated).toBe(true)
    expect(parsed.totalRows).toBe(120)
  })

  it('reports columns and zero rows for empty results', () => {
    const out = capResult(make(0), 50)
    const parsed = JSON.parse(out)
    expect(parsed.rows).toHaveLength(0)
    expect(parsed.columns).toEqual(['id', 'name'])
  })
})
```

- [ ] **Step 2: Run to verify it fails**

Run: `npm test -- capResult`
Expected: FAIL — cannot find module.

- [ ] **Step 3: Implement**

Create `src/renderer/src/ai/capResult.ts`:

```ts
import type { QueryResult } from '@shared/types'

/**
 * Serialize a query result into a compact string for the model's tool_result.
 * Sends column names + the first `limit` rows + the total row count, so token
 * cost stays bounded on large results.
 */
export function capResult(result: QueryResult, limit = 50): string {
  const total = result.totalRows ?? result.rowCount
  const rows = result.rows.slice(0, limit)
  return JSON.stringify({
    columns: result.columns,
    rows,
    rowCount: result.rowCount,
    totalRows: total,
    truncated: result.rows.length > limit,
    executionTimeMs: result.executionTimeMs,
  })
}
```

- [ ] **Step 4: Run to verify it passes**

Run: `npm test -- capResult`
Expected: PASS (3 tests).

- [ ] **Step 5: Commit**

```bash
git add src/renderer/src/ai/capResult.ts src/__tests__/renderer/ai/capResult.test.ts
git commit -m "feat(ai): capResult helper for tool results"
```

---

### Task 11: System-prompt builder

**Files:**
- Create: `src/renderer/src/ai/systemPrompt.ts`
- Test: `src/__tests__/renderer/ai/systemPrompt.test.ts`

- [ ] **Step 1: Write the failing test**

Create `src/__tests__/renderer/ai/systemPrompt.test.ts`:

```ts
import { describe, it, expect } from 'vitest'
import { buildSystemPrompt } from '../../../renderer/src/ai/systemPrompt'

describe('buildSystemPrompt', () => {
  it('names the active connection and engine', () => {
    const p = buildSystemPrompt('prod-warehouse', 'bigquery')
    expect(p).toContain('prod-warehouse')
    expect(p).toContain('bigquery')
  })

  it('mentions the confirmation rule for running queries', () => {
    const p = buildSystemPrompt('c', 'postgres')
    expect(p.toLowerCase()).toContain('run_query')
  })
})
```

- [ ] **Step 2: Run to verify it fails**

Run: `npm test -- systemPrompt`
Expected: FAIL — cannot find module.

- [ ] **Step 3: Implement**

Create `src/renderer/src/ai/systemPrompt.ts`:

```ts
import type { ConnectionEngine } from '@shared/types'

/**
 * Build the agent's system prompt. Describes its role, the active connection,
 * the engine dialect, and how to use the tools (especially the run_query gate).
 */
export function buildSystemPrompt(connectionName: string, engine: ConnectionEngine): string {
  return [
    'You are Aperture\'s data assistant, embedded in a SQL IDE.',
    `You are connected to "${connectionName}", a ${engine} database. All tools operate on this connection only.`,
    '',
    'Guidelines:',
    `- Write ${engine}-dialect SQL${engine === 'neo4j' ? ' (Cypher)' : ''}.`,
    '- Use list_datasets, search_tables, and get_table_schema to discover structure before writing queries. Do not guess column names.',
    '- Use open_query_tab to put SQL in front of the user in a new editor tab.',
    '- Use dry_run_query to validate SQL and estimate cost without spending.',
    '- Use run_query to execute. The user must approve each run; results come back as a capped sample (first rows + total count).',
    '- Be concise. Explain what you found, not every step you took.',
  ].join('\n')
}
```

- [ ] **Step 4: Run to verify it passes**

Run: `npm test -- systemPrompt`
Expected: PASS (2 tests).

- [ ] **Step 5: Commit**

```bash
git add src/renderer/src/ai/systemPrompt.ts src/__tests__/renderer/ai/systemPrompt.test.ts
git commit -m "feat(ai): system-prompt builder"
```

---

### Task 12: Tool definitions + data-tool dispatch

**Files:**
- Create: `src/renderer/src/ai/tools.ts`
- Test: `src/__tests__/renderer/ai/tools.test.ts`

- [ ] **Step 1: Write the failing test**

Create `src/__tests__/renderer/ai/tools.test.ts`:

```ts
import { describe, it, expect, vi, beforeEach } from 'vitest'
import { CHANNELS } from '@shared/ipc'
import { TOOL_DEFS, runDataTool } from '../../../renderer/src/ai/tools'

beforeEach(() => {
  vi.mocked(window.api.invoke).mockReset()
})

describe('TOOL_DEFS', () => {
  it('exposes the six tools by name', () => {
    expect(TOOL_DEFS.map((t) => t.name).sort()).toEqual(
      ['dry_run_query', 'get_table_schema', 'list_datasets', 'open_query_tab', 'run_query', 'search_tables'].sort()
    )
  })

  it('every tool has an object input_schema', () => {
    for (const t of TOOL_DEFS) expect((t.input_schema as { type: string }).type).toBe('object')
  })
})

describe('runDataTool', () => {
  it('search_tables forwards to CATALOG_SEARCH_TABLES and stringifies the result', async () => {
    vi.mocked(window.api.invoke).mockResolvedValue([{ datasetId: 'd', tableId: 't', name: 't', type: 'TABLE' }])
    const out = await runDataTool('search_tables', { query: 'ord' }, { connectionId: 'c1' })
    expect(window.api.invoke).toHaveBeenCalledWith(CHANNELS.CATALOG_SEARCH_TABLES, { connectionId: 'c1', query: 'ord' })
    expect(out).toContain('"tableId":"t"')
  })

  it('get_table_schema forwards dataset/table ids', async () => {
    vi.mocked(window.api.invoke).mockResolvedValue([{ name: 'id', type: 'INT64', mode: 'NULLABLE' }])
    await runDataTool('get_table_schema', { projectId: 'p', datasetId: 'd', tableId: 't' }, { connectionId: 'c1' })
    expect(window.api.invoke).toHaveBeenCalledWith(CHANNELS.CATALOG_TABLE_SCHEMA, {
      connectionId: 'c1', projectId: 'p', datasetId: 'd', tableId: 't',
    })
  })

  it('list_datasets forwards the connection id', async () => {
    vi.mocked(window.api.invoke).mockResolvedValue([])
    await runDataTool('list_datasets', {}, { connectionId: 'c1' })
    expect(window.api.invoke).toHaveBeenCalledWith(CHANNELS.CATALOG_DATASETS, 'c1')
  })

  it('dry_run_query forwards sql', async () => {
    vi.mocked(window.api.invoke).mockResolvedValue({ bytesProcessed: 1024 })
    const out = await runDataTool('dry_run_query', { sql: 'SELECT 1' }, { connectionId: 'c1' })
    expect(window.api.invoke).toHaveBeenCalledWith(CHANNELS.QUERY_DRY_RUN, { connectionId: 'c1', sql: 'SELECT 1' })
    expect(out).toContain('1024')
  })

  it('throws for a non-data tool', async () => {
    await expect(runDataTool('run_query', { sql: 'x' }, { connectionId: 'c1' })).rejects.toThrow()
  })
})
```

- [ ] **Step 2: Run to verify it fails**

Run: `npm test -- ai/tools`
Expected: FAIL — cannot find module.

- [ ] **Step 3: Implement**

Create `src/renderer/src/ai/tools.ts`:

```ts
import { CHANNELS } from '@shared/ipc'
import type { AiToolDef } from '@shared/types'

export const TOOL_DEFS: AiToolDef[] = [
  {
    name: 'list_datasets',
    description: 'List datasets/schemas in the active connection.',
    input_schema: { type: 'object', properties: {}, required: [] },
  },
  {
    name: 'search_tables',
    description: 'Find tables by a substring of their name across the active connection.',
    input_schema: {
      type: 'object',
      properties: { query: { type: 'string', description: 'Substring to search for (min 2 chars).' } },
      required: ['query'],
    },
  },
  {
    name: 'get_table_schema',
    description: 'Get the columns and types of a specific table.',
    input_schema: {
      type: 'object',
      properties: {
        projectId: { type: 'string', description: 'Project id (use "" if not applicable).' },
        datasetId: { type: 'string' },
        tableId: { type: 'string' },
      },
      required: ['datasetId', 'tableId'],
    },
  },
  {
    name: 'open_query_tab',
    description: 'Open a new editor tab containing the given SQL for the user to see/run.',
    input_schema: {
      type: 'object',
      properties: { sql: { type: 'string' } },
      required: ['sql'],
    },
  },
  {
    name: 'dry_run_query',
    description: 'Validate SQL and estimate bytes processed without executing it.',
    input_schema: {
      type: 'object',
      properties: { sql: { type: 'string' } },
      required: ['sql'],
    },
  },
  {
    name: 'run_query',
    description: 'Execute SQL against the active connection. Requires user confirmation. Returns a capped row sample.',
    input_schema: {
      type: 'object',
      properties: { sql: { type: 'string' } },
      required: ['sql'],
    },
  },
]

export interface DataToolContext {
  connectionId: string
}

/**
 * Execute a side-effect-free "data" tool by forwarding to existing IPC channels.
 * Returns a string suitable for a tool_result. Throws for interactive tools
 * (open_query_tab, run_query), which the chat store handles itself.
 */
export async function runDataTool(
  name: string,
  input: Record<string, unknown>,
  ctx: DataToolContext
): Promise<string> {
  switch (name) {
    case 'list_datasets': {
      const r = await window.api.invoke(CHANNELS.CATALOG_DATASETS, ctx.connectionId)
      return JSON.stringify(r)
    }
    case 'search_tables': {
      const r = await window.api.invoke(CHANNELS.CATALOG_SEARCH_TABLES, {
        connectionId: ctx.connectionId,
        query: String(input.query ?? ''),
      })
      return JSON.stringify(r)
    }
    case 'get_table_schema': {
      const r = await window.api.invoke(CHANNELS.CATALOG_TABLE_SCHEMA, {
        connectionId: ctx.connectionId,
        projectId: String(input.projectId ?? ''),
        datasetId: String(input.datasetId ?? ''),
        tableId: String(input.tableId ?? ''),
      })
      return JSON.stringify(r)
    }
    case 'dry_run_query': {
      const r = await window.api.invoke(CHANNELS.QUERY_DRY_RUN, {
        connectionId: ctx.connectionId,
        sql: String(input.sql ?? ''),
      })
      return JSON.stringify(r)
    }
    default:
      throw new Error(`Not a data tool: ${name}`)
  }
}
```

- [ ] **Step 4: Run to verify it passes**

Run: `npm test -- ai/tools`
Expected: PASS (7 tests).

- [ ] **Step 5: Commit**

```bash
git add src/renderer/src/ai/tools.ts src/__tests__/renderer/ai/tools.test.ts
git commit -m "feat(ai): tool defs + data-tool dispatch"
```

---

## Phase 3 — Chat store (the agent loop)

### Task 13: chatStore — thread CRUD + persistence (coverage-gated)

**Files:**
- Create: `src/renderer/src/store/chatStore.ts`
- Test: `src/__tests__/renderer/store/chatStore.test.ts`

- [ ] **Step 1: Write the failing test**

Create `src/__tests__/renderer/store/chatStore.test.ts`:

```ts
import { describe, it, expect, vi, beforeEach } from 'vitest'
import { CHANNELS } from '@shared/ipc'
import type { ChatThread } from '@shared/types'
import { useChatStore } from '../../../renderer/src/store/chatStore'

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
```

- [ ] **Step 2: Run to verify it fails**

Run: `npm test -- chatStore`
Expected: FAIL — cannot find module.

- [ ] **Step 3: Implement the store skeleton (CRUD + streaming listener)**

Create `src/renderer/src/store/chatStore.ts`:

```ts
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

/** Persist a thread to the main store (fire-and-forget shape, but awaited). */
async function persist(thread: ChatThread): Promise<void> {
  await window.api.invoke(CHANNELS.CHAT_THREADS_SAVE, thread)
}

function patchThread(threads: ChatThread[], id: string, fn: (t: ChatThread) => ChatThread): ChatThread[] {
  return threads.map((t) => (t.id === id ? fn(t) : t))
}

// Resolver for the in-flight run_query confirmation (approve/reject).
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
      id, title: 'New chat', connectionId, messages: [], createdAt: now(), updatedAt: now(),
    }
    set((s) => ({ threads: [thread, ...s.threads], activeThreadId: id }))
    return id
  },

  selectThread: (id) => set({ activeThreadId: id }),

  renameThread: async (id, title) => {
    set((s) => ({ threads: patchThread(s.threads, id, (t) => ({ ...t, title, updatedAt: now() })) }))
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
  sendMessage: async () => { /* implemented in Task 14 */ },
  approveRun: () => { /* implemented in Task 14 */ },
  rejectRun: () => { /* implemented in Task 14 */ },
}))

// ── AI_CHAT_STREAM push listener ────────────────────────────────────────────
/** Exported for direct unit testing (clearMocks wipes the import-time on() call). */
export function applyChatStreamPush(data: unknown): void {
  const { delta } = data as { requestId: string; delta: string }
  useChatStore.setState((s) => ({ streamingText: s.streamingText + delta }))
}

window.api.on(CHANNELS.AI_CHAT_STREAM, applyChatStreamPush)
```

> Note: `sendMessage`/`approveRun`/`rejectRun` are stubs here so the CRUD tests pass; they're implemented in Task 14. The module-level `confirmResolver` is declared now and used by the loop + approve/reject in Task 14.

- [ ] **Step 4: Run to verify it passes**

Run: `npm test -- chatStore`
Expected: PASS (5 CRUD tests).

- [ ] **Step 5: Commit**

```bash
git add src/renderer/src/store/chatStore.ts src/__tests__/renderer/store/chatStore.test.ts
git commit -m "feat(ai): chatStore thread CRUD + stream listener"
```

---

### Task 14: chatStore — the agent loop + confirmation (coverage-gated)

**Files:**
- Modify: `src/renderer/src/store/chatStore.ts`
- Modify: `src/__tests__/renderer/store/chatStore.test.ts` (append)

- [ ] **Step 1: Write the failing tests (append)**

Append to `src/__tests__/renderer/store/chatStore.test.ts`:

```ts
import { applyChatStreamPush } from '../../../renderer/src/store/chatStore'
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
    // First AI_CHAT_COMPLETE → plain text answer (no tools).
    vi.mocked(window.api.invoke).mockImplementation(async (channel: string) => {
      if (channel === CHANNELS.AI_CHAT_COMPLETE) {
        return { message: { role: 'assistant', content: [{ type: 'text', text: 'Hi there' }] }, stopReason: 'end_turn' }
      }
      return undefined // CHAT_THREADS_SAVE
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
          return {
            message: { role: 'assistant', content: [{ type: 'tool_use', id: 'tu1', name: 'search_tables', input: { query: 'ord' } }] },
            stopReason: 'tool_use',
          }
        }
        return { message: { role: 'assistant', content: [{ type: 'text', text: 'Found orders' }] }, stopReason: 'end_turn' }
      }
      if (channel === CHANNELS.CATALOG_SEARCH_TABLES) return [{ datasetId: 'd', tableId: 'orders', name: 'orders', type: 'TABLE' }]
      return undefined
    })

    await useChatStore.getState().sendMessage('find orders')

    const msgs = useChatStore.getState().threads[0].messages
    // user, assistant(tool_use), user(tool_result), assistant(text)
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
    // Wait a tick for the loop to reach the confirmation gate.
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
```

- [ ] **Step 2: Run to verify it fails**

Run: `npm test -- chatStore`
Expected: FAIL — `sendMessage` is a stub; new assertions fail.

- [ ] **Step 3: Implement the loop**

In `src/renderer/src/store/chatStore.ts`, add imports at the top (below existing imports):

```ts
import type { ChatContentBlock, ChatToolUseBlock, AiCompleteResponse } from '@shared/types'
import { useConnectionStore } from './connectionStore'
import { useQueryStore } from './queryStore'
import { TOOL_DEFS, runDataTool } from '../ai/tools'
import { capResult } from '../ai/capResult'
import { buildSystemPrompt } from '../ai/systemPrompt'
```

Replace the three stub methods (`sendMessage`, `approveRun`, `rejectRun`) with:

```ts
  sendMessage: async (text) => {
    const threadId = get().activeThreadId
    if (!threadId) return
    const thread = get().threads.find((t) => t.id === threadId)
    if (!thread) return

    const conn = useConnectionStore.getState().connections.find((c) => c.id === thread.connectionId)
    if (!conn) {
      set({ error: 'This thread\'s connection no longer exists.' })
      return
    }

    // Append the user message; derive the title from the first message.
    const userMsg: ChatMessage = { role: 'user', content: [{ type: 'text', text }] }
    set((s) => ({
      error: null,
      threads: patchThread(s.threads, threadId, (t) => ({
        ...t,
        title: t.messages.length === 0 ? text.slice(0, 40) : t.title,
        messages: [...t.messages, userMsg],
        updatedAt: now(),
      })),
    }))

    const system = buildSystemPrompt(conn.name, conn.engine)

    // Agentic loop: complete → dispatch tools → feed results → repeat.
    // Bounded to avoid runaway loops.
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

      // Persist the assistant turn.
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

      // Execute each tool, building tool_result blocks.
      const resultBlocks: ChatContentBlock[] = []
      for (const tu of toolUses) {
        const content = await dispatchTool(tu, thread.connectionId, set)
        resultBlocks.push({ type: 'tool_result', tool_use_id: tu.id, content })
      }

      // Feed results back as a user message (Anthropic's tool_result convention).
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
```

Then add this module-level helper at the bottom of the file (above the `applyChatStreamPush` block):

```ts
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
      // Estimate cost first (best-effort).
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

    // Default: data tool.
    return await runDataTool(tu.name, tu.input, { connectionId })
  } catch (err) {
    return `Tool error: ${err instanceof Error ? err.message : String(err)}`
  }
}
```

> Note: `dispatchTool` uses the module-level `confirmResolver` already declared in Task 13.

- [ ] **Step 4: Run to verify it passes**

Run: `npm test -- chatStore`
Expected: PASS (all CRUD + loop tests).

- [ ] **Step 5: Full suite + typecheck**

Run: `npm run typecheck && npm test`
Expected: PASS.

- [ ] **Step 6: Commit**

```bash
git add src/renderer/src/store/chatStore.ts src/__tests__/renderer/store/chatStore.test.ts
git commit -m "feat(ai): chatStore agent loop with run confirmation"
```

---

## Phase 4 — UI

> Components are not unit-tested in this codebase. Each task ends in a typecheck; a manual smoke test is done once at the end (Task 21).

### Task 15: RunConfirmCard + MessageBubble

**Files:**
- Create: `src/renderer/src/components/chat/RunConfirmCard.tsx`
- Create: `src/renderer/src/components/chat/MessageBubble.tsx`

- [ ] **Step 1: Write RunConfirmCard**

Create `src/renderer/src/components/chat/RunConfirmCard.tsx`:

```tsx
import { Play, X } from 'lucide-react'

interface Props {
  sql: string
  bytesProcessed: number
  onApprove: () => void
  onReject: () => void
}

function formatBytes(n: number): string {
  if (!n) return 'unknown'
  const units = ['B', 'KB', 'MB', 'GB', 'TB']
  let v = n, i = 0
  while (v >= 1024 && i < units.length - 1) { v /= 1024; i++ }
  return `${v.toFixed(1)} ${units[i]}`
}

export default function RunConfirmCard({ sql, bytesProcessed, onApprove, onReject }: Props) {
  return (
    <div className="border border-app-accent rounded-lg p-3 bg-app-accent-subtle/40 flex flex-col gap-2">
      <div className="app-section-label">Run this query?</div>
      <pre className="text-ui-xs text-app-text-2 whitespace-pre-wrap bg-app-surface rounded-md p-2 border border-app-border max-h-40 overflow-y-auto">
        {sql}
      </pre>
      <div className="flex items-center justify-between">
        <span className="text-ui-xs text-app-text-3 font-tabular">Est. {formatBytes(bytesProcessed)} scanned</span>
        <div className="flex items-center gap-2">
          <button
            type="button"
            onClick={onReject}
            className="flex items-center gap-1 px-2 py-1 rounded-md text-ui text-app-text-2 hover:bg-app-elevated"
          >
            <X size={12} /> Reject
          </button>
          <button
            type="button"
            onClick={onApprove}
            className="flex items-center gap-1 px-2.5 py-1 rounded-md text-ui font-medium bg-app-accent hover:bg-app-accent-hover text-white"
          >
            <Play size={12} /> Approve & run
          </button>
        </div>
      </div>
    </div>
  )
}
```

- [ ] **Step 2: Write MessageBubble**

Create `src/renderer/src/components/chat/MessageBubble.tsx`:

```tsx
import { Search, Table2, FileText, Play, Database, ListTree } from 'lucide-react'
import type { ChatMessage, ChatContentBlock } from '@shared/types'

const TOOL_ICON: Record<string, typeof Search> = {
  search_tables: Search,
  get_table_schema: Table2,
  list_datasets: Database,
  open_query_tab: FileText,
  dry_run_query: ListTree,
  run_query: Play,
}

function ToolChip({ name }: { name: string }) {
  const Icon = TOOL_ICON[name] ?? ListTree
  return (
    <div className="inline-flex items-center gap-1 text-ui-xs text-app-text-3 bg-app-elevated rounded px-1.5 py-0.5">
      <Icon size={11} /> {name.replace(/_/g, ' ')}
    </div>
  )
}

/** Render the visible parts of a message. tool_result blocks (role 'user') are hidden. */
export default function MessageBubble({ message }: { message: ChatMessage }) {
  // Hide synthetic tool_result turns entirely.
  if (message.content.every((b) => b.type === 'tool_result')) return null

  const isUser = message.role === 'user'
  return (
    <div className={`flex ${isUser ? 'justify-end' : 'justify-start'}`}>
      <div
        className={`max-w-[88%] rounded-lg px-3 py-2 text-ui ${
          isUser ? 'bg-app-accent-subtle text-app-text' : 'bg-app-elevated text-app-text'
        }`}
      >
        {message.content.map((block: ChatContentBlock, i) => {
          if (block.type === 'text') {
            return block.text ? <p key={i} className="whitespace-pre-wrap">{block.text}</p> : null
          }
          if (block.type === 'tool_use') {
            return <div key={i} className="mt-1"><ToolChip name={block.name} /></div>
          }
          return null
        })}
      </div>
    </div>
  )
}
```

- [ ] **Step 3: Typecheck**

Run: `npm run typecheck`
Expected: PASS.

- [ ] **Step 4: Commit**

```bash
git add src/renderer/src/components/chat/RunConfirmCard.tsx src/renderer/src/components/chat/MessageBubble.tsx
git commit -m "feat(ai): RunConfirmCard + MessageBubble components"
```

---

### Task 16: MessageList + ChatComposer

**Files:**
- Create: `src/renderer/src/components/chat/MessageList.tsx`
- Create: `src/renderer/src/components/chat/ChatComposer.tsx`

- [ ] **Step 1: Write MessageList**

Create `src/renderer/src/components/chat/MessageList.tsx`:

```tsx
import { useEffect, useRef } from 'react'
import type { ChatMessage } from '@shared/types'
import MessageBubble from './MessageBubble'
import RunConfirmCard from './RunConfirmCard'
import { useChatStore } from '../../store/chatStore'

interface Props {
  messages: ChatMessage[]
}

export default function MessageList({ messages }: Props) {
  const streamingText = useChatStore((s) => s.streamingText)
  const isStreaming = useChatStore((s) => s.isStreaming)
  const pendingConfirm = useChatStore((s) => s.pendingConfirm)
  const error = useChatStore((s) => s.error)
  const approveRun = useChatStore((s) => s.approveRun)
  const rejectRun = useChatStore((s) => s.rejectRun)
  const bottomRef = useRef<HTMLDivElement>(null)

  useEffect(() => {
    bottomRef.current?.scrollIntoView({ behavior: 'smooth' })
  }, [messages.length, streamingText, pendingConfirm, error])

  return (
    <div className="flex-1 overflow-y-auto p-3 flex flex-col gap-3">
      {messages.map((m, i) => <MessageBubble key={i} message={m} />)}

      {isStreaming && streamingText && (
        <div className="flex justify-start">
          <div className="max-w-[88%] rounded-lg px-3 py-2 text-ui bg-app-elevated text-app-text whitespace-pre-wrap">
            {streamingText}
          </div>
        </div>
      )}

      {pendingConfirm && (
        <RunConfirmCard
          sql={pendingConfirm.sql}
          bytesProcessed={pendingConfirm.bytesProcessed}
          onApprove={approveRun}
          onReject={rejectRun}
        />
      )}

      {error && (
        <div className="px-3 py-2 bg-app-err-subtle text-app-err rounded-md text-ui">{error}</div>
      )}

      <div ref={bottomRef} />
    </div>
  )
}
```

- [ ] **Step 2: Write ChatComposer**

Create `src/renderer/src/components/chat/ChatComposer.tsx`:

```tsx
import { useState } from 'react'
import { SendHorizontal } from 'lucide-react'

interface Props {
  disabled?: boolean
  onSend: (text: string) => void
}

export default function ChatComposer({ disabled, onSend }: Props) {
  const [text, setText] = useState('')

  const submit = () => {
    const t = text.trim()
    if (!t || disabled) return
    onSend(t)
    setText('')
  }

  return (
    <div className="border-t border-app-border p-2 flex items-end gap-2">
      <textarea
        value={text}
        onChange={(e) => setText(e.target.value)}
        onKeyDown={(e) => {
          if (e.key === 'Enter' && !e.shiftKey) { e.preventDefault(); submit() }
        }}
        rows={2}
        placeholder="Ask about your data…"
        className="flex-1 resize-none bg-app-surface border border-app-border rounded-md px-2 py-1.5 text-ui text-app-text focus:outline-none focus:ring-2 focus:ring-app-accent/30"
      />
      <button
        type="button"
        onClick={submit}
        disabled={disabled || !text.trim()}
        aria-label="Send message"
        className="p-2 rounded-md bg-app-accent hover:bg-app-accent-hover disabled:opacity-40 text-white"
      >
        <SendHorizontal size={14} />
      </button>
    </div>
  )
}
```

- [ ] **Step 3: Typecheck**

Run: `npm run typecheck`
Expected: PASS.

- [ ] **Step 4: Commit**

```bash
git add src/renderer/src/components/chat/MessageList.tsx src/renderer/src/components/chat/ChatComposer.tsx
git commit -m "feat(ai): MessageList + ChatComposer components"
```

---

### Task 17: ThreadRail

**Files:**
- Create: `src/renderer/src/components/chat/ThreadRail.tsx`

- [ ] **Step 1: Write ThreadRail**

Create `src/renderer/src/components/chat/ThreadRail.tsx`:

```tsx
import { useState } from 'react'
import { Plus, MessageSquare, Trash2 } from 'lucide-react'
import { useChatStore } from '../../store/chatStore'
import { useConnectionStore } from '../../store/connectionStore'

export default function ThreadRail() {
  const threads = useChatStore((s) => s.threads)
  const activeThreadId = useChatStore((s) => s.activeThreadId)
  const newThread = useChatStore((s) => s.newThread)
  const selectThread = useChatStore((s) => s.selectThread)
  const deleteThread = useChatStore((s) => s.deleteThread)
  const activeConnectionId = useConnectionStore((s) => s.activeConnectionId)
  const [confirmId, setConfirmId] = useState<string | null>(null)

  return (
    <div className="w-[120px] bg-app-sidebar border-l border-app-border flex flex-col shrink-0">
      <button
        type="button"
        onClick={() => activeConnectionId && newThread(activeConnectionId)}
        disabled={!activeConnectionId}
        className="flex items-center gap-1.5 m-2 px-2 py-1.5 rounded-md text-ui bg-app-accent hover:bg-app-accent-hover disabled:opacity-40 text-white"
      >
        <Plus size={13} /> New
      </button>
      <div className="flex-1 overflow-y-auto px-1.5 pb-2 flex flex-col gap-1">
        {threads.map((t) => (
          <div key={t.id} className="relative group">
            <button
              type="button"
              onClick={() => selectThread(t.id)}
              className={`w-full text-left px-2 py-1.5 rounded-md text-ui-xs truncate flex items-center gap-1.5 ${
                t.id === activeThreadId
                  ? 'bg-app-accent-sub-2 border-l-2 border-app-accent text-app-text'
                  : 'text-app-text-2 hover:bg-app-elevated'
              }`}
              title={t.title}
            >
              <MessageSquare size={11} className="shrink-0" />
              <span className="truncate">{t.title}</span>
            </button>
            {confirmId === t.id ? (
              <button
                type="button"
                onClick={() => { deleteThread(t.id); setConfirmId(null) }}
                className="absolute top-1 right-1 text-ui-xs px-1 rounded bg-app-err-subtle text-app-err"
              >
                Yes
              </button>
            ) : (
              <button
                type="button"
                onClick={() => setConfirmId(t.id)}
                aria-label={`Delete ${t.title}`}
                className="absolute top-1.5 right-1 opacity-0 group-hover:opacity-100 p-0.5 rounded text-app-text-3 hover:text-app-err"
              >
                <Trash2 size={11} />
              </button>
            )}
          </div>
        ))}
      </div>
    </div>
  )
}
```

> Note: `bg-app-accent-sub-2` is an existing token used by `CatalogTree` for active rows. If typecheck/Tailwind flags it as missing, substitute `bg-app-accent-subtle`.

- [ ] **Step 2: Typecheck**

Run: `npm run typecheck`
Expected: PASS.

- [ ] **Step 3: Commit**

```bash
git add src/renderer/src/components/chat/ThreadRail.tsx
git commit -m "feat(ai): ThreadRail component"
```

---

### Task 18: ChatPanel (assembles the right-docked panel)

**Files:**
- Create: `src/renderer/src/components/chat/ChatPanel.tsx`

- [ ] **Step 1: Write ChatPanel**

Create `src/renderer/src/components/chat/ChatPanel.tsx`:

```tsx
import { useEffect } from 'react'
import { Sparkles, X } from 'lucide-react'
import { useChatStore } from '../../store/chatStore'
import { useConnectionStore } from '../../store/connectionStore'
import MessageList from './MessageList'
import ChatComposer from './ChatComposer'
import ThreadRail from './ThreadRail'

interface Props {
  onClose: () => void
}

export default function ChatPanel({ onClose }: Props) {
  const threads = useChatStore((s) => s.threads)
  const activeThreadId = useChatStore((s) => s.activeThreadId)
  const isStreaming = useChatStore((s) => s.isStreaming)
  const newThread = useChatStore((s) => s.newThread)
  const sendMessage = useChatStore((s) => s.sendMessage)
  const activeConnectionId = useConnectionStore((s) => s.activeConnectionId)

  const activeThread = threads.find((t) => t.id === activeThreadId)

  // Ensure there's an active thread bound to the current connection.
  useEffect(() => {
    if (!activeThreadId && activeConnectionId) newThread(activeConnectionId)
  }, [activeThreadId, activeConnectionId, newThread])

  return (
    <div className="w-[420px] border-l border-app-border flex flex-col bg-app-surface shrink-0">
      <div className="flex items-center justify-between px-3 h-[40px] border-b border-app-border">
        <div className="flex items-center gap-1.5 text-ui font-semibold text-app-accent-text">
          <Sparkles size={14} /> Assistant
        </div>
        <button
          type="button"
          onClick={onClose}
          aria-label="Close assistant"
          className="p-1 rounded text-app-text-3 hover:text-app-text hover:bg-app-elevated"
        >
          <X size={14} />
        </button>
      </div>

      <div className="flex flex-1 overflow-hidden">
        <div className="flex-1 flex flex-col min-w-0">
          {activeThread ? (
            <>
              <MessageList messages={activeThread.messages} />
              <ChatComposer disabled={isStreaming} onSend={sendMessage} />
            </>
          ) : (
            <div className="flex-1 flex items-center justify-center text-ui text-app-text-3 px-4 text-center">
              {activeConnectionId ? 'Starting a new chat…' : 'Connect to a database to start chatting.'}
            </div>
          )}
        </div>
        <ThreadRail />
      </div>
    </div>
  )
}
```

- [ ] **Step 2: Typecheck**

Run: `npm run typecheck`
Expected: PASS.

- [ ] **Step 3: Commit**

```bash
git add src/renderer/src/components/chat/ChatPanel.tsx
git commit -m "feat(ai): ChatPanel assembly"
```

---

### Task 19: Settings → AI section

**Files:**
- Modify: `src/renderer/src/components/settings/SettingsModal.tsx`

- [ ] **Step 1: Add the AI section type + nav button**

In `SettingsModal.tsx`:

1. Update the imports on line 3 to add `Sparkles`:
```tsx
import { X, Plus, Trash2, Palette, Download, RefreshCw, Check, Sparkles } from 'lucide-react'
```

2. Change the `Section` type (line 12):
```tsx
type Section = 'themes' | 'updates' | 'ai'
```

3. Add a nav button after the Updates nav button (after line 105, before the closing `</div>` of the left nav):
```tsx
          <button onClick={() => setSection('ai')} className={`mt-1 ${navItemClass(section === 'ai')}`}>
            <Sparkles size={13} />
            AI
          </button>
```

4. Add the section render after the updates render (after line 191 `{section === 'updates' && <UpdatesSection onClose={onClose} />}`):
```tsx
          {section === 'ai' && <AiSection onClose={onClose} />}
```

- [ ] **Step 2: Add the AiSection component**

Append this component to `SettingsModal.tsx` (e.g. after `UpdatesSection`):

```tsx
function AiSection({ onClose }: { onClose: () => void }) {
  const [status, setStatus] = useState<{ configured: boolean; maskedHint: string | null; model: string } | null>(null)
  const [keyInput, setKeyInput] = useState('')
  const [model, setModel] = useState('claude-sonnet-4-6')
  const [saved, setSaved] = useState(false)

  useEffect(() => {
    void (async () => {
      const s = await window.api.invoke(CHANNELS.AI_CONFIG_GET, undefined)
      setStatus(s)
      setModel(s.model)
    })()
  }, [])

  const save = async () => {
    const payload: { apiKey?: string; model?: string } = { model }
    if (keyInput.trim()) payload.apiKey = keyInput.trim()
    const s = await window.api.invoke(CHANNELS.AI_CONFIG_SET, payload)
    setStatus(s)
    setKeyInput('')
    setSaved(true)
    setTimeout(() => setSaved(false), 2000)
  }

  return (
    <>
      <div className="flex items-center justify-between px-4 py-3 border-b border-app-border">
        <div id="settings-modal-title-ai" className="text-ui-md font-semibold text-app-text">AI Assistant</div>
        <button type="button" onClick={onClose} aria-label="Close settings"
          className="p-1.5 rounded-md text-app-text-3 hover:text-app-text hover:bg-app-elevated transition-colors">
          <X size={14} />
        </button>
      </div>

      <div className="p-4 overflow-y-auto flex flex-col gap-4">
        <div className="flex flex-col gap-1.5">
          <label className="app-section-label">Anthropic API key</label>
          <input
            type="password"
            value={keyInput}
            onChange={(e) => setKeyInput(e.target.value)}
            placeholder={status?.configured ? `Configured (${status.maskedHint})` : 'sk-ant-…'}
            className="bg-app-surface border border-app-border rounded-md px-2 py-1.5 text-ui text-app-text focus:outline-none focus:ring-2 focus:ring-app-accent/30 font-tabular"
          />
          <p className="text-ui-xs text-app-text-3">Stored locally on this machine. Leave blank to keep the current key.</p>
        </div>

        <div className="flex flex-col gap-1.5">
          <label className="app-section-label">Model</label>
          <select
            value={model}
            onChange={(e) => setModel(e.target.value)}
            className="bg-app-surface border border-app-border rounded-md px-2 py-1.5 text-ui text-app-text focus:outline-none focus:ring-2 focus:ring-app-accent/30"
          >
            <option value="claude-opus-4-8">Claude Opus 4.8 (most capable)</option>
            <option value="claude-sonnet-4-6">Claude Sonnet 4.6 (balanced)</option>
            <option value="claude-haiku-4-5">Claude Haiku 4.5 (fastest)</option>
          </select>
        </div>

        <div className="flex items-center gap-2">
          <button type="button" onClick={save}
            className="px-3 py-1.5 rounded-md text-ui font-medium bg-app-accent hover:bg-app-accent-hover text-white">
            {saved ? 'Saved' : 'Save'}
          </button>
        </div>
      </div>
    </>
  )
}
```

3. Add the IPC import at the top of `SettingsModal.tsx` (after the lucide import):
```tsx
import { CHANNELS } from '@shared/ipc'
```

- [ ] **Step 3: Typecheck**

Run: `npm run typecheck`
Expected: PASS.

- [ ] **Step 4: Commit**

```bash
git add src/renderer/src/components/settings/SettingsModal.tsx
git commit -m "feat(ai): Settings → AI section (key + model)"
```

---

### Task 20: TitleBar toggle + App mount

**Files:**
- Modify: `src/renderer/src/components/layout/TitleBar.tsx`
- Modify: `src/renderer/src/App.tsx`

- [ ] **Step 1: Add a chat-toggle prop + button to TitleBar**

In `src/renderer/src/components/layout/TitleBar.tsx`:

1. Add `Sparkles` to the existing `lucide-react` import.
2. Add `onToggleChat?: () => void` and `chatOpen?: boolean` to the component's props interface.
3. Render a toggle button next to the existing settings/gear button (match the gear button's classes; use terracotta accent when open):

```tsx
        <button
          type="button"
          onClick={onToggleChat}
          aria-label="Toggle AI assistant"
          aria-pressed={chatOpen}
          className={`p-1.5 rounded-md transition-colors ${
            chatOpen ? 'text-app-accent-text bg-app-accent-subtle' : 'text-app-text-3 hover:text-app-text hover:bg-app-elevated'
          }`}
        >
          <Sparkles size={15} />
        </button>
```

> Find the gear/settings button in TitleBar and place this button immediately before or after it, inside the same flex container.

- [ ] **Step 2: Mount ChatPanel in App and load threads**

In `src/renderer/src/App.tsx`:

1. Add imports:
```tsx
import ChatPanel from './components/chat/ChatPanel'
import { useChatStore } from './store/chatStore'
```

2. Add state near the other `useState` calls:
```tsx
  const [chatOpen, setChatOpen] = useState(false)
  const loadThreads = useChatStore((s) => s.loadThreads)
```

3. Add `loadThreads()` to the eager-load `useEffect` (the one that calls `load()`, `loadSavedQueries()`, …) and to its dependency array:
```tsx
    loadThreads()
```
```tsx
  }, [load, loadSavedQueries, loadHistory, loadThemes, loadThreads])
```

4. Pass the toggle props to `TitleBar`:
```tsx
        onToggleChat={() => setChatOpen((v) => !v)}
        chatOpen={chatOpen}
```

5. Mount the panel inside the flex row, after `<main>` (so it docks on the right). Change the inner layout:
```tsx
      <div className="flex flex-1 overflow-hidden">
        <Sidebar onAddConnection={() => setModal({ mode: 'add' })} />
        <main className="flex-1 overflow-hidden">
          {connections.length === 0 ? (
            <EmptyState onAddConnection={() => setModal({ mode: 'add' })} />
          ) : (
            <Editor />
          )}
        </main>
        {chatOpen && <ChatPanel onClose={() => setChatOpen(false)} />}
      </div>
```

- [ ] **Step 3: Typecheck + full suite**

Run: `npm run typecheck && npm test`
Expected: PASS.

- [ ] **Step 4: Commit**

```bash
git add src/renderer/src/components/layout/TitleBar.tsx src/renderer/src/App.tsx
git commit -m "feat(ai): TitleBar chat toggle + mount ChatPanel"
```

---

### Task 21: Manual smoke test

**Files:** none (verification only)

- [ ] **Step 1: Launch the app**

Run: `just dev` (or `npm run dev`)
Expected: app launches without console errors.

- [ ] **Step 2: Configure the key**

Open Settings (gear) → AI → paste an Anthropic API key → pick a model → Save. Reopen the section; the key field should show "Configured (…xxxx)".

- [ ] **Step 3: Exercise the agent**

With a connection active, click the ✨ toggle in the title bar. In a new thread:
- Ask "what tables are here?" → expect tool chips (search/list) then a text answer.
- Ask "draft a query for the first table" → expect a new editor tab to appear.
- Ask "run it" → expect the RunConfirmCard with SQL + est. bytes; Approve → results summarized; Reject → the model acknowledges.
- Create a second thread via "New", switch between them, rename/delete; relaunch the app and confirm threads persisted.

- [ ] **Step 4: Commit (if any fixes were needed)**

```bash
git add -A
git commit -m "fix(ai): smoke-test adjustments"
```
(Skip if nothing changed.)

---

## Phase 5 — Docs

### Task 22: Update README, CHANGELOG, and CLAUDE.md change log

**Files:**
- Modify: `README.md`
- Modify: `CHANGELOG.md`
- Modify: `CLAUDE.md`

- [ ] **Step 1: README — add an "AI assistant" subsection**

Add a section describing: the right-docked assistant, that it brings-your-own Anthropic API key (Settings → AI, stored locally), what it can do (search catalog, draft SQL into tabs, run queries with confirmation), and that it operates on the active connection. Note multiple saved threads.

- [ ] **Step 2: CHANGELOG — add an Unreleased entry**

Under `## [Unreleased]` → `### Added`:
```
- AI chat companion: agentic assistant (Anthropic) that explores the active connection's catalog, drafts SQL into tabs, and runs queries with per-run confirmation. Multiple saved threads. Configure your API key + model in Settings → AI.
```

- [ ] **Step 3: CLAUDE.md — append a change-log entry**

Append a `### [2026-06-19] Feature: AI chat companion` block in the established format (Type/Context/Problem/Solution/Files affected), referencing the spec and this plan, and noting: provider abstraction (Anthropic-only impl), renderer-orchestrated agent loop, run-confirmation gate, capped result sample, threads persisted in `store.ts`, new coverage-gated files (`ipc/ai.ts`, `ipc/chatThreads.ts`, `store/chatStore.ts`), and that autocomplete remains a separate future spec.

- [ ] **Step 4: Verify build + full suite + coverage**

Run: `npm run typecheck && npm run test:coverage`
Expected: PASS, coverage ≥ 70% on all thresholds.

- [ ] **Step 5: Commit**

```bash
git add README.md CHANGELOG.md CLAUDE.md
git commit -m "docs(ai): document AI chat companion"
```

---

## Final verification checklist

- [ ] `npm run typecheck` passes
- [ ] `npm run test:coverage` passes with all thresholds ≥ 70%
- [ ] New coverage-gated files are covered: `src/main/ipc/ai.ts`, `src/main/ipc/chatThreads.ts`, `src/renderer/src/store/chatStore.ts`
- [ ] Manual smoke test (Task 21) completed
- [ ] README, CHANGELOG, CLAUDE.md updated
- [ ] All work committed on the feature branch
