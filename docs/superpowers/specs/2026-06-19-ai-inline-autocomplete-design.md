# AI Inline Autocomplete — Design Spec

**Date:** 2026-06-19
**Status:** Approved (pending implementation plan)
**Scope:** Copilot-style **ghost-text inline completion** for the SQL/Cypher editor. This is the
deferred follow-up to the AI chat companion
(`docs/superpowers/specs/2026-06-19-ai-chat-companion-design.md`).

---

## 1. Summary

Add greyed-out, inline "ghost text" suggestions to the query editor, like GitHub Copilot. As the
user types, a debounced request goes to a fast LLM (Anthropic Haiku) which returns the continuation
at the cursor; the suggestion renders as non-intrusive ghost text and is accepted with **Tab** or
dismissed with **Esc**. It is **opt-in** (off by default), **schema-aware**, and **dialect-aware**
(SQL dialects + Cypher for Neo4j).

This reuses the chat companion's main-process provider abstraction and API key. It is distinct from
the existing deterministic, schema-aware dropdown autocomplete (`sqlSupport`/`cypher`), which stays
exactly as-is — ghost text is an additional layer, not a replacement.

---

## 2. Goals / Non-Goals

### Goals
- Copilot-style ghost text: gray inline suggestion ahead of the cursor; **Tab** accepts, **Esc**
  dismisses.
- **Auto, debounced** trigger (~400ms idle) with caching + cancellation of stale requests.
- **Fast model**, fixed per provider (Anthropic → Haiku 4.5), independent of the chat model.
- **Rich context:** prefix + suffix (fill-in-the-middle) + engine dialect + schemas of referenced
  tables (reusing `extractTableRefs` + the catalog schema cache).
- **Multi-line, capped** (~8 lines) suggestions.
- **Opt-in:** off by default; a Settings → AI toggle + an editor-toolbar quick toggle. Only fires
  when enabled AND an API key is configured.
- **Provider-extensible:** the inline-completion call sits on the `LlmProvider` interface so future
  providers (OpenAI, etc.) implement it with their own fast model.

### Non-Goals (out of scope for v1)
- Word-by-word / partial accept (`⌘→`).
- Cycling between multiple suggestions.
- A separate "autocomplete model" picker in Settings (Anthropic uses Haiku, fixed).
- Telemetry / token-usage metering.
- Replacing or changing the existing dropdown autocomplete.

---

## 3. Architecture

### 3.1 Data flow

```
keystroke → CM inline-completion extension
  → debounce (~400ms idle)
  → gather { prefix, suffix, engine, referenced-table schema }
  → AI_COMPLETE_INLINE (req/res, requestId)        [renderer → main]
       main: getProvider(providerId).completeInline(params, apiKey)
             (Anthropic impl: Haiku, max_tokens ~256, temperature ~0.1, stop seqs)
             → sanitizeCompletion(text)
       → { text, error? }
  → extension: if requestId is the latest, render ghost text (decoration)
  → Tab accepts (insert) · Esc / edit / cursor-move / run clears · stale responses dropped
```

### 3.2 Provider abstraction (extensible)

`LlmProvider` gains a method:

```ts
completeInline(params: InlineCompleteParams, apiKey: string): Promise<{ text: string }>
```

Each provider picks its **own** fast model internally — the call site never hardcodes a model id.
The Anthropic impl uses Haiku 4.5, non-streaming, `max_tokens` ~256, `temperature` ~0.1, and stop
sequences (`;`, blank line). Today there is one provider (`'anthropic'`); when multiple exist the
handler will select by the configured provider id (same registry the chat path uses).

### 3.3 IPC

| Channel | Direction | Purpose |
|---|---|---|
| `AI_COMPLETE_INLINE` | req/res | `{ requestId, prefix, suffix, engine, schema }` → `{ text, error? }`. Non-streaming. |

The handler reads the API key from `aiConfig`. No key → returns `{ text: '' }` (inert). Provider
error → `{ text: '', error }` (never throws across IPC). It runs the result through
`sanitizeCompletion` before returning.

> Note: `requestId` is echoed for client-side correlation/staleness, mirroring the chat stream
> pattern, even though this channel is req/res.

---

## 4. The ghost-text extension (`renderer/src/lib/inlineCompletion.ts`)

One self-contained CodeMirror extension factory:

```ts
inlineCompletion({
  enabled: () => boolean,
  engine: () => ConnectionEngine | undefined,
  getSchema: () => Record<string, string[]>,         // table → columns, from the catalog cache
  requestFn: (req: InlineRequest) => Promise<string> // injected IPC wrapper (testability)
}): Extension
```

Responsibilities:
- **Debounce & trigger:** fire ~400ms after the last *document* change (ignore selection-only
  moves). Skip when disabled, no suggestion is warranted, the doc is empty, or a suggestion is
  already showing.
- **Request lifecycle:** monotonic request id; only the latest response is applied. Typing again
  invalidates in-flight responses.
- **Caching:** small LRU keyed by `prefix` (+ suffix) so dismiss/retype at the same position does
  not re-call the API.
- **Rendering:** suggestion held in a `StateField`, drawn as an atomic ghost-text decoration (gray
  widget) at the cursor. No document mutation until accepted.
- **Keymap (high precedence):** `Tab` accepts (insert full suggestion, clear ghost text); `Esc`
  dismisses; any edit / cursor move / run clears it.
- **Inputs via refs/facets:** reads `enabled`/`engine`/schema through stable accessors so
  `QueryEditor`'s memoized `extensions` array does not rebuild on schema changes.

The IPC call is **injected** (`requestFn`) so the extension and its helpers are unit-testable
without Electron.

---

## 5. Prompt & context assembly

**Split:** the **renderer** gathers context (it owns the catalog schema cache) — the extension
parses referenced tables (`extractTableRefs`) and renders a compact `schema` string from `getSchema`,
then sends the structured `{ prefix, suffix, engine, schema }` request. The **main side** frames the
final prompt (provider-specific) and sanitizes the output.

### 5.1 `main/ai/buildInlinePrompt.ts` (pure, main side)
Builds the prompt from the structured request:
- **Fill-in-the-middle framing:** model receives `prefix` and `suffix` and is instructed to output
  *only* the bridging continuation — no markdown, no restating the prefix, no commentary. System
  instruction: "You are a SQL/Cypher autocomplete. Output only the continuation at the cursor."
- **Dialect + schema:** include the engine dialect (Cypher for Neo4j), and a compact rendering of
  referenced tables' schemas (`extractTableRefs` → schema cache → `name: type` lines), size-capped.
- **Empty/again rules:** mid-identifier → prefix included verbatim so the model continues the token;
  nothing useful to add → instructed to return an empty string (treated as "no suggestion").

### 5.2 `main/ai/sanitizeCompletion.ts` (pure)
Post-processes the model output (main side):
- Strip a leading echo of the prefix if repeated.
- Strip code fences if any slipped through.
- Collapse whitespace-only output to `''`.
- Enforce the multi-line cap (~8 lines).

Provider-side guards: low temperature, `max_tokens` ~256, stop sequences keep output bounded.

---

## 6. Settings, toggle & gating

- **Persistent setting:** `inlineCompletionEnabled: boolean` (default `false`) added to `aiConfig`
  in `store.ts`, surfaced via the existing `AI_CONFIG_GET`/`AI_CONFIG_SET` (extend `AiConfigStatus`
  and `AiConfigSet`).
- **Settings → AI:** a toggle "Inline AI completions (experimental)" with a one-line cost caveat.
- **Quick toggle:** an on/off affordance in the editor toolbar (near Format/Explain) that writes
  through the same config.
- **Shared state:** a tiny `renderer/src/store/aiSettingsStore.ts` (Zustand) holds the live
  `enabled` + `keyConfigured` flags as the single source of truth for both the toggle and the
  editor extension; loaded at boot and updated on save.
- **Gating:** completions fire only when **enabled AND a key is configured**. Enabled-but-no-key →
  the toggle shows a hint pointing at Settings → AI; the extension stays inert (no IPC).
- **Per-editor:** the setting is global; the extension mounts per `QueryEditor` instance (main pane
  and split-right pane), reading the shared `enabled` accessor.

---

## 7. File structure (created / modified)

**Main**
- `src/main/ai/llmProvider.ts` (modify) — add `completeInline` to the interface + `InlineCompleteParams`
- `src/main/ai/anthropicProvider.ts` (modify) — implement `completeInline` (Haiku, non-streaming)
- `src/main/ai/buildInlinePrompt.ts` (create) — pure prompt builder (from structured request)
- `src/main/ai/sanitizeCompletion.ts` (create) — pure post-processor
- `src/main/ipc/ai.ts` (modify) — `AI_COMPLETE_INLINE` handler
- `src/main/db/store.ts` (modify) — `inlineCompletionEnabled` on `aiConfig`

**Shared**
- `src/shared/ipc.ts` (modify) — `AI_COMPLETE_INLINE` channel + `IpcMap` entry
- `src/shared/types.ts` (modify) — `InlineCompleteRequest`/`InlineCompleteResponse`; add
  `inlineCompletionEnabled` to `AiConfigStatus` + `AiConfigSet`

**Renderer**
- `src/renderer/src/lib/inlineCompletion.ts` (create) — the CodeMirror extension (gathers context, renders ghost text)
- `src/renderer/src/store/aiSettingsStore.ts` (create) — `enabled` + `keyConfigured`
- `src/renderer/src/components/editor/QueryEditor.tsx` (modify) — mount extension + toolbar toggle
- `src/renderer/src/pages/Editor.tsx` (modify) — pass engine/schema/enabled
- `src/renderer/src/components/settings/SettingsModal.tsx` (modify) — the toggle

**Docs**
- `README.md`, `CHANGELOG.md`, `CLAUDE.md` change log — updated.

---

## 8. Testing

Honoring the 70% coverage gate (covered set = `src/main/db/**`, `src/main/ipc/**`,
`src/renderer/src/store/**`):

- **Coverage-gated:**
  - `ipc/ai.ts` `AI_COMPLETE_INLINE`: no key → `{ text: '' }`; success → sanitized text; provider
    error → `{ text: '', error }`. (Plus the existing AI handler tests stay green with the new
    `inlineCompletionEnabled` config field.)
  - `aiSettingsStore`: initial load, toggle on/off (writes `AI_CONFIG_SET`), `keyConfigured`
    gating.
- **Pure unit (outside the gate, like other `lib/*`):**
  - `buildInlinePrompt`: FIM framing, schema inclusion, SQL vs Cypher dialect, size cap.
  - `sanitizeCompletion`: prefix-echo strip, code-fence strip, whitespace→empty, line cap.
  - `anthropicProvider.completeInline`: mocked SDK — asserts the Haiku model id, stop sequences,
    `max_tokens`, returns mapped text.
- The CodeMirror extension is exercised via its injected `requestFn` + the prompt/sanitize units;
  full editor wiring is verified manually (consistent with how the codebase treats UI components,
  which are not unit-tested).

All tests must pass before merge; no live network calls in the suite.

---

## 9. Open items for the plan

- Exact debounce interval and multi-line cap (defaults: 400ms, 8 lines) — tunable in the plan.
- The precise trigger predicate (when *not* to suggest — e.g., immediately after accepting, inside a
  string literal) — refined in the plan.
- Toolbar quick-toggle icon/placement (near Format/Explain).
