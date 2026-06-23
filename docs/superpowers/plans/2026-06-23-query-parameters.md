# Query Parameters (`{{name}}`) Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Let users write `{{name}}` placeholders in any editor tab, fill values in an inputs panel, and run/explain the query with those values substituted into the SQL string before execution.

**Architecture:** Pure client-side substitution. Two pure `lib/` helpers (`extractParams`, `substituteParams`) plus a reconcile helper in `queryStore` keep `tab.params` in sync with the SQL. `runQuery`/`explainQuery` substitute values into the SQL string before sending it through the existing `QUERY_EXECUTE`/`QUERY_DRY_RUN` channels — no adapter or IPC changes. A new `ParamsPanel` renders the inputs; param types+values persist with `SavedQuery`.

**Tech Stack:** TypeScript (strict), React, Zustand, Tailwind, Vitest (jsdom for renderer).

## Global Constraints

- TypeScript strict mode; prefer explicit types over `any`.
- Renderer never calls DB adapters directly — all DB work stays in main via existing IPC. This feature adds **no** IPC or main-process changes (the JSON store already persists whole `SavedQuery` objects via `...req`).
- Tailwind utility classes only — no inline styles, no CSS modules. Use existing design tokens (`app-*`).
- New `src/renderer/src/lib/**` files are inside the coverage gate (≥70% lines/functions/branches/statements). UI components (`components/**`) are outside it.
- All tests must pass before merge: `just ci` green.
- Append a CLAUDE.md change-log entry; keep README.md + CHANGELOG.md in sync.
- Placeholder syntax is exactly `{{name}}` where `name` matches `[A-Za-z_][A-Za-z0-9_]*`, with optional inner whitespace (`{{ name }}` == `{{name}}`).
- Param types: `'text' | 'number' | 'boolean' | 'raw'`. Default `'text'`.

---

### Task 1: Shared types — `QueryParam`, `QueryTab.params`, `SavedQuery.params`

**Files:**
- Modify: `src/shared/types.ts`

**Interfaces:**
- Consumes: nothing.
- Produces: `QueryParam = { name: string; type: 'text' | 'number' | 'boolean' | 'raw'; value: string }`; `QueryTab.params?: QueryParam[]`; `SavedQuery.params?: QueryParam[]`.

- [ ] **Step 1: Add the `QueryParam` type and wire it into `QueryTab` and `SavedQuery`**

In `src/shared/types.ts`, add this interface immediately above `export interface QueryTab {`:

```ts
/** A query parameter ({{name}}) and its current value/type for client-side substitution. */
export interface QueryParam {
  name: string
  type: 'text' | 'number' | 'boolean' | 'raw'
  value: string
}
```

Inside `export interface QueryTab { ... }`, add after the `sql: string` line:

```ts
  /** Detected {{name}} params for this tab, kept in sync with `sql`. */
  params?: QueryParam[]
```

Inside `export interface SavedQuery { ... }`, add after the `sql: string` line:

```ts
  /** Persisted param types + default values, restored when the query is reopened. */
  params?: QueryParam[]
```

- [ ] **Step 2: Verify it compiles**

Run: `npx tsc --noEmit -p tsconfig.web.json`
Expected: no errors (type-only additions; `?` keeps all existing call sites valid).

- [ ] **Step 3: Commit**

```bash
git add src/shared/types.ts
git commit -m "feat(types): add QueryParam + params on QueryTab/SavedQuery"
```

---

### Task 2: `extractParams` pure helper

**Files:**
- Create: `src/renderer/src/lib/extractParams.ts`
- Test: `src/__tests__/renderer/lib/extractParams.test.ts`

**Interfaces:**
- Consumes: nothing.
- Produces: `extractParams(sql: string): string[]` — ordered, de-duplicated param names; `{{...}}` inside comments / string literals is ignored.

- [ ] **Step 1: Write the failing test**

Create `src/__tests__/renderer/lib/extractParams.test.ts`:

```ts
import { describe, it, expect } from 'vitest'
import { extractParams } from '@renderer/lib/extractParams'

describe('extractParams', () => {
  it('returns [] when there are no params', () => {
    expect(extractParams('SELECT 1')).toEqual([])
  })

  it('extracts a single param', () => {
    expect(extractParams('SELECT * FROM t WHERE a = {{country}}')).toEqual(['country'])
  })

  it('de-duplicates and preserves first-seen order', () => {
    expect(extractParams('SELECT {{b}}, {{a}} FROM t WHERE x = {{a}}')).toEqual(['b', 'a'])
  })

  it('tolerates whitespace inside the braces', () => {
    expect(extractParams('WHERE a = {{ start_date }}')).toEqual(['start_date'])
  })

  it('ignores {{...}} inside a single-quoted string literal', () => {
    expect(extractParams("SELECT '{{notparam}}' AS lit, {{real}}")).toEqual(['real'])
  })

  it('ignores {{...}} inside a line comment', () => {
    expect(extractParams('SELECT 1 -- {{nope}}\nWHERE a = {{yes}}')).toEqual(['yes'])
  })

  it('ignores {{...}} inside a block comment', () => {
    expect(extractParams('SELECT /* {{nope}} */ {{yes}}')).toEqual(['yes'])
  })

  it('does not match invalid names (leading digit, dashes)', () => {
    expect(extractParams('SELECT {{1bad}}, {{a-b}}')).toEqual([])
  })

  it('matches two adjacent params', () => {
    expect(extractParams('{{a}}{{b}}')).toEqual(['a', 'b'])
  })
})
```

- [ ] **Step 2: Run test to verify it fails**

Run: `npx vitest run src/__tests__/renderer/lib/extractParams.test.ts`
Expected: FAIL — `Cannot find module '@renderer/lib/extractParams'`.

- [ ] **Step 3: Write the implementation**

Create `src/renderer/src/lib/extractParams.ts`:

```ts
/**
 * Returns the ordered, de-duplicated list of {{name}} parameter names referenced
 * in `sql`. Comments and string literals are stripped first, so a {{...}} that
 * appears inside a string or comment is not treated as a parameter. Param names
 * match [A-Za-z_][A-Za-z0-9_]* with optional surrounding whitespace.
 */
export function extractParams(sql: string): string[] {
  const cleaned = stripNoise(sql)
  const re = /\{\{\s*([A-Za-z_][A-Za-z0-9_]*)\s*\}\}/g
  const seen = new Set<string>()
  const out: string[] = []
  let m: RegExpExecArray | null
  while ((m = re.exec(cleaned)) !== null) {
    const name = m[1]
    if (!seen.has(name)) {
      seen.add(name)
      out.push(name)
    }
  }
  return out
}

/**
 * Replace line comments, block comments, and single/double/backtick-quoted
 * strings with spaces so {{...}} inside them is not detected.
 */
function stripNoise(sql: string): string {
  let out = ''
  let i = 0
  while (i < sql.length) {
    const c = sql[i]
    if (c === '-' && sql[i + 1] === '-') {
      const end = sql.indexOf('\n', i)
      i = end === -1 ? sql.length : end
      out += ' '
      continue
    }
    if (c === '/' && sql[i + 1] === '*') {
      const end = sql.indexOf('*/', i + 2)
      i = end === -1 ? sql.length : end + 2
      out += ' '
      continue
    }
    if (c === "'" || c === '"' || c === '`') {
      const quote = c
      i++
      while (i < sql.length) {
        if (sql[i] === quote && sql[i + 1] === quote) { i += 2; continue }
        if (sql[i] === quote) { i++; break }
        i++
      }
      out += ' '
      continue
    }
    out += c
    i++
  }
  return out
}
```

- [ ] **Step 4: Run test to verify it passes**

Run: `npx vitest run src/__tests__/renderer/lib/extractParams.test.ts`
Expected: PASS (9 tests).

- [ ] **Step 5: Commit**

```bash
git add src/renderer/src/lib/extractParams.ts src/__tests__/renderer/lib/extractParams.test.ts
git commit -m "feat(lib): extractParams — detect {{name}} placeholders"
```

---

### Task 3: `substituteParams` pure helper

**Files:**
- Create: `src/renderer/src/lib/substituteParams.ts`
- Test: `src/__tests__/renderer/lib/substituteParams.test.ts`

**Interfaces:**
- Consumes: `QueryParam` from `@shared/types`.
- Produces: `substituteParams(sql: string, params: QueryParam[]): { sql: string } | { error: string }` — replaces each known `{{name}}` with its type-rendered value; returns `{ error }` (naming the offending param) on the first missing-value / invalid-number / invalid-boolean failure; leaves unknown `{{...}}` tokens verbatim.

- [ ] **Step 1: Write the failing test**

Create `src/__tests__/renderer/lib/substituteParams.test.ts`:

```ts
import { describe, it, expect } from 'vitest'
import { substituteParams } from '@renderer/lib/substituteParams'
import type { QueryParam } from '@shared/types'

const p = (name: string, type: QueryParam['type'], value: string): QueryParam => ({ name, type, value })

describe('substituteParams', () => {
  it('quotes and escapes text values', () => {
    const r = substituteParams('WHERE name = {{n}}', [p('n', 'text', "O'Brien")])
    expect(r).toEqual({ sql: "WHERE name = 'O''Brien'" })
  })

  it('inserts numbers verbatim', () => {
    expect(substituteParams('LIMIT {{lim}}', [p('lim', 'number', '100')])).toEqual({ sql: 'LIMIT 100' })
  })

  it('errors on a non-numeric number value', () => {
    expect(substituteParams('LIMIT {{lim}}', [p('lim', 'number', 'abc')])).toEqual({
      error: '{{lim}} is not a valid number.',
    })
  })

  it('renders booleans lowercase and unquoted', () => {
    expect(substituteParams('WHERE active = {{a}}', [p('a', 'boolean', 'TRUE')])).toEqual({
      sql: 'WHERE active = true',
    })
  })

  it('errors on a non-boolean boolean value', () => {
    expect(substituteParams('WHERE a = {{a}}', [p('a', 'boolean', 'yes')])).toEqual({
      error: '{{a}} must be true or false.',
    })
  })

  it('inserts raw values verbatim (no quoting)', () => {
    const r = substituteParams('WHERE id IN ({{ids}})', [p('ids', 'raw', '1, 2, 3')])
    expect(r).toEqual({ sql: 'WHERE id IN (1, 2, 3)' })
  })

  it('allows an empty raw value (inserts nothing)', () => {
    expect(substituteParams('SELECT 1 {{tail}}', [p('tail', 'raw', '')])).toEqual({ sql: 'SELECT 1 ' })
  })

  it('errors on an empty text value', () => {
    expect(substituteParams('WHERE a = {{a}}', [p('a', 'text', '')])).toEqual({
      error: 'Fill in {{a}} before running.',
    })
  })

  it('tolerates whitespace inside the braces', () => {
    expect(substituteParams('WHERE a = {{ a }}', [p('a', 'number', '5')])).toEqual({ sql: 'WHERE a = 5' })
  })

  it('leaves unknown tokens verbatim', () => {
    expect(substituteParams('SELECT {{x}}', [])).toEqual({ sql: 'SELECT {{x}}' })
  })

  it('substitutes multiple params in one query', () => {
    const r = substituteParams('WHERE a = {{a}} AND b = {{b}}', [p('a', 'text', 'x'), p('b', 'number', '2')])
    expect(r).toEqual({ sql: "WHERE a = 'x' AND b = 2" })
  })
})
```

- [ ] **Step 2: Run test to verify it fails**

Run: `npx vitest run src/__tests__/renderer/lib/substituteParams.test.ts`
Expected: FAIL — `Cannot find module '@renderer/lib/substituteParams'`.

- [ ] **Step 3: Write the implementation**

Create `src/renderer/src/lib/substituteParams.ts`:

```ts
import type { QueryParam } from '@shared/types'

/**
 * Replace every known {{name}} occurrence in `sql` with its type-rendered value.
 * Returns { error } (naming the offending param) on the first missing-value /
 * invalid-number / invalid-boolean failure. Unknown {{...}} tokens (no matching
 * param — e.g. ones that live inside a comment and were never surfaced as inputs)
 * are left verbatim.
 */
export function substituteParams(
  sql: string,
  params: QueryParam[],
): { sql: string } | { error: string } {
  const byName = new Map(params.map((p) => [p.name, p]))
  let error: string | null = null
  const out = sql.replace(/\{\{\s*([A-Za-z_][A-Za-z0-9_]*)\s*\}\}/g, (whole, name: string) => {
    const param = byName.get(name)
    if (!param) return whole // unknown token — leave as-is
    const rendered = renderValue(param)
    if ('error' in rendered) {
      error ??= rendered.error
      return whole
    }
    return rendered.value
  })
  if (error) return { error }
  return { sql: out }
}

function renderValue(p: QueryParam): { value: string } | { error: string } {
  if (p.type === 'raw') return { value: p.value } // empty allowed
  if (p.value.trim() === '') return { error: `Fill in {{${p.name}}} before running.` }
  switch (p.type) {
    case 'text':
      return { value: `'${p.value.replace(/'/g, "''")}'` }
    case 'number': {
      if (!Number.isFinite(Number(p.value))) return { error: `{{${p.name}}} is not a valid number.` }
      return { value: p.value.trim() }
    }
    case 'boolean': {
      const low = p.value.trim().toLowerCase()
      if (low !== 'true' && low !== 'false') return { error: `{{${p.name}}} must be true or false.` }
      return { value: low }
    }
  }
}
```

- [ ] **Step 4: Run test to verify it passes**

Run: `npx vitest run src/__tests__/renderer/lib/substituteParams.test.ts`
Expected: PASS (11 tests).

- [ ] **Step 5: Commit**

```bash
git add src/renderer/src/lib/substituteParams.ts src/__tests__/renderer/lib/substituteParams.test.ts
git commit -m "feat(lib): substituteParams — type-aware {{name}} substitution"
```

---

### Task 4: queryStore — keep `tab.params` in sync + `setTabParams`/`syncTabParams`

**Files:**
- Modify: `src/renderer/src/store/queryStore.ts`
- Test: `src/__tests__/renderer/store/queryStore.test.ts`

**Interfaces:**
- Consumes: `extractParams` (Task 2), `QueryParam` (Task 1).
- Produces: store actions `setTabParams(id: string, params: QueryParam[]): void` and `syncTabParams(id: string): void`; `updateTabSql` now also reconciles `tab.params` against the new SQL (preserve existing `{type,value}` by name, add new as `{type:'text',value:''}`, drop removed).

- [ ] **Step 1: Write the failing test**

Add this `describe` block to `src/__tests__/renderer/store/queryStore.test.ts` (keep existing imports; add `QueryParam` to the `@shared/types` import if not present):

```ts
describe('query params', () => {
  it('updateTabSql adds detected params with text default', () => {
    const id = useQueryStore.getState().openTab({ connectionId: 'c1' })
    useQueryStore.getState().updateTabSql(id, 'SELECT * WHERE a = {{country}}')
    const tab = useQueryStore.getState().tabs.find((t) => t.id === id)!
    expect(tab.params).toEqual([{ name: 'country', type: 'text', value: '' }])
  })

  it('updateTabSql preserves existing value/type by name and drops removed', () => {
    const id = useQueryStore.getState().openTab({ connectionId: 'c1' })
    useQueryStore.getState().updateTabSql(id, 'WHERE a = {{a}} AND b = {{b}}')
    useQueryStore.getState().setTabParams(id, [
      { name: 'a', type: 'number', value: '5' },
      { name: 'b', type: 'text', value: 'x' },
    ])
    useQueryStore.getState().updateTabSql(id, 'WHERE a = {{a}}')
    const tab = useQueryStore.getState().tabs.find((t) => t.id === id)!
    expect(tab.params).toEqual([{ name: 'a', type: 'number', value: '5' }])
  })

  it('setTabParams replaces the param array for the tab', () => {
    const id = useQueryStore.getState().openTab({ connectionId: 'c1' })
    useQueryStore.getState().updateTabSql(id, 'WHERE a = {{a}}')
    useQueryStore.getState().setTabParams(id, [{ name: 'a', type: 'boolean', value: 'true' }])
    const tab = useQueryStore.getState().tabs.find((t) => t.id === id)!
    expect(tab.params).toEqual([{ name: 'a', type: 'boolean', value: 'true' }])
  })

  it('syncTabParams reconciles params from current sql, preserving seeded values', () => {
    const id = useQueryStore.getState().openTab({
      connectionId: 'c1',
      sql: 'WHERE a = {{a}} AND b = {{b}}',
      params: [{ name: 'a', type: 'number', value: '9' }],
    })
    useQueryStore.getState().syncTabParams(id)
    const tab = useQueryStore.getState().tabs.find((t) => t.id === id)!
    expect(tab.params).toEqual([
      { name: 'a', type: 'number', value: '9' },
      { name: 'b', type: 'text', value: '' },
    ])
  })
})
```

- [ ] **Step 2: Run test to verify it fails**

Run: `npx vitest run src/__tests__/renderer/store/queryStore.test.ts -t "query params"`
Expected: FAIL — `setTabParams`/`syncTabParams` are not functions; `params` is undefined.

- [ ] **Step 3: Add the reconcile helper and the actions**

In `src/renderer/src/store/queryStore.ts`:

a) Add imports near the top (alongside the existing imports):

```ts
import { extractParams } from '../lib/extractParams'
import type { QueryParam } from '@shared/types'
```

(If `@shared/types` is already imported, add `QueryParam` to that import instead of adding a new line.)

b) Add this module-level helper above `export const useQueryStore = create...`:

```ts
/** Recompute a tab's params from its SQL, preserving existing {type,value} by name. */
function reconcileParams(sql: string, existing: QueryParam[] | undefined): QueryParam[] {
  const prev = new Map((existing ?? []).map((p) => [p.name, p]))
  return extractParams(sql).map((name) => prev.get(name) ?? { name, type: 'text', value: '' })
}
```

c) Add the two action signatures to the store's state interface, next to `updateTabSql`:

```ts
  setTabParams: (id: string, params: QueryParam[]) => void
  syncTabParams: (id: string) => void
```

d) Replace the existing `updateTabSql` implementation:

```ts
  updateTabSql: (id, sql) => {
    set((s) => ({
      tabs: s.tabs.map((t) =>
        t.id === id ? { ...t, sql, params: reconcileParams(sql, t.params) } : t,
      ),
    }))
  },
```

e) Add the two new actions immediately after `updateTabSql`:

```ts
  setTabParams: (id, params) => {
    set((s) => ({ tabs: s.tabs.map((t) => (t.id === id ? { ...t, params } : t)) }))
  },

  syncTabParams: (id) => {
    set((s) => ({
      tabs: s.tabs.map((t) =>
        t.id === id ? { ...t, params: reconcileParams(t.sql, t.params) } : t,
      ),
    }))
  },
```

- [ ] **Step 4: Run test to verify it passes**

Run: `npx vitest run src/__tests__/renderer/store/queryStore.test.ts -t "query params"`
Expected: PASS (4 tests).

- [ ] **Step 5: Commit**

```bash
git add src/renderer/src/store/queryStore.ts src/__tests__/renderer/store/queryStore.test.ts
git commit -m "feat(store): keep tab.params in sync with SQL; add setTabParams/syncTabParams"
```

---

### Task 5: queryStore — substitute params in `runQuery` and `explainQuery`

**Files:**
- Modify: `src/renderer/src/store/queryStore.ts`
- Test: `src/__tests__/renderer/store/queryStore.test.ts`

**Interfaces:**
- Consumes: `substituteParams` (Task 3), `tab.params` (Task 4).
- Produces: `runQuery`/`explainQuery` send the **substituted** SQL; on a substitution error they set `tab.error` and make **no** IPC call.

- [ ] **Step 1: Write the failing test**

Add to the `query params` describe block in `queryStore.test.ts`. The suite stubs `window.api.invoke` via the global setup; assert on its calls:

```ts
  it('runQuery sends substituted SQL through QUERY_EXECUTE', async () => {
    const invoke = vi.mocked(window.api.invoke)
    invoke.mockResolvedValue({ columns: [], rows: [] } as never)
    const id = useQueryStore.getState().openTab({ connectionId: 'c1' })
    useQueryStore.getState().updateTabSql(id, 'SELECT * WHERE c = {{c}}')
    useQueryStore.getState().setTabParams(id, [{ name: 'c', type: 'text', value: 'US' }])
    await useQueryStore.getState().runQuery(id)
    expect(invoke).toHaveBeenCalledWith(
      'query:execute',
      expect.objectContaining({ sql: "SELECT * WHERE c = 'US'", connectionId: 'c1', tabId: id }),
    )
  })

  it('runQuery blocks (sets error, no IPC) when a value is missing', async () => {
    const invoke = vi.mocked(window.api.invoke)
    invoke.mockClear()
    const id = useQueryStore.getState().openTab({ connectionId: 'c1' })
    useQueryStore.getState().updateTabSql(id, 'SELECT * WHERE c = {{c}}')
    await useQueryStore.getState().runQuery(id)
    const tab = useQueryStore.getState().tabs.find((t) => t.id === id)!
    expect(tab.error).toBe('Fill in {{c}} before running.')
    expect(invoke).not.toHaveBeenCalled()
  })

  it('explainQuery sends substituted SQL through QUERY_DRY_RUN', async () => {
    const invoke = vi.mocked(window.api.invoke)
    invoke.mockResolvedValue({ bytesProcessed: 0 } as never)
    const id = useQueryStore.getState().openTab({ connectionId: 'c1' })
    useQueryStore.getState().updateTabSql(id, 'SELECT {{n}}')
    useQueryStore.getState().setTabParams(id, [{ name: 'n', type: 'number', value: '7' }])
    await useQueryStore.getState().explainQuery(id)
    expect(invoke).toHaveBeenCalledWith(
      'query:dry-run',
      expect.objectContaining({ sql: 'SELECT 7', connectionId: 'c1' }),
    )
  })
```

> Note: the literal channel strings are `'query:execute'` and `'query:dry-run'` per `src/shared/ipc.ts`. If the existing test file already imports `CHANNELS`, use `CHANNELS.QUERY_EXECUTE` / `CHANNELS.QUERY_DRY_RUN` instead of the literals to match local style.

- [ ] **Step 2: Run test to verify it fails**

Run: `npx vitest run src/__tests__/renderer/store/queryStore.test.ts -t "query params"`
Expected: FAIL — `runQuery` currently sends the raw `tab.sql` (`{{c}}` not substituted) and does not set `error` on missing value.

- [ ] **Step 3: Add substitution to `runQuery` and `explainQuery`**

In `src/renderer/src/store/queryStore.ts`:

a) Add the import (next to the `extractParams` import from Task 4):

```ts
import { substituteParams } from '../lib/substituteParams'
```

b) In `runQuery`, immediately after the guard `if (!tab || !tab.connectionId || !tab.sql.trim()) return`, insert:

```ts
    const sub = substituteParams(tab.sql, tab.params ?? [])
    if ('error' in sub) {
      set((s) => ({
        tabs: s.tabs.map((t) =>
          t.id === id ? { ...t, error: sub.error, result: undefined, cancelled: false } : t,
        ),
      }))
      return
    }
```

Then change the `QUERY_EXECUTE` invoke to send `sub.sql` instead of `tab.sql`:

```ts
      const result: QueryResult = await window.api.invoke(CHANNELS.QUERY_EXECUTE, {
        connectionId: tab.connectionId, sql: sub.sql, tabId: id,
      })
```

c) In `explainQuery`, immediately after its guard `if (!tab || !tab.connectionId || !tab.sql.trim()) return`, insert:

```ts
    const sub = substituteParams(tab.sql, tab.params ?? [])
    if ('error' in sub) {
      set((s) => ({
        tabs: s.tabs.map((t) => (t.id === id ? { ...t, error: sub.error, isExplaining: false } : t)),
      }))
      return
    }
```

Then change the `QUERY_DRY_RUN` invoke to send `sub.sql`:

```ts
      const result = await window.api.invoke(CHANNELS.QUERY_DRY_RUN, {
        connectionId: tab.connectionId, sql: sub.sql,
      })
```

- [ ] **Step 4: Run the full queryStore suite to verify it passes**

Run: `npx vitest run src/__tests__/renderer/store/queryStore.test.ts`
Expected: PASS — new param tests green and all pre-existing tests still pass (the substitution is a no-op when a tab has no params).

- [ ] **Step 5: Commit**

```bash
git add src/renderer/src/store/queryStore.ts src/__tests__/renderer/store/queryStore.test.ts
git commit -m "feat(store): substitute params in runQuery/explainQuery; block on missing/invalid"
```

---

### Task 6: `ParamsPanel` component + `EditorPane` wiring

**Files:**
- Create: `src/renderer/src/components/editor/ParamsPanel.tsx`
- Modify: `src/renderer/src/components/editor/EditorPane.tsx`

**Interfaces:**
- Consumes: `QueryParam` (Task 1); store action `setTabParams` (Task 4); `tab.params`.
- Produces: a `ParamsPanel` that renders one row per param (name · type select · value input) and calls `onChange(next: QueryParam[])`. EditorPane renders it above `LimitWarningBanner` when `params.length > 0`.

- [ ] **Step 1: Create the `ParamsPanel` component**

Create `src/renderer/src/components/editor/ParamsPanel.tsx`:

```tsx
import type { QueryParam } from '@shared/types'

interface ParamsPanelProps {
  params: QueryParam[]
  onChange: (next: QueryParam[]) => void
}

const TYPES: QueryParam['type'][] = ['text', 'number', 'boolean', 'raw']

/**
 * Inputs row for {{name}} query parameters. Renders one row per param with a
 * type selector and a value input; emits the full updated array on every edit.
 */
export default function ParamsPanel({ params, onChange }: ParamsPanelProps) {
  const update = (name: string, patch: Partial<QueryParam>) =>
    onChange(params.map((p) => (p.name === name ? { ...p, ...patch } : p)))

  return (
    <div className="flex flex-col gap-1.5 px-3 py-2 bg-app-accent-subtle/30 border-b border-app-border shrink-0">
      <span className="app-section-label">Parameters</span>
      <div className="flex flex-col gap-1.5">
        {params.map((p) => (
          <div key={p.name} className="flex items-center gap-2">
            <code className="text-xs text-app-accent-text font-tabular shrink-0 w-40 truncate">
              {`{{${p.name}}}`}
            </code>
            <select
              value={p.type}
              onChange={(e) => update(p.name, { type: e.target.value as QueryParam['type'] })}
              className="text-xs px-1.5 py-1 rounded border border-app-border bg-app-surface text-app-text-2 focus:ring-1 focus:ring-app-accent/30 outline-none"
            >
              {TYPES.map((t) => (
                <option key={t} value={t}>
                  {t}
                </option>
              ))}
            </select>
            {p.type === 'boolean' ? (
              <select
                value={p.value || 'true'}
                onChange={(e) => update(p.name, { value: e.target.value })}
                className="flex-1 text-xs px-2 py-1 rounded border border-app-border bg-app-surface text-app-text focus:ring-1 focus:ring-app-accent/30 outline-none"
              >
                <option value="true">true</option>
                <option value="false">false</option>
              </select>
            ) : (
              <input
                type="text"
                value={p.value}
                onChange={(e) => update(p.name, { value: e.target.value })}
                placeholder={p.type === 'raw' ? 'raw SQL (inserted verbatim)' : `value for ${p.name}`}
                className="flex-1 text-xs px-2 py-1 rounded border border-app-border bg-app-surface text-app-text placeholder:text-app-text-3 focus:ring-1 focus:ring-app-accent/30 outline-none"
              />
            )}
          </div>
        ))}
      </div>
    </div>
  )
}
```

- [ ] **Step 2: Wire it into `EditorPane`**

In `src/renderer/src/components/editor/EditorPane.tsx`:

a) Add the import next to the other component imports:

```ts
import ParamsPanel from './ParamsPanel'
```

b) Add `params` to the `useShallow` selector object (inside the returned object literal, after `connectionId`):

```ts
        params: t?.params ?? [],
```

and add `params` to the destructured names at the top of that block:

```ts
  const { sql, isRunning, isExplaining, savedQueryId, connectionId, params } = useQueryStore(
```

c) Grab the action alongside the other `useQueryStore((s) => s.X)` lines:

```ts
  const setTabParams = useQueryStore((s) => s.setTabParams)
```

d) Render the panel inside the returned fragment, **between** `</QueryEditor>` (the self-closing `<QueryEditor ... />`) and the `{showLimitWarning && ...}` block:

```tsx
      {params.length > 0 && (
        <ParamsPanel params={params} onChange={(next) => setTabParams(tabId, next)} />
      )}
```

- [ ] **Step 3: Typecheck**

Run: `npx tsc --noEmit -p tsconfig.web.json`
Expected: no errors.

- [ ] **Step 4: Manual verification in the running app**

Run: `just dev`
Verify:
1. Type `SELECT * FROM t WHERE c = {{country}}` in a tab → a "Parameters" panel appears with a `{{country}}` row (type `text`, empty value).
2. Leave the value empty and press Run (⌘↵) → results region shows the error "Fill in {{country}} before running." and no query runs.
3. Fill `US`, Run → the executed query uses `c = 'US'` (confirm via results / logs).
4. Change type to `number`, value `5` → runs with `c = 5` (unquoted).
5. Delete the `{{country}}` text → the panel disappears.

- [ ] **Step 5: Commit**

```bash
git add src/renderer/src/components/editor/ParamsPanel.tsx src/renderer/src/components/editor/EditorPane.tsx
git commit -m "feat(editor): ParamsPanel inputs for {{name}} params"
```

---

### Task 7: Persist params with saved queries + restore on open

**Files:**
- Modify: `src/renderer/src/components/editor/SaveQueryModal.tsx`
- Modify: `src/renderer/src/pages/Editor.tsx`
- Modify: `src/renderer/src/components/saved/SavedQueriesPanel.tsx`
- Test: `src/__tests__/renderer/store/queryStore.test.ts`

**Interfaces:**
- Consumes: `tab.params` (Task 4); `syncTabParams` (Task 4); `SavedQuery.params` (Task 1).
- Produces: new-save and update-save both write `params`; opening a saved query seeds `tab.params` from `SavedQuery.params` and reconciles against the SQL.

- [ ] **Step 1: Write the failing test (open-saved seeding)**

Add to the `query params` describe block in `queryStore.test.ts`:

```ts
  it('opening a tab with seeded params + sql reconciles via syncTabParams', () => {
    const id = useQueryStore.getState().openTab({
      connectionId: 'c1',
      sql: 'WHERE a = {{a}} AND b = {{b}}',
      params: [{ name: 'a', type: 'number', value: '3' }],
    })
    useQueryStore.getState().syncTabParams(id)
    const tab = useQueryStore.getState().tabs.find((t) => t.id === id)!
    expect(tab.params).toEqual([
      { name: 'a', type: 'number', value: '3' },
      { name: 'b', type: 'text', value: '' },
    ])
  })
```

(This pins the open-path contract that Step 4 relies on. It passes already given Task 4's `syncTabParams`; run it to confirm before wiring the UI.)

- [ ] **Step 2: Run the test**

Run: `npx vitest run src/__tests__/renderer/store/queryStore.test.ts -t "reconciles via syncTabParams"`
Expected: PASS (confirms the store contract before UI wiring).

- [ ] **Step 3: Write `params` on new save (`SaveQueryModal`)**

In `src/renderer/src/components/editor/SaveQueryModal.tsx`, in `handleSave`, add `params` to the `saveQuery({...})` call:

```ts
      const saved = await saveQuery({
        title: name.trim(),
        sql: tab.sql,
        connectionId: tab.connectionId,
        folderId,
        params: tab.params,
      })
```

- [ ] **Step 4: Write `params` on update save (`Editor.tsx`)**

In `src/renderer/src/pages/Editor.tsx`, in `handleSave`, include the tab's params when updating:

```ts
        await updateQuery({ ...existing, sql: tab.sql, params: tab.params })
```

- [ ] **Step 5: Seed + reconcile params when opening a saved query (`SavedQueriesPanel`)**

In `src/renderer/src/components/saved/SavedQueriesPanel.tsx`:

a) Pull `syncTabParams` from the store alongside `openTab`:

```ts
  const { openTab, syncTabParams } = useQueryStore()
```

b) Update the open handler (currently `openTab({ title: sq.title, sql: sq.sql, connectionId: sq.connectionId, savedQueryId: sq.id })`) to seed params and reconcile:

```ts
    const id = openTab({
      title: sq.title,
      sql: sq.sql,
      connectionId: sq.connectionId,
      savedQueryId: sq.id,
      params: sq.params,
    })
    syncTabParams(id)
```

- [ ] **Step 6: Typecheck + run the store suite**

Run: `npx tsc --noEmit -p tsconfig.web.json && npx vitest run src/__tests__/renderer/store/queryStore.test.ts`
Expected: no type errors; all queryStore tests PASS.

- [ ] **Step 7: Manual verification**

Run: `just dev`
Verify:
1. Write `WHERE c = {{country}}`, set type `text` value `US`, save the query (⌘S → name it).
2. Close the tab; reopen the query from the Saved panel → the Parameters panel reappears pre-filled with `country = US`, ready to run.
3. Add `{{extra}}` to a saved query's SQL and reopen → `extra` shows up (type `text`, empty) alongside the persisted `country`.

- [ ] **Step 8: Commit**

```bash
git add src/renderer/src/components/editor/SaveQueryModal.tsx src/renderer/src/pages/Editor.tsx src/renderer/src/components/saved/SavedQueriesPanel.tsx src/__tests__/renderer/store/queryStore.test.ts
git commit -m "feat(saved): persist query params and restore them on open"
```

---

### Task 8: Docs — README, CHANGELOG, CLAUDE.md change-log

**Files:**
- Modify: `README.md`
- Modify: `CHANGELOG.md`
- Modify: `CLAUDE.md`

**Interfaces:**
- Consumes: the shipped feature.
- Produces: user + changelog documentation.

- [ ] **Step 1: README — document query parameters**

In `README.md`, under the query-editor feature section, add a short subsection:

```markdown
### Query parameters

Write `{{name}}` anywhere in a query to turn it into a reusable parameter. An inputs
panel appears above the results with one row per parameter — pick a type (Text, Number,
Boolean, or Raw) and enter a value. Values are substituted into the SQL when you Run or
Explain. Text values are quoted and escaped; Raw is inserted verbatim (for identifiers or
`IN (...)` lists). Saving a query remembers each parameter's type and last value.
```

- [ ] **Step 2: CHANGELOG — add an Unreleased entry**

In `CHANGELOG.md`, under `## [Unreleased]` → `### Added`:

```markdown
- Query parameters: write `{{name}}` placeholders, fill values in an inputs panel (Text /
  Number / Boolean / Raw), and run with type-aware substitution. Types and values persist
  with saved queries.
```

- [ ] **Step 3: CLAUDE.md — append a change-log entry**

Add a dated entry to the Change Log section of `CLAUDE.md` (top of the list, matching the existing format) summarizing: the feature, the client-side-substitution approach, the two `lib/` helpers + reconcile, the `runQuery`/`explainQuery` substitution + block-on-error, `ParamsPanel`, persistence on `SavedQuery`, and the test additions. Include the **Files affected** list.

- [ ] **Step 4: Run the full CI gate**

Run: `just ci`
Expected: typecheck clean; all tests pass; coverage gate holds (new `lib/` helpers are covered by Tasks 2–3; `renderer/src/lib` group stays ≥70%).

- [ ] **Step 5: Commit**

```bash
git add README.md CHANGELOG.md CLAUDE.md
git commit -m "docs: query parameters ({{name}})"
```

---

## Self-Review Notes

- **Spec coverage:** syntax `{{name}}` (Tasks 2/3 regex + Global Constraints); explicit types text/number/boolean/raw with quoting rules (Task 3); empty-value blocks for text/number/boolean, raw empty allowed (Task 3 tests); detection ignores comments/strings (Task 2); reconcile preserves by name (Task 4); substitute in runQuery + explainQuery + block-on-error (Task 5); inputs panel in the limit-banner slot (Task 6); persistence on QueryTab + SavedQuery + restore on open (Tasks 1/7); testing (Tasks 2–5, 7). All spec sections map to a task.
- **No IPC/main changes:** confirmed — `SAVED_QUERY_SAVE`/`UPDATE` handlers spread `...req`, so `params` persists with no main-process edit; `QUERY_EXECUTE`/`QUERY_DRY_RUN` receive the already-substituted SQL string.
- **Type consistency:** `QueryParam` shape and the action names `setTabParams` / `syncTabParams` / `reconcileParams` are used identically across Tasks 4–7. `substituteParams` takes `QueryParam[]` (not a Record) — a deliberate refinement of the spec's signature to match `tab.params`'s native shape; behavior is unchanged.
- **Deliberate refinement vs spec:** param sync runs synchronously inside `updateTabSql` (not a debounced hook) because it is pure local string parsing with no IPC — simpler and gives a live-updating panel. The spec's "debounced, mirroring useSchemaPrefetch" was motivated by IPC cost that does not exist here.
