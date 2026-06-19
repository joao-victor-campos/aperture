# AI Inline Autocomplete Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Add Copilot-style ghost-text inline completion to the SQL/Cypher editor — debounced, schema-aware suggestions from a fast model (Anthropic Haiku), accepted with Tab, opt-in.

**Architecture:** A new `AI_COMPLETE_INLINE` req/res IPC channel backed by a `completeInline` method on the existing `LlmProvider` interface (Anthropic uses Haiku internally — provider-extensible). The renderer gathers context (prefix/suffix/engine/referenced-table schema) in a self-contained CodeMirror extension that renders ghost text, debounces, caches, cancels stale requests, and binds Tab/Esc. Main frames the prompt (`buildInlinePrompt`) and sanitizes output (`sanitizeCompletion`). Opt-in via `aiConfig.inlineCompletionEnabled`, surfaced through a tiny `aiSettingsStore`.

**Tech Stack:** Electron + TypeScript, React, CodeMirror 6 (`@codemirror/state`, `@codemirror/view`), Zustand, `@anthropic-ai/sdk`, Vitest.

**Reference spec:** `docs/superpowers/specs/2026-06-19-ai-inline-autocomplete-design.md`

---

## Conventions & ground rules (read once)

- **Coverage gate (70%)** measures only `src/main/db/**`, `src/main/ipc/**`, `src/renderer/src/store/**`. The **coverage-gated** new/changed files here are `src/main/ipc/ai.ts` (already covered — extend its tests) and `src/renderer/src/store/aiSettingsStore.ts` (new — must be tested). New files under `src/main/ai/**` and `src/renderer/src/lib/**` sit OUTSIDE the include set but are still unit-tested where they're pure logic.
- **Components / CodeMirror extensions are not unit-tested in this codebase** (no React Testing Library; jsdom lacks layout). The extension task ends in typecheck; behavior is verified in the manual smoke test.
- Full suite: `npm test`. Typecheck: `npm run typecheck`. Build: `npm run build`.
- **Commit after every task.** Already on a feature branch — never commit to `master`.
- This feature is **additive** to the existing deterministic dropdown autocomplete (`sqlSupport`/`cypher`); do not change that.

---

## File structure (created / modified)

**Shared**
- `src/shared/types.ts` (modify) — `InlineCompleteRequest`, `InlineCompleteResponse`; add `inlineCompletionEnabled` to `AiConfigStatus` + `AiConfigSet`
- `src/shared/ipc.ts` (modify) — `AI_COMPLETE_INLINE` channel + `IpcMap` entry

**Main**
- `src/main/db/store.ts` (modify) — `inlineCompletionEnabled` on `aiConfig`
- `src/main/ai/llmProvider.ts` (modify) — `completeInline` + `InlineCompleteParams`
- `src/main/ai/anthropicProvider.ts` (modify) — implement `completeInline` (Haiku)
- `src/main/ai/buildInlinePrompt.ts` (create) — pure prompt builder
- `src/main/ai/sanitizeCompletion.ts` (create) — pure output sanitizer
- `src/main/ipc/ai.ts` (modify) — `inlineCompletionEnabled` in config + `AI_COMPLETE_INLINE` handler

**Renderer**
- `src/renderer/src/lib/inlineSchemaContext.ts` (create) — pure schema-context builder
- `src/renderer/src/lib/inlineCompletion.ts` (create) — the CodeMirror ghost-text extension
- `src/renderer/src/store/aiSettingsStore.ts` (create) — `enabled` + `keyConfigured`
- `src/renderer/src/components/editor/QueryEditor.tsx` (modify) — mount extension + toolbar toggle
- `src/renderer/src/components/settings/SettingsModal.tsx` (modify) — the toggle
- `src/renderer/src/App.tsx` (modify) — boot-load `aiSettingsStore`

**Docs**
- `README.md`, `CHANGELOG.md`, `CLAUDE.md` change log

---

## Task 1: Shared contracts — inline types + IPC channel

**Files:**
- Modify: `src/shared/types.ts`
- Modify: `src/shared/ipc.ts`

- [ ] **Step 1: Add the inline types**

Append to the end of `src/shared/types.ts`:

```ts
// ── AI inline autocomplete ──────────────────────────────────────────────────

export interface InlineCompleteRequest {
  /** Echoed back for client-side staleness correlation. */
  requestId: string
  /** Text before the cursor. */
  prefix: string
  /** Text after the cursor. */
  suffix: string
  engine: ConnectionEngine
  /** Compact schema context (referenced tables' columns); may be empty. */
  schema: string
}

export interface InlineCompleteResponse {
  /** The text to insert at the cursor. Empty string = no suggestion. */
  text: string
  /** Set when the call failed; text is '' then. */
  error?: string
}
```

- [ ] **Step 2: Add the channel + IpcMap entry**

In `src/shared/ipc.ts`, extend the type import on line 1 to add the two new types (insert before `} from './types'`):

```ts
, InlineCompleteRequest, InlineCompleteResponse
```

Add to the `CHANNELS` object, after the `AI_CHAT_STREAM` line:

```ts
  AI_COMPLETE_INLINE: 'ai:complete-inline',
```

Add to the `IpcMap` interface (with the other AI entries):

```ts
  [CHANNELS.AI_COMPLETE_INLINE]: { req: InlineCompleteRequest; res: InlineCompleteResponse }
```

- [ ] **Step 3: Typecheck**

Run: `npm run typecheck`
Expected: PASS.

- [ ] **Step 4: Commit**

```bash
git add src/shared/types.ts src/shared/ipc.ts
git commit -m "feat(ai): inline-completion shared types + IPC channel"
```

---

## Task 2: Config field — `inlineCompletionEnabled`

**Files:**
- Modify: `src/shared/types.ts`
- Modify: `src/main/db/store.ts`
- Modify: `src/main/ipc/ai.ts`
- Modify: `src/__tests__/main/ipc/ai.test.ts`

> Adding a required field to `AiConfigStatus` forces `statusOf` + the existing tests to update in lockstep, so this is one atomic task.

- [ ] **Step 1: Update existing tests to expect the new field (write the failing test first)**

In `src/__tests__/main/ipc/ai.test.ts`, first widen the mock store type so the new field is accessible. Find:
```ts
type Store = { aiConfig: { apiKey: string | null; model: string } }
```
Replace with:
```ts
type Store = { aiConfig: { apiKey: string | null; model: string; inlineCompletionEnabled?: boolean } }
```

Then update the three `toEqual` expectations to include `inlineCompletionEnabled: false`:

- In `'reports unconfigured when no key'`:
```ts
    expect(res).toEqual({ configured: false, maskedHint: null, model: 'claude-sonnet-4-6', inlineCompletionEnabled: false })
```
- In `'masks the key when configured'`:
```ts
    expect(res).toEqual({ configured: true, maskedHint: '…a1b2', model: 'claude-opus-4-8', inlineCompletionEnabled: false })
```
- In `'updates key + model and returns masked status'`:
```ts
    expect(res).toEqual({ configured: true, maskedHint: '…xyz9', model: 'claude-haiku-4-5', inlineCompletionEnabled: false })
```

Then add a new test in the `AI_CONFIG_SET` describe block:

```ts
  it('persists inlineCompletionEnabled when provided', async () => {
    storeData.aiConfig = { apiKey: 'sk-1234', model: 'claude-sonnet-4-6' }
    const res = await handlers.get(CHANNELS.AI_CONFIG_SET)!({}, { inlineCompletionEnabled: true })
    expect(storeData.aiConfig.inlineCompletionEnabled).toBe(true)
    expect((res as { inlineCompletionEnabled: boolean }).inlineCompletionEnabled).toBe(true)
  })
```

- [ ] **Step 2: Run to verify it fails**

Run: `npm test -- ipc/ai`
Expected: FAIL (statusOf doesn't return `inlineCompletionEnabled`).

- [ ] **Step 3: Add the field to the shared type**

In `src/shared/types.ts`, find `AiConfigStatus` and `AiConfigSet` and add the field:

```ts
// AiConfigStatus — add:
  inlineCompletionEnabled: boolean
```
```ts
// AiConfigSet — add:
  inlineCompletionEnabled?: boolean
```

- [ ] **Step 4: Add the field to the store**

In `src/main/db/store.ts`:
- In `interface StoreData`, change the `aiConfig` field to:
```ts
  aiConfig: { apiKey: string | null; model: string; inlineCompletionEnabled: boolean }
```
- In `DEFAULTS`, change the `aiConfig` default to:
```ts
  aiConfig: { apiKey: null, model: 'claude-sonnet-4-6', inlineCompletionEnabled: false },
```

- [ ] **Step 5: Update `statusOf` + `AI_CONFIG_SET` in the handler**

In `src/main/ipc/ai.ts`:
- Replace `statusOf` with:
```ts
function statusOf(cfg: { apiKey: string | null; model: string; inlineCompletionEnabled?: boolean }): AiConfigStatus {
  return {
    configured: !!cfg.apiKey,
    maskedHint: cfg.apiKey ? `…${cfg.apiKey.slice(-4)}` : null,
    model: cfg.model,
    inlineCompletionEnabled: !!cfg.inlineCompletionEnabled,
  }
}
```
- In the `AI_CONFIG_SET` handler, replace the `next` object with:
```ts
    const next = {
      apiKey: req.apiKey !== undefined ? req.apiKey : cfg.apiKey,
      model: req.model !== undefined ? req.model : cfg.model,
      inlineCompletionEnabled:
        req.inlineCompletionEnabled !== undefined
          ? req.inlineCompletionEnabled
          : (cfg.inlineCompletionEnabled ?? false),
    }
```

- [ ] **Step 6: Run tests + typecheck**

Run: `npm test -- ipc/ai && npm run typecheck`
Expected: PASS (all `ipc/ai` tests including the new one).

- [ ] **Step 7: Commit**

```bash
git add src/shared/types.ts src/main/db/store.ts src/main/ipc/ai.ts src/__tests__/main/ipc/ai.test.ts
git commit -m "feat(ai): inlineCompletionEnabled config flag"
```

---

## Task 3: Provider `completeInline` (interface + Anthropic impl)

**Files:**
- Modify: `src/main/ai/llmProvider.ts`
- Modify: `src/main/ai/anthropicProvider.ts`
- Modify: `src/__tests__/main/ai/anthropicProvider.test.ts`

> Adding `completeInline` to the interface makes it required, so the Anthropic impl must land in the same task.

- [ ] **Step 1: Write the failing test**

In `src/__tests__/main/ai/anthropicProvider.test.ts`, update the SDK mock to add a `create` fn alongside `stream`, and add a `completeInline` test.

Replace the mock block at the top:

```ts
const onText = vi.fn()
const finalMessage = vi.fn()
const streamFn = vi.fn(() => ({
  on: (evt: string, cb: (d: string) => void) => { if (evt === 'text') onText.mockImplementation(cb) },
  finalMessage,
}))
const createFn = vi.fn()

vi.mock('@anthropic-ai/sdk', () => ({
  default: class {
    messages = { stream: streamFn, create: createFn }
    constructor(_opts: unknown) {}
  },
}))
```

Add `createFn.mockReset()` to the existing `beforeEach`. Then add this describe block:

```ts
describe('anthropicProvider.completeInline', () => {
  it('calls Haiku with stop sequences and returns the concatenated text', async () => {
    createFn.mockResolvedValue({ content: [{ type: 'text', text: 'WHERE id = 1' }] })

    const res = await anthropicProvider.completeInline(
      { system: 'autocomplete', prompt: 'SELECT * FROM t <CURSOR>' },
      'sk-test'
    )

    expect(createFn).toHaveBeenCalledOnce()
    const arg = createFn.mock.calls[0][0] as Record<string, unknown>
    expect(arg.model).toBe('claude-haiku-4-5')
    expect(arg.max_tokens).toBe(256)
    expect(arg.stop_sequences).toEqual([';', '\n\n'])
    expect(res.text).toBe('WHERE id = 1')
  })
})
```

- [ ] **Step 2: Run to verify it fails**

Run: `npm test -- anthropicProvider`
Expected: FAIL (`completeInline` is not a function).

- [ ] **Step 3: Add the interface method**

In `src/main/ai/llmProvider.ts`, add the params type after `LlmCompleteResult`:

```ts
export interface InlineCompleteParams {
  system: string
  /** The full user prompt (fill-in-the-middle framing). */
  prompt: string
}
```

Add to the `LlmProvider` interface (after the `complete` method):

```ts
  /**
   * Single-shot, low-latency completion for inline ghost text. Non-streaming.
   * The provider chooses its own fast model internally.
   */
  completeInline(params: InlineCompleteParams, apiKey: string): Promise<{ text: string }>
```

- [ ] **Step 4: Implement it in the Anthropic provider**

In `src/main/ai/anthropicProvider.ts`:
- Add a constant near the top (after imports):
```ts
/** Fast model used for inline ghost-text completion. */
const INLINE_MODEL = 'claude-haiku-4-5'
```
- Add the method to the `anthropicProvider` object (after `complete`):
```ts
  async completeInline(params, apiKey) {
    const client = new Anthropic({ apiKey })
    const res = await client.messages.create({
      model: INLINE_MODEL,
      max_tokens: 256,
      temperature: 0.1,
      system: params.system,
      messages: [{ role: 'user', content: params.prompt }],
      stop_sequences: [';', '\n\n'],
    })
    const text = (res.content as unknown[])
      .map((b) => {
        const block = b as { type: string; text?: string }
        return block.type === 'text' ? (block.text ?? '') : ''
      })
      .join('')
    return { text }
  },
```

- [ ] **Step 5: Run to verify it passes**

Run: `npm test -- anthropicProvider && npm run typecheck`
Expected: PASS.

- [ ] **Step 6: Commit**

```bash
git add src/main/ai/llmProvider.ts src/main/ai/anthropicProvider.ts src/__tests__/main/ai/anthropicProvider.test.ts
git commit -m "feat(ai): provider completeInline (Haiku)"
```

---

## Task 4: `buildInlinePrompt` (pure)

**Files:**
- Create: `src/main/ai/buildInlinePrompt.ts`
- Test: `src/__tests__/main/ai/buildInlinePrompt.test.ts`

- [ ] **Step 1: Write the failing test**

Create `src/__tests__/main/ai/buildInlinePrompt.test.ts`:

```ts
import { describe, it, expect } from 'vitest'
import { buildInlinePrompt } from '../../../main/ai/buildInlinePrompt'

describe('buildInlinePrompt', () => {
  it('frames fill-in-the-middle with a cursor marker', () => {
    const { user } = buildInlinePrompt({ prefix: 'SELECT * FROM ', suffix: ' WHERE 1', engine: 'bigquery', schema: '' })
    expect(user).toContain('SELECT * FROM <CURSOR> WHERE 1')
  })

  it('names the SQL dialect and includes schema when present', () => {
    const { system, user } = buildInlinePrompt({
      prefix: 'SELECT ', suffix: '', engine: 'postgres', schema: 'orders(id, total)',
    })
    expect(system.toLowerCase()).toContain('autocomplete')
    expect(user).toContain('postgres SQL')
    expect(user).toContain('orders(id, total)')
  })

  it('uses Cypher for neo4j', () => {
    const { user } = buildInlinePrompt({ prefix: 'MATCH ', suffix: '', engine: 'neo4j', schema: '' })
    expect(user).toContain('Cypher')
  })

  it('omits the schema section when schema is empty', () => {
    const { user } = buildInlinePrompt({ prefix: 'SELECT 1', suffix: '', engine: 'bigquery', schema: '' })
    expect(user).not.toContain('Schema:')
  })
})
```

- [ ] **Step 2: Run to verify it fails**

Run: `npm test -- buildInlinePrompt`
Expected: FAIL (module not found).

- [ ] **Step 3: Implement**

Create `src/main/ai/buildInlinePrompt.ts`:

```ts
import type { ConnectionEngine, InlineCompleteRequest } from '../../shared/types'

const SYSTEM =
  'You are a SQL/Cypher autocomplete inside a code editor. Output ONLY the text that should be ' +
  'inserted at the <CURSOR> to continue the query — no explanations, no markdown, no code fences, ' +
  'and do not repeat the text before the cursor. If nothing should be added, output nothing.'

function dialect(engine: ConnectionEngine): string {
  return engine === 'neo4j' ? 'Cypher' : `${engine} SQL`
}

/** Build the system + user prompt for an inline completion request. */
export function buildInlinePrompt(
  req: Pick<InlineCompleteRequest, 'prefix' | 'suffix' | 'engine' | 'schema'>
): { system: string; user: string } {
  const parts = [
    `Language: ${dialect(req.engine)}.`,
    req.schema ? `Schema:\n${req.schema}` : '',
    'Complete the query at the <CURSOR> marker. Return only the text to insert.',
    '',
    `${req.prefix}<CURSOR>${req.suffix}`,
  ].filter(Boolean)
  return { system: SYSTEM, user: parts.join('\n') }
}
```

- [ ] **Step 4: Run to verify it passes**

Run: `npm test -- buildInlinePrompt`
Expected: PASS (4 tests).

- [ ] **Step 5: Commit**

```bash
git add src/main/ai/buildInlinePrompt.ts src/__tests__/main/ai/buildInlinePrompt.test.ts
git commit -m "feat(ai): inline prompt builder"
```

---

## Task 5: `sanitizeCompletion` (pure)

**Files:**
- Create: `src/main/ai/sanitizeCompletion.ts`
- Test: `src/__tests__/main/ai/sanitizeCompletion.test.ts`

- [ ] **Step 1: Write the failing test**

Create `src/__tests__/main/ai/sanitizeCompletion.test.ts`:

```ts
import { describe, it, expect } from 'vitest'
import { sanitizeCompletion } from '../../../main/ai/sanitizeCompletion'

describe('sanitizeCompletion', () => {
  it('returns the text unchanged when clean', () => {
    expect(sanitizeCompletion('WHERE id = 1', 'SELECT * FROM t ')).toBe('WHERE id = 1')
  })

  it('strips code fences', () => {
    expect(sanitizeCompletion('```sql\nWHERE id = 1\n```', 'SELECT * FROM t ')).toBe('WHERE id = 1')
  })

  it('strips a leading echo of the prefix last line', () => {
    expect(sanitizeCompletion('SELECT id FROM t', 'SELECT ')).toBe('id FROM t')
  })

  it('collapses whitespace-only output to empty', () => {
    expect(sanitizeCompletion('   \n  ', 'SELECT 1')).toBe('')
  })

  it('caps the number of lines', () => {
    const long = Array.from({ length: 20 }, (_, i) => `line${i}`).join('\n')
    expect(sanitizeCompletion(long, '', 3).split('\n')).toHaveLength(3)
  })

  it('returns empty for empty input', () => {
    expect(sanitizeCompletion('', 'SELECT 1')).toBe('')
  })
})
```

- [ ] **Step 2: Run to verify it fails**

Run: `npm test -- sanitizeCompletion`
Expected: FAIL (module not found).

- [ ] **Step 3: Implement**

Create `src/main/ai/sanitizeCompletion.ts`:

```ts
/**
 * Clean a raw model completion for inline insertion:
 * strip code fences, strip a leading echo of the prefix's last line,
 * cap the line count, and collapse whitespace-only output to ''.
 */
export function sanitizeCompletion(text: string, prefix: string, maxLines = 8): string {
  if (!text) return ''

  // Strip code fences (```sql ... ```).
  let out = text.replace(/```[\w]*\n?/g, '').replace(/```/g, '')

  // Strip a leading echo of the prefix's last line, if the model repeated it.
  const lastLine = prefix.split('\n').pop() ?? ''
  if (lastLine.trim() && out.startsWith(lastLine)) {
    out = out.slice(lastLine.length)
  }

  // Cap lines.
  const lines = out.split('\n')
  if (lines.length > maxLines) out = lines.slice(0, maxLines).join('\n')

  if (out.trim() === '') return ''
  return out
}
```

- [ ] **Step 4: Run to verify it passes**

Run: `npm test -- sanitizeCompletion`
Expected: PASS (6 tests).

- [ ] **Step 5: Commit**

```bash
git add src/main/ai/sanitizeCompletion.ts src/__tests__/main/ai/sanitizeCompletion.test.ts
git commit -m "feat(ai): inline completion sanitizer"
```

---

## Task 6: `AI_COMPLETE_INLINE` handler (coverage-gated)

**Files:**
- Modify: `src/main/ipc/ai.ts`
- Modify: `src/__tests__/main/ipc/ai.test.ts`

- [ ] **Step 1: Write the failing test**

In `src/__tests__/main/ipc/ai.test.ts`, add a mock for the provider's `completeInline` and a describe block.

First, update the `getProvider` mock so the returned provider also has `completeInline`. Find:
```ts
const complete = vi.fn()
vi.mock('../../../main/ai/llmProvider', () => ({
  getProvider: () => ({ complete }),
}))
```
Replace with:
```ts
const complete = vi.fn()
const completeInline = vi.fn()
vi.mock('../../../main/ai/llmProvider', () => ({
  getProvider: () => ({ complete, completeInline }),
}))
```
Add `completeInline.mockReset()` to the `beforeEach`.

Add a `type` import at the top of the test:
```ts
import type { AiCompleteRequest, InlineCompleteRequest } from '../../../shared/types'
```
(extend the existing `import type { AiCompleteRequest }` line).

Add this describe block:

```ts
describe('AI_COMPLETE_INLINE', () => {
  function inlineReq(): InlineCompleteRequest {
    return { requestId: 'r1', prefix: 'SELECT * FROM t ', suffix: '', engine: 'bigquery', schema: '' }
  }

  it('returns empty text when no API key is set', async () => {
    const res = await handlers.get(CHANNELS.AI_COMPLETE_INLINE)!({}, inlineReq())
    expect(res).toEqual({ text: '' })
    expect(completeInline).not.toHaveBeenCalled()
  })

  it('returns the sanitized completion on success', async () => {
    storeData.aiConfig = { apiKey: 'sk-1234', model: 'claude-sonnet-4-6' }
    completeInline.mockResolvedValue({ text: '```sql\nWHERE id = 1\n```' })
    const res = await handlers.get(CHANNELS.AI_COMPLETE_INLINE)!({}, inlineReq())
    expect(res).toEqual({ text: 'WHERE id = 1' })
  })

  it('returns an error field when the provider throws', async () => {
    storeData.aiConfig = { apiKey: 'sk-1234', model: 'claude-sonnet-4-6' }
    completeInline.mockRejectedValue(new Error('boom'))
    const res = await handlers.get(CHANNELS.AI_COMPLETE_INLINE)!({}, inlineReq())
    expect(res).toEqual({ text: '', error: 'boom' })
  })
})
```

- [ ] **Step 2: Run to verify it fails**

Run: `npm test -- ipc/ai`
Expected: FAIL (no handler registered for `AI_COMPLETE_INLINE`).

- [ ] **Step 3: Implement the handler**

In `src/main/ipc/ai.ts`:
- Extend the type import to add the inline types:
```ts
import type { AiCompleteRequest, AiCompleteResponse, AiConfigStatus, AiConfigSet, InlineCompleteRequest, InlineCompleteResponse } from '../../shared/types'
```
- Add imports for the pure helpers (after the existing imports):
```ts
import { buildInlinePrompt } from '../ai/buildInlinePrompt'
import { sanitizeCompletion } from '../ai/sanitizeCompletion'
```
- Add this handler inside `registerAiHandlers()` (after the `AI_CHAT_COMPLETE` handler):
```ts
  ipcMain.handle(
    CHANNELS.AI_COMPLETE_INLINE,
    async (_event, req: InlineCompleteRequest): Promise<InlineCompleteResponse> => {
      const cfg = store.get('aiConfig')
      if (!cfg.apiKey) return { text: '' }
      try {
        const provider = getProvider('anthropic')
        const { system, user } = buildInlinePrompt(req)
        const { text } = await provider.completeInline({ system, prompt: user }, cfg.apiKey)
        return { text: sanitizeCompletion(text, req.prefix) }
      } catch (err) {
        return { text: '', error: err instanceof Error ? err.message : String(err) }
      }
    }
  )
```

- [ ] **Step 4: Run to verify it passes**

Run: `npm test -- ipc/ai && npm run typecheck`
Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add src/main/ipc/ai.ts src/__tests__/main/ipc/ai.test.ts
git commit -m "feat(ai): AI_COMPLETE_INLINE handler"
```

---

## Task 7: `inlineSchemaContext` (pure, renderer)

**Files:**
- Create: `src/renderer/src/lib/inlineSchemaContext.ts`
- Test: `src/__tests__/renderer/lib/inlineSchemaContext.test.ts`

- [ ] **Step 1: Write the failing test**

Create `src/__tests__/renderer/lib/inlineSchemaContext.test.ts`:

```ts
import { describe, it, expect } from 'vitest'
import { inlineSchemaContext } from '../../../renderer/src/lib/inlineSchemaContext'

const schema = {
  'sales.orders': ['id', 'total', 'user_id'],
  orders: ['id', 'total', 'user_id'],
  users: ['id', 'name'],
}

describe('inlineSchemaContext', () => {
  it('lists columns for tables referenced in the SQL', () => {
    const out = inlineSchemaContext('SELECT * FROM orders JOIN users ON 1=1', schema)
    expect(out).toContain('orders(id, total, user_id)')
    expect(out).toContain('users(id, name)')
  })

  it('returns empty string when no referenced table is known', () => {
    expect(inlineSchemaContext('SELECT * FROM unknown_table', schema)).toBe('')
  })

  it('returns empty string when there are no table refs', () => {
    expect(inlineSchemaContext('SELECT 1', schema)).toBe('')
  })

  it('caps the number of tables included', () => {
    const many = 'SELECT * FROM orders JOIN users ON 1=1'
    expect(inlineSchemaContext(many, schema, 1).split('\n')).toHaveLength(1)
  })
})
```

- [ ] **Step 2: Run to verify it fails**

Run: `npm test -- inlineSchemaContext`
Expected: FAIL (module not found).

- [ ] **Step 3: Implement**

Create `src/renderer/src/lib/inlineSchemaContext.ts`:

```ts
import { extractTableRefs } from './extractTableRefs'

/**
 * Build a compact, prompt-friendly schema string for the tables referenced in
 * `sql`, using the editor's table→columns map. Returns '' when nothing matches.
 * Each line looks like `orders(id, total, user_id)`.
 */
export function inlineSchemaContext(
  sql: string,
  schema: Record<string, string[]>,
  maxTables = 6
): string {
  const lines: string[] = []
  const seen = new Set<string>()
  for (const ref of extractTableRefs(sql)) {
    if (lines.length >= maxTables) break
    // sqlSchema is keyed by both `dataset.table` and bare `table`.
    const cols = schema[ref.name] ?? schema[ref.name.split('.').pop() ?? ref.name]
    if (!cols || cols.length === 0) continue
    if (seen.has(ref.name)) continue
    seen.add(ref.name)
    lines.push(`${ref.name}(${cols.join(', ')})`)
  }
  return lines.join('\n')
}
```

- [ ] **Step 4: Run to verify it passes**

Run: `npm test -- inlineSchemaContext`
Expected: PASS (4 tests).

- [ ] **Step 5: Commit**

```bash
git add src/renderer/src/lib/inlineSchemaContext.ts src/__tests__/renderer/lib/inlineSchemaContext.test.ts
git commit -m "feat(ai): inline schema-context builder"
```

---

## Task 8: `aiSettingsStore` (coverage-gated)

**Files:**
- Create: `src/renderer/src/store/aiSettingsStore.ts`
- Test: `src/__tests__/renderer/store/aiSettingsStore.test.ts`

- [ ] **Step 1: Write the failing test**

Create `src/__tests__/renderer/store/aiSettingsStore.test.ts`:

```ts
import { describe, it, expect, vi, beforeEach } from 'vitest'
import { CHANNELS } from '@shared/ipc'
import { useAiSettingsStore } from '../../../renderer/src/store/aiSettingsStore'

beforeEach(() => {
  useAiSettingsStore.setState({ enabled: false, keyConfigured: false })
  vi.mocked(window.api.invoke).mockReset()
})

describe('aiSettingsStore', () => {
  it('load() pulls enabled + keyConfigured from AI_CONFIG_GET', async () => {
    vi.mocked(window.api.invoke).mockResolvedValue({
      configured: true, maskedHint: '…1234', model: 'm', inlineCompletionEnabled: true,
    })
    await useAiSettingsStore.getState().load()
    expect(window.api.invoke).toHaveBeenCalledWith(CHANNELS.AI_CONFIG_GET, undefined)
    expect(useAiSettingsStore.getState().enabled).toBe(true)
    expect(useAiSettingsStore.getState().keyConfigured).toBe(true)
  })

  it('setEnabled() writes AI_CONFIG_SET and updates state from the response', async () => {
    vi.mocked(window.api.invoke).mockResolvedValue({
      configured: true, maskedHint: '…1234', model: 'm', inlineCompletionEnabled: true,
    })
    await useAiSettingsStore.getState().setEnabled(true)
    expect(window.api.invoke).toHaveBeenCalledWith(CHANNELS.AI_CONFIG_SET, { inlineCompletionEnabled: true })
    expect(useAiSettingsStore.getState().enabled).toBe(true)
    expect(useAiSettingsStore.getState().keyConfigured).toBe(true)
  })
})
```

- [ ] **Step 2: Run to verify it fails**

Run: `npm test -- aiSettingsStore`
Expected: FAIL (module not found).

- [ ] **Step 3: Implement**

Create `src/renderer/src/store/aiSettingsStore.ts`:

```ts
import { create } from 'zustand'
import { CHANNELS } from '@shared/ipc'

interface AiSettingsState {
  /** Whether inline AI completion is enabled in settings. */
  enabled: boolean
  /** Whether an API key is configured (completions are gated on this). */
  keyConfigured: boolean
  load: () => Promise<void>
  setEnabled: (value: boolean) => Promise<void>
}

export const useAiSettingsStore = create<AiSettingsState>((set) => ({
  enabled: false,
  keyConfigured: false,

  load: async () => {
    const status = await window.api.invoke(CHANNELS.AI_CONFIG_GET, undefined)
    set({ enabled: status.inlineCompletionEnabled, keyConfigured: status.configured })
  },

  setEnabled: async (value) => {
    const status = await window.api.invoke(CHANNELS.AI_CONFIG_SET, { inlineCompletionEnabled: value })
    set({ enabled: status.inlineCompletionEnabled, keyConfigured: status.configured })
  },
}))
```

- [ ] **Step 4: Run to verify it passes**

Run: `npm test -- aiSettingsStore && npm run typecheck`
Expected: PASS (2 tests).

- [ ] **Step 5: Commit**

```bash
git add src/renderer/src/store/aiSettingsStore.ts src/__tests__/renderer/store/aiSettingsStore.test.ts
git commit -m "feat(ai): aiSettingsStore for inline completion toggle"
```

---

## Task 9: The ghost-text CodeMirror extension

**Files:**
- Create: `src/renderer/src/lib/inlineCompletion.ts`

> Not unit-tested (CodeMirror + DOM); verified in the manual smoke test. Ends in typecheck.

- [ ] **Step 1: Create the extension**

Create `src/renderer/src/lib/inlineCompletion.ts`:

```ts
import { StateField, StateEffect, Prec, type Extension } from '@codemirror/state'
import { EditorView, ViewPlugin, Decoration, WidgetType, keymap, type ViewUpdate, type DecorationSet } from '@codemirror/view'
import type { ConnectionEngine } from '@shared/types'
import { inlineSchemaContext } from './inlineSchemaContext'

const DEBOUNCE_MS = 400
const CACHE_MAX = 50

export interface InlineCompletionConfig {
  /** Whether completions should fire (enabled AND key configured). */
  isEnabled: () => boolean
  getEngine: () => ConnectionEngine | undefined
  /** Table → columns map (the editor's sqlSchema). */
  getSchema: () => Record<string, string[]>
  /** Calls the main process; returns the suggestion text ('' = none). */
  request: (req: {
    requestId: string
    prefix: string
    suffix: string
    engine: ConnectionEngine
    schema: string
  }) => Promise<string>
}

interface Ghost {
  text: string
  pos: number
}

const setGhost = StateEffect.define<Ghost | null>()

class GhostWidget extends WidgetType {
  constructor(readonly text: string) {
    super()
  }
  eq(other: GhostWidget): boolean {
    return other.text === this.text
  }
  toDOM(): HTMLElement {
    const span = document.createElement('span')
    span.className = 'cm-inline-ghost'
    span.style.opacity = '0.45'
    span.style.whiteSpace = 'pre'
    span.textContent = this.text
    return span
  }
  ignoreEvent(): boolean {
    return false
  }
}

const ghostField = StateField.define<Ghost | null>({
  create() {
    return null
  },
  update(value, tr) {
    for (const e of tr.effects) if (e.is(setGhost)) return e.value
    // Any edit or cursor move clears the ghost (acceptance carries setGhost(null)).
    if (tr.docChanged || tr.selection) return null
    return value
  },
  provide: (f) =>
    EditorView.decorations.from(f, (v): DecorationSet =>
      v
        ? Decoration.set([
            Decoration.widget({ widget: new GhostWidget(v.text), side: 1 }).range(v.pos),
          ])
        : Decoration.none
    ),
})

const acceptKeymap = Prec.highest(
  keymap.of([
    {
      key: 'Tab',
      run: (view) => {
        const g = view.state.field(ghostField, false)
        if (!g) return false
        view.dispatch({
          changes: { from: g.pos, insert: g.text },
          selection: { anchor: g.pos + g.text.length },
          effects: setGhost.of(null),
        })
        return true
      },
    },
    {
      key: 'Escape',
      run: (view) => {
        if (!view.state.field(ghostField, false)) return false
        view.dispatch({ effects: setGhost.of(null) })
        return true
      },
    },
  ])
)

/**
 * Copilot-style inline ghost-text completion. Self-contained: debounces, caches,
 * cancels stale requests, renders ghost text, and binds Tab (accept) / Esc (dismiss).
 * The IPC call is injected via `config.request` so this stays testable/decoupled.
 */
export function inlineCompletion(config: InlineCompletionConfig): Extension {
  const cache = new Map<string, string>()

  const plugin = ViewPlugin.fromClass(
    class {
      timer: ReturnType<typeof setTimeout> | null = null
      gen = 0

      update(update: ViewUpdate): void {
        if (update.docChanged) this.schedule(update.view)
      }

      schedule(view: EditorView): void {
        if (this.timer) clearTimeout(this.timer)
        if (!config.isEnabled()) return
        this.timer = setTimeout(() => void this.fetch(view), DEBOUNCE_MS)
      }

      async fetch(view: EditorView): Promise<void> {
        const engine = config.getEngine()
        if (!engine || !config.isEnabled()) return

        const docAtRequest = view.state.doc.toString()
        if (!docAtRequest.trim()) return
        const pos = view.state.selection.main.head
        const prefix = docAtRequest.slice(0, pos)
        const suffix = docAtRequest.slice(pos)

        const cacheKey = `${engine} ${prefix} ${suffix}`
        let text = cache.get(cacheKey)

        if (text === undefined) {
          const schema = inlineSchemaContext(docAtRequest, config.getSchema())
          const requestId = String(++this.gen)
          try {
            text = await config.request({ requestId, prefix, suffix, engine, schema })
          } catch {
            return
          }
          // Drop if a newer request started while we awaited.
          if (requestId !== String(this.gen)) return
          cache.set(cacheKey, text)
          if (cache.size > CACHE_MAX) cache.delete(cache.keys().next().value as string)
        }

        // Drop if the user moved or edited while we awaited.
        if (view.state.doc.toString() !== docAtRequest) return
        if (view.state.selection.main.head !== pos) return
        if (!text) return

        view.dispatch({ effects: setGhost.of({ text, pos }) })
      }

      destroy(): void {
        if (this.timer) clearTimeout(this.timer)
      }
    }
  )

  return [ghostField, plugin, acceptKeymap]
}
```

- [ ] **Step 2: Typecheck**

Run: `npm run typecheck`
Expected: PASS.

- [ ] **Step 3: Commit**

```bash
git add src/renderer/src/lib/inlineCompletion.ts
git commit -m "feat(ai): ghost-text inline completion extension"
```

---

## Task 10: Wire the extension + toolbar toggle into `QueryEditor`

**Files:**
- Modify: `src/renderer/src/components/editor/QueryEditor.tsx`

- [ ] **Step 1: Add imports**

In `src/renderer/src/components/editor/QueryEditor.tsx`:
- Add `useRef` to the React import (line 1):
```ts
import { memo, useCallback, useMemo, useRef } from 'react'
```
- Add `Sparkles` to the `lucide-react` import.
- Add these imports after the existing ones:
```ts
import { CHANNELS } from '@shared/ipc'
import { inlineCompletion } from '../../lib/inlineCompletion'
import { useAiSettingsStore } from '../../store/aiSettingsStore'
```

- [ ] **Step 2: Build the extension from live refs**

Inside the `QueryEditor` function, after the `languageExtension` memo, add:

```ts
  const inlineEnabled = useAiSettingsStore((s) => s.enabled && s.keyConfigured)
  const keyConfigured = useAiSettingsStore((s) => s.keyConfigured)
  const setInlineEnabled = useAiSettingsStore((s) => s.setEnabled)

  // Live refs so the (stable) inline extension reads current values without rebuilding.
  const enabledRef = useRef(inlineEnabled)
  enabledRef.current = inlineEnabled
  const engineRef = useRef(engine)
  engineRef.current = engine
  const schemaRef = useRef(sqlSchema)
  schemaRef.current = sqlSchema

  const inlineExt = useMemo(
    () =>
      inlineCompletion({
        isEnabled: () => enabledRef.current,
        getEngine: () => engineRef.current,
        getSchema: () => schemaRef.current ?? {},
        request: async (r) => {
          const res = await window.api.invoke(CHANNELS.AI_COMPLETE_INLINE, r)
          return res.text
        },
      }),
    []
  )
```

- [ ] **Step 3: Add the extension to the memoized extensions array**

Replace the `extensions` memo with:

```ts
  const extensions = useMemo(
    () => [
      languageExtension,
      keymapExtension,
      customTheme,
      inlineExt,
      autocompletion({ activateOnTyping: true, defaultKeymap: true, icons: true }),
    ],
    [languageExtension, keymapExtension, inlineExt],
  )
```

- [ ] **Step 4: Add the toolbar toggle button**

In the toolbar `<div className="flex items-center gap-2">`, add this button right before the Format button:

```tsx
          {/* Inline AI completions toggle */}
          <button
            onClick={() => void setInlineEnabled(!inlineEnabled)}
            disabled={!keyConfigured}
            title={
              !keyConfigured
                ? 'Add an API key in Settings → AI to enable inline completions'
                : inlineEnabled
                  ? 'Inline AI completions: on'
                  : 'Inline AI completions: off'
            }
            className={`flex items-center gap-1 text-xs px-2 py-1 rounded transition-colors disabled:opacity-40 disabled:cursor-not-allowed ${
              inlineEnabled
                ? 'text-app-accent-text hover:bg-app-elevated'
                : 'text-app-text-2 hover:text-app-text hover:bg-app-elevated'
            }`}
          >
            <Sparkles size={13} />
            <span className="text-[11px]">AI</span>
          </button>
```

- [ ] **Step 5: Typecheck**

Run: `npm run typecheck`
Expected: PASS.

- [ ] **Step 6: Commit**

```bash
git add src/renderer/src/components/editor/QueryEditor.tsx
git commit -m "feat(ai): mount inline completion + toolbar toggle in editor"
```

---

## Task 11: Settings toggle + boot-load the store

**Files:**
- Modify: `src/renderer/src/components/settings/SettingsModal.tsx`
- Modify: `src/renderer/src/App.tsx`

- [ ] **Step 1: Boot-load `aiSettingsStore` in App**

In `src/renderer/src/App.tsx`:
- Add the import:
```ts
import { useAiSettingsStore } from './store/aiSettingsStore'
```
- Add the selector near the other store selectors:
```ts
  const loadAiSettings = useAiSettingsStore((s) => s.load)
```
- Add `loadAiSettings()` to the eager-load `useEffect` body and add `loadAiSettings` to its dependency array.

- [ ] **Step 2: Add the toggle to the AI settings section**

In `src/renderer/src/components/settings/SettingsModal.tsx`, in the `AiSection` component:
- Add the import at the top of the file (after the existing imports):
```ts
import { useAiSettingsStore } from '../../store/aiSettingsStore'
```
- Inside `AiSection`, add selectors near its other hooks:
```ts
  const inlineEnabled = useAiSettingsStore((s) => s.enabled)
  const inlineKeyConfigured = useAiSettingsStore((s) => s.keyConfigured)
  const setInlineEnabled = useAiSettingsStore((s) => s.setEnabled)
  const loadAiSettings = useAiSettingsStore((s) => s.load)
```
- In `AiSection`'s existing `save` function, after the line `setStatus(s)`, add a refresh so the toggle's `keyConfigured` reflects a newly-saved key:
```ts
    await loadAiSettings()
```
- Add the toggle UI right after the Model `<select>` block's closing `</div>` (before the Save button's `<div>`):
```tsx
        <div className="flex items-start justify-between gap-3">
          <div className="flex flex-col">
            <label className="app-section-label">Inline AI completions (experimental)</label>
            <p className="text-ui-xs text-app-text-3">
              Ghost-text suggestions as you type. Uses your key on every pause — small per-keystroke cost.
            </p>
          </div>
          <button
            type="button"
            role="switch"
            aria-checked={inlineEnabled}
            disabled={!inlineKeyConfigured}
            onClick={() => void setInlineEnabled(!inlineEnabled)}
            className={`mt-0.5 shrink-0 w-9 h-5 rounded-full transition-colors disabled:opacity-40 ${
              inlineEnabled ? 'bg-app-accent' : 'bg-app-border'
            }`}
          >
            <span
              className={`block w-4 h-4 bg-white rounded-full transition-transform ${
                inlineEnabled ? 'translate-x-4' : 'translate-x-0.5'
              }`}
            />
          </button>
        </div>
```

- [ ] **Step 3: Typecheck + full suite**

Run: `npm run typecheck && npm test`
Expected: PASS (all tests).

- [ ] **Step 4: Commit**

```bash
git add src/renderer/src/components/settings/SettingsModal.tsx src/renderer/src/App.tsx
git commit -m "feat(ai): Settings toggle + boot-load aiSettingsStore"
```

---

## Task 12: Manual smoke test

**Files:** none (verification only)

- [ ] **Step 1: Launch**

Run: `just dev` (or `npm run dev`)
Expected: app launches, no console errors.

- [ ] **Step 2: Verify gating**

With no API key: open the editor — the toolbar **AI** button is disabled (tooltip points to Settings → AI). Settings → AI: the inline toggle is disabled.

- [ ] **Step 3: Enable + exercise**

Add an Anthropic key in Settings → AI, flip on **Inline AI completions**. In a SQL tab on a BigQuery/Postgres connection with a known table:
- Type `SELECT ` and pause → a gray ghost-text suggestion appears.
- Press **Tab** → it's inserted. Press **Esc** on a new suggestion → it disappears.
- Confirm typing again replaces/clears stale suggestions and that schema-aware column names appear after `SELECT ` / `WHERE `.
- Toggle the toolbar **AI** button off → no more suggestions.

- [ ] **Step 4: Commit (only if fixes were needed)**

```bash
git add -A
git commit -m "fix(ai): inline completion smoke-test adjustments"
```
(Skip if nothing changed.)

---

## Task 13: Docs

**Files:**
- Modify: `README.md`
- Modify: `CHANGELOG.md`
- Modify: `CLAUDE.md`

- [ ] **Step 1: README**

Add a short "AI inline completions" note near the existing AI assistant section: what it does (Copilot-style ghost text, Tab to accept), that it's opt-in (Settings → AI), schema- and dialect-aware (Cypher for Neo4j), and uses a fast model (Haiku) on your key.

- [ ] **Step 2: CHANGELOG**

Under `## [Unreleased]` → `### Added`:
```
- AI inline autocomplete: opt-in Copilot-style ghost-text suggestions in the SQL/Cypher editor, powered by a fast model (Anthropic Haiku), schema- and dialect-aware. Tab to accept; toggle in Settings → AI or the editor toolbar.
```

- [ ] **Step 3: CLAUDE.md change-log entry**

Append a `### [2026-06-19] Feature: AI inline autocomplete` entry in the established format (Type/Context/Problem/Change/Solution/Files affected), referencing the spec + plan and noting: `completeInline` on the provider interface (Anthropic → Haiku, provider-extensible), `AI_COMPLETE_INLINE` req/res channel, pure `buildInlinePrompt`/`sanitizeCompletion` (main) + `inlineSchemaContext` (renderer), the self-contained `inlineCompletion` CodeMirror extension (debounce/cache/cancel/Tab-accept), `aiConfig.inlineCompletionEnabled` + `aiSettingsStore`, opt-in gating, and the editor toolbar + Settings toggles. Note coverage-gated files: `ipc/ai.ts` (extended) and `store/aiSettingsStore.ts`.

- [ ] **Step 4: Verify build + coverage**

Run: `npm run typecheck && npm run test:coverage && npm run build`
Expected: PASS; coverage ≥ 70% on all thresholds; build clean.

- [ ] **Step 5: Commit**

```bash
git add README.md CHANGELOG.md CLAUDE.md
git commit -m "docs(ai): document AI inline autocomplete"
```

---

## Final verification checklist

- [ ] `npm run typecheck` passes
- [ ] `npm run test:coverage` passes (all thresholds ≥ 70%); `ipc/ai.ts` + `store/aiSettingsStore.ts` covered
- [ ] `npm run build` succeeds
- [ ] Manual smoke test (Task 12) completed
- [ ] README, CHANGELOG, CLAUDE.md updated
- [ ] All work committed on the feature branch
