# AI Chat Companion — Design Spec

**Date:** 2026-06-19
**Status:** Approved (pending implementation plan)
**Scope:** This spec covers the **AI chat companion** only. AI inline autocomplete for the SQL
editor is a deliberately separate, follow-up spec and is **out of scope** here.

---

## 1. Summary

Add an agentic AI chat companion to Aperture. The companion is a conversational assistant,
docked on the right of the window, that can explore the catalog of the **active connection**,
draft SQL into editor tabs, and execute queries **with explicit per-run confirmation**. It reuses
Aperture's existing IPC channels and DB adapters for all data access; the only genuinely new
privileged operation is calling the LLM.

The companion is **Anthropic-only for v1**, built behind a thin provider interface so additional
providers (OpenAI, local/OpenAI-compatible) can be added later without touching the agent loop.

---

## 2. Goals / Non-Goals

### Goals
- Conversational assistant that can answer data questions about the active connection.
- Tool-driven catalog discovery (search tables, list datasets, read schema) that scales to large
  catalogs.
- Draft SQL into real editor tabs (`open_query_tab`).
- Execute queries to answer questions, **gated by a human confirmation** showing SQL + estimated
  bytes before any spend.
- Multiple saved, browsable chat threads (ChatGPT-style), persisted across restarts.
- Streaming responses.

### Non-Goals (explicitly out of scope)
- **AI inline autocomplete** — separate follow-up spec.
- **Providers beyond Anthropic** — the provider *interface* is built; only the Anthropic impl ships.
- **Cross-connection actions** — the agent always operates on the currently active connection; it
  cannot switch databases on its own.
- **Auto-running queries without confirmation** — every `run_query` requires explicit approval.
- **OS-keychain storage** — the API key is stored like other credentials for v1; keychain
  (Electron `safeStorage`) is noted as future hardening.

---

## 3. Architecture

### 3.1 Process split

Aperture's rule holds: the **renderer owns UI/state**, the **main process owns privileged ops**.
The only new privileged op is "call the LLM," so:

- **Main process** owns the Anthropic client and the API key (consistent with how it owns
  connection credentials in `store.ts`).
- **Renderer** orchestrates the agent loop, dispatches tools, and renders the chat UI.

### 3.2 New IPC channels

| Channel | Direction | Purpose |
|---|---|---|
| `AI_CHAT_COMPLETE` | req/res | One LLM turn: send messages + tool schemas → returns the assistant message (text + any `tool_use` blocks). |
| `AI_CHAT_STREAM` | push (main → renderer) | Token streaming during a completion, keyed by a request id. Mirrors the existing `QUERY_LOG` push pattern. |
| `CHAT_THREADS_LIST` | req/res | List persisted threads. |
| `CHAT_THREADS_SAVE` | req/res | Upsert a thread. |
| `CHAT_THREADS_DELETE` | req/res | Delete a thread by id. |
| `AI_CONFIG_GET` / `AI_CONFIG_SET` | req/res | Read/write API key + selected model. (Key is never returned to the renderer in plaintext beyond a "configured" boolean + masked hint — see §6.) |

All new req/res channels are added to `CHANNELS`, `IpcMap`, and validated in their handlers per
the existing IPC conventions.

### 3.3 The agent loop (renderer-orchestrated)

```
chatStore.send(userText):
  append user message
  loop:
    1. AI_CHAT_COMPLETE(messages, toolSchemas)
         → main calls Anthropic (streaming text via AI_CHAT_STREAM)
         → returns assistant message (text + optional tool_use blocks)
    2. append assistant message
    3. if no tool_use blocks: done (final answer)
    4. for each tool_use:
         • data tools → existing IPC channels
         • UI tools   → run natively in renderer
         → collect tool_result blocks
    5. append tool_result message; continue loop
```

Reusing existing channels means the agent inherits adapter behavior, error handling, and the
multi-engine registry for free.

### 3.4 Provider abstraction

- `src/main/ai/llmProvider.ts` — `LlmProvider` interface (e.g. `complete(messages, tools, onToken)`)
  plus a small registry keyed by provider id.
- `src/main/ai/anthropicProvider.ts` — the Anthropic implementation: maps Aperture tool definitions
  to Anthropic tool-use schemas, streams tokens, returns the final message. Defaults to the latest
  Claude models.

Adding a future provider = a new impl file + registry entry; the loop and tools are untouched.

---

## 4. Tools

All tools are scoped to the **active connection**. Tool definitions live in
`src/renderer/src/ai/tools.ts` as pure data, with a `runTool(name, input)` dispatcher.

| Tool | Backed by | Behavior |
|---|---|---|
| `list_datasets` | `CATALOG_DATASETS` | Orient in the catalog. |
| `search_tables` | `CATALOG_SEARCH_TABLES` | Substring lookup across the project. |
| `get_table_schema` | `CATALOG_TABLE_SCHEMA` | Columns/types for a table. |
| `open_query_tab` | `queryStore.openTab` (renderer-native) | Draft SQL into a new editor tab. Returns the tab title/id. |
| `dry_run_query` | `QUERY_DRY_RUN` | Estimated bytes / validity; no spend. |
| `run_query` | `QUERY_EXECUTE` | **Gated by confirmation** (see §5). |

### 4.1 Result feedback (`run_query`)

On approval, the tool_result returned to the model is a **capped sample**: column names + the first
**50** rows + the total row count. This bounds token cost while letting the model read actual values
to answer questions. (Capping is a pure helper, unit-tested.)

---

## 5. Confirmation UX

When the model emits a `run_query` tool call, the renderer does **not** execute immediately:

1. The renderer first performs an automatic `dry_run_query` to estimate bytes.
2. It renders an inline **confirmation card** (`RunConfirmCard`) inside the chat conversation
   showing the SQL and estimated bytes, with **Approve / Reject**.
3. **Approve** → `QUERY_EXECUTE`; the capped result sample (§4.1) becomes the tool_result.
4. **Reject** → a tool_result stating the user declined, so the model can revise its approach.

This is an explicit human gate (conceptually related to the existing `detectMissingLimit` guard but
enforced as a confirmation, not a banner).

---

## 6. Threads & persistence

New `chatThreads` array on `StoreData` in `src/main/db/store.ts`, managed via the
`CHAT_THREADS_*` IPC channels.

```ts
interface ChatThread {
  id: string
  title: string            // auto-derived from first user message; renameable
  connectionId: string     // the connection this thread explored
  messages: ChatMessage[]  // role + content blocks (text / tool_use / tool_result)
  createdAt: string
  updatedAt: string
}

interface ChatMessage {
  role: 'user' | 'assistant'
  content: ChatContentBlock[]   // text | tool_use | tool_result blocks
}
```

- The **thread rail** (layout C) lists threads with **+ new**, **rename**, **delete**.
- A new thread **binds to the current active connection**. Default rail behavior: show all threads;
  selecting/creating a thread sets context to its connection. (Exact filtering nuance to be pinned
  down in the plan — default is "show all.")

### 6.1 API key & model config

- Stored in `store.ts` alongside other credentials (Postgres/Snowflake passwords are already stored
  there in plaintext). Entered via a new **Settings → AI** section.
- `AI_CONFIG_GET` returns a `{ configured: boolean, maskedHint?: string, model: string }` shape
  rather than the raw key; the raw key never leaves the main process except in the Anthropic call.
- **Future hardening (out of scope):** migrate the key to Electron `safeStorage` (built-in, no new
  dependency).

---

## 7. UI / Layout

**Layout: right-docked panel with its own thread rail (mockup option C).**

New renderer components under `src/renderer/src/components/chat/`:

- `ChatPanel.tsx` — the right-docked, resizable panel (reuses the existing divider-drag pattern).
  Holds the thread rail + conversation. Collapsible.
- `ThreadRail.tsx` — thread list; +new / rename / delete.
- `MessageList.tsx` + `MessageBubble.tsx` — streams assistant text; renders tool activity inline
  (e.g. "🔍 searched tables", "📄 opened tab ✓").
- `RunConfirmCard.tsx` — the SQL + estimated-bytes Approve/Reject gate.
- `ChatComposer.tsx` — input + send/stop.

Other UI:

- **Settings → AI** section added to the existing `SettingsModal` (API key + model picker), following
  the established two-section modal pattern.
- A **toggle in `TitleBar`** to show/hide the chat panel, terracotta-accented to match the existing
  gear / update-dot conventions.

State lives in a new `src/renderer/src/store/chatStore.ts` (threads, active thread, messages, the
agent loop, tool dispatch, streaming accumulation, confirmation state).

---

## 8. Testing

Honoring the 70% coverage gate (covered set = stores + IPC handlers + `main/db`):

- **`chatStore`** — thread CRUD; the agent loop (mock `AI_CHAT_COMPLETE`: `tool_use` → dispatch →
  `tool_result` → final answer); confirmation approve/reject paths; streaming accumulation from
  `AI_CHAT_STREAM`.
- **`ai.ts` IPC handler + `anthropicProvider`** — request shaping, tool-schema mapping, stream push,
  error handling (mock the Anthropic SDK; no live calls).
- **`tools.ts`** — pure `runTool` dispatch + input validation.
- **Pure helpers** — tool-schema builders and the result-capping function live in `lib/`-style
  modules and are unit-tested like the existing parsers (`detectMissingLimit`, `buildCypherQuery`,
  etc.).

All tests must pass before merge; no live network calls in the suite.

---

## 9. New / changed files (anticipated)

**Main process**
- `src/main/ai/llmProvider.ts` — provider interface + registry (new)
- `src/main/ai/anthropicProvider.ts` — Anthropic impl (new)
- `src/main/ipc/ai.ts` — `AI_CHAT_COMPLETE` + `AI_CHAT_STREAM` + `AI_CONFIG_*` handlers (new)
- `src/main/ipc/chatThreads.ts` — `CHAT_THREADS_*` handlers (new)
- `src/main/ipc/index.ts` — register new handlers
- `src/main/db/store.ts` — `chatThreads` + AI config on `StoreData`

**Shared**
- `src/shared/ipc.ts` — new channels + `IpcMap` entries
- `src/shared/types.ts` — `ChatThread`, `ChatMessage`, `ChatContentBlock`, AI config types

**Renderer**
- `src/renderer/src/store/chatStore.ts` (new)
- `src/renderer/src/ai/tools.ts` (new)
- `src/renderer/src/components/chat/{ChatPanel,ThreadRail,MessageList,MessageBubble,RunConfirmCard,ChatComposer}.tsx` (new)
- `src/renderer/src/components/settings/SettingsModal.tsx` — AI section
- `src/renderer/src/components/layout/TitleBar.tsx` — chat toggle
- Pure helper module(s) for tool-schema building + result capping (new)

**Docs**
- `README.md`, `CHANGELOG.md`, and the `CLAUDE.md` change log — updated per project rules.

---

## 10. Open items for the plan

- Exact thread-rail filtering on connection switch (default: show all).
- Precise streaming/request-id protocol for `AI_CHAT_STREAM` (cancellation/stop button).
- System prompt content (how the active connection/engine is described to the model).
- Model picker option list and default.
