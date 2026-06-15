# Better SQL Autocomplete Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Make SQL autocomplete genuinely useful and instant — columns for any referenced table (not just opened ones), alias + CTE awareness, and auto-opening suggestions with no lag.

**Architecture:** Three pieces around the existing `@codemirror/lang-sql`: (1) two pure parsers — `extractTableRefs` (which tables a query references) and `extractCteCompletions` (CTE names + output columns); (2) `lib/sqlCompletion.ts` that builds the lang-sql `LanguageSupport` and layers a custom CTE completion source onto it; (3) `useSchemaPrefetch`, a debounced hook that background-loads column schemas for referenced tables so completions actually have data. No Zustand store API change.

**Tech Stack:** React 18, `@codemirror/lang-sql` 6.10, `@codemirror/autocomplete` 6.x, `@uiw/react-codemirror`, Zustand, Vitest + jsdom.

---

## File Structure

| File | Responsibility | Change |
|---|---|---|
| `src/renderer/src/lib/extractTableRefs.ts` | pure: SQL → `{ name, alias? }[]` referenced tables | create |
| `src/renderer/src/lib/extractCteCompletions.ts` | pure: SQL → `{ name, columns }[]` + `cteCompletionOptions(sql, textBefore)` | create |
| `src/renderer/src/lib/buildTableLookup.ts` | pure: catalog tables → name→ids Map | create |
| `src/renderer/src/lib/sqlCompletion.ts` | build lang-sql support + CTE completion source | create |
| `src/renderer/src/hooks/useSchemaPrefetch.ts` | debounced prefetch of referenced-table schemas | create |
| `src/renderer/src/components/editor/QueryEditor.tsx` | use `sqlSupport()` + `autocompletion(...)` in memoized extensions (SQL only) | modify |
| `src/renderer/src/pages/Editor.tsx` | call `useSchemaPrefetch(activeTab.sql, activeConnectionId)` | modify |
| `src/__tests__/renderer/lib/extractTableRefs.test.ts` | tests | create |
| `src/__tests__/renderer/lib/extractCteCompletions.test.ts` | tests | create |
| `src/__tests__/renderer/lib/buildTableLookup.test.ts` | tests | create |

**TDD core:** the three pure libs (`extractTableRefs`, `extractCteCompletions` incl. `cteCompletionOptions`, `buildTableLookup`). The completion source, the hook, and the QueryEditor/Editor wiring are verified by typecheck/build + manual React-DevTools/typing checks (CodeMirror `CompletionContext` is impractical to unit-test reliably).

---

## Task 1: Branch off master

**Files:** none (git)

- [ ] **Step 1: Create the branch**

The design spec + this plan live under `docs/superpowers/`. Create the feature branch from the current `master` tip (which already contains the merged Neo4j work):

```bash
git checkout master
git checkout -b feat/sql-autocomplete
```
Expected: `Switched to a new branch 'feat/sql-autocomplete'`.

> If the spec (`docs/superpowers/specs/2026-06-14-sql-autocomplete-design.md`) and this plan are not present on the new branch (they were committed on another branch), bring them over before continuing:
> `git checkout <branch-with-docs> -- docs/superpowers/specs/2026-06-14-sql-autocomplete-design.md docs/superpowers/plans/2026-06-14-sql-autocomplete.md && git commit -m "docs: bring sql-autocomplete spec + plan onto branch"`

- [ ] **Step 2: Confirm clean baseline**

Run: `npm run typecheck && npx vitest run`
Expected: typecheck clean; all existing tests pass (the baseline before changes).

---

## Task 2: `extractTableRefs` parser (TDD)

**Files:**
- Create: `src/renderer/src/lib/extractTableRefs.ts`
- Test: `src/__tests__/renderer/lib/extractTableRefs.test.ts`

- [ ] **Step 1: Write the failing test**

Create `src/__tests__/renderer/lib/extractTableRefs.test.ts`:

```ts
import { describe, it, expect } from 'vitest'
import { extractTableRefs } from '../../../renderer/src/lib/extractTableRefs'

describe('extractTableRefs', () => {
  it('finds a bare table after FROM', () => {
    expect(extractTableRefs('SELECT * FROM users')).toEqual([{ name: 'users' }])
  })

  it('finds a qualified dataset.table', () => {
    expect(extractTableRefs('SELECT * FROM analytics.users')).toEqual([{ name: 'analytics.users' }])
  })

  it('captures a bare alias and an AS alias', () => {
    expect(extractTableRefs('SELECT * FROM users u')).toEqual([{ name: 'users', alias: 'u' }])
    expect(extractTableRefs('SELECT * FROM users AS u')).toEqual([{ name: 'users', alias: 'u' }])
  })

  it('finds tables across JOINs', () => {
    const out = extractTableRefs('SELECT * FROM a JOIN b ON a.id = b.id LEFT JOIN c ON c.x = a.x')
    expect(out).toEqual([{ name: 'a' }, { name: 'b' }, { name: 'c' }])
  })

  it('handles UPDATE and INSERT INTO', () => {
    expect(extractTableRefs('UPDATE orders SET x = 1')).toEqual([{ name: 'orders' }])
    expect(extractTableRefs('INSERT INTO logs (a) VALUES (1)')).toEqual([{ name: 'logs' }])
  })

  it('does not treat the word after FROM as alias when it is a keyword', () => {
    expect(extractTableRefs('SELECT * FROM users WHERE id = 1')).toEqual([{ name: 'users' }])
    expect(extractTableRefs('SELECT * FROM users GROUP BY id')).toEqual([{ name: 'users' }])
  })

  it('ignores table-like text inside strings and comments', () => {
    expect(extractTableRefs("SELECT 'FROM ghost' FROM users")).toEqual([{ name: 'users' }])
    expect(extractTableRefs('-- FROM ghost\nSELECT * FROM users')).toEqual([{ name: 'users' }])
  })

  it('returns empty for partial / non-FROM SQL without throwing', () => {
    expect(extractTableRefs('SELECT ')).toEqual([])
    expect(extractTableRefs('FROM ')).toEqual([])
    expect(extractTableRefs('')).toEqual([])
  })
})
```

- [ ] **Step 2: Run the test to verify it fails**

Run: `npx vitest run src/__tests__/renderer/lib/extractTableRefs.test.ts`
Expected: FAIL — `Cannot find module '.../extractTableRefs'`.

- [ ] **Step 3: Implement**

Create `src/renderer/src/lib/extractTableRefs.ts`:

```ts
export interface TableRef {
  name: string
  alias?: string
}

// Keywords that may immediately follow a table name and must NOT be read as an alias.
const ALIAS_STOPWORDS = new Set([
  'ON', 'USING', 'WHERE', 'GROUP', 'ORDER', 'LIMIT', 'HAVING', 'JOIN', 'LEFT', 'RIGHT',
  'INNER', 'OUTER', 'FULL', 'CROSS', 'UNION', 'SET', 'VALUES', 'SELECT', 'WITH', 'AND',
  'OR', 'AS', 'OFFSET', 'WINDOW', 'QUALIFY', 'INTO',
])

// Keywords that introduce a table reference.
const INTRO = /\b(from|join|update|into)\b/gi

/**
 * Strip line/block comments and single/double-quoted strings, replacing each
 * with a space so token boundaries are preserved.
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

/**
 * Extract the tables a SQL statement references, with optional aliases.
 * Heuristic (not a full parser): scans for FROM / JOIN / UPDATE / INTO and reads
 * the following dotted identifier as the table name, plus an optional alias.
 * Tolerant of partial / mid-typing SQL — never throws.
 */
export function extractTableRefs(sql: string): TableRef[] {
  const cleaned = stripNoise(sql)
  const refs: TableRef[] = []
  const seen = new Set<string>()

  // identifier (optionally dotted, optionally quoted segments already stripped)
  const ident = '[A-Za-z_][A-Za-z0-9_]*(?:\\.[A-Za-z_][A-Za-z0-9_]*)*'
  const aliasIdent = '[A-Za-z_][A-Za-z0-9_]*'
  const re = new RegExp(
    `\\b(?:from|join|update|into)\\s+(${ident})(?:\\s+(?:as\\s+)?(${aliasIdent}))?`,
    'gi',
  )
  INTRO.lastIndex = 0

  let m: RegExpExecArray | null
  while ((m = re.exec(cleaned)) !== null) {
    const name = m[1]
    const aliasCandidate = m[2]
    const alias =
      aliasCandidate && !ALIAS_STOPWORDS.has(aliasCandidate.toUpperCase())
        ? aliasCandidate
        : undefined
    const key = `${name.toLowerCase()}|${alias?.toLowerCase() ?? ''}`
    if (seen.has(key)) continue
    seen.add(key)
    refs.push(alias ? { name, alias } : { name })
  }
  return refs
}
```

- [ ] **Step 4: Run the test to verify it passes**

Run: `npx vitest run src/__tests__/renderer/lib/extractTableRefs.test.ts`
Expected: PASS (8 tests).

- [ ] **Step 5: Commit**

```bash
git add src/renderer/src/lib/extractTableRefs.ts src/__tests__/renderer/lib/extractTableRefs.test.ts
git commit -m "✨ feat(editor): extractTableRefs SQL parser for autocomplete prefetch

Co-Authored-By: Claude Opus 4.8 <noreply@anthropic.com>"
```

---

## Task 3: `extractCteCompletions` + `cteCompletionOptions` (TDD)

**Files:**
- Create: `src/renderer/src/lib/extractCteCompletions.ts`
- Test: `src/__tests__/renderer/lib/extractCteCompletions.test.ts`

- [ ] **Step 1: Write the failing test**

Create `src/__tests__/renderer/lib/extractCteCompletions.test.ts`:

```ts
import { describe, it, expect } from 'vitest'
import { extractCteCompletions, cteCompletionOptions } from '../../../renderer/src/lib/extractCteCompletions'

describe('extractCteCompletions', () => {
  it('parses a single CTE with simple columns', () => {
    const sql = 'WITH t AS (SELECT a, b FROM x) SELECT * FROM t'
    expect(extractCteCompletions(sql)).toEqual([{ name: 't', columns: ['a', 'b'] }])
  })

  it('uses AS aliases and trailing identifiers for column names', () => {
    const sql = 'WITH t AS (SELECT count(*) AS total, u.name FROM users u) SELECT * FROM t'
    expect(extractCteCompletions(sql)).toEqual([{ name: 't', columns: ['total', 'name'] }])
  })

  it('parses multiple CTEs', () => {
    const sql = 'WITH a AS (SELECT x FROM p), b AS (SELECT y FROM q) SELECT * FROM a'
    expect(extractCteCompletions(sql)).toEqual([
      { name: 'a', columns: ['x'] },
      { name: 'b', columns: ['y'] },
    ])
  })

  it('returns name with no columns for SELECT *', () => {
    const sql = 'WITH t AS (SELECT * FROM x) SELECT * FROM t'
    expect(extractCteCompletions(sql)).toEqual([{ name: 't', columns: [] }])
  })

  it('does not choke on nested parentheses in the body', () => {
    const sql = 'WITH t AS (SELECT coalesce(a, (b + 1)) AS c FROM x) SELECT * FROM t'
    expect(extractCteCompletions(sql)).toEqual([{ name: 't', columns: ['c'] }])
  })

  it('returns [] for SQL without a WITH clause', () => {
    expect(extractCteCompletions('SELECT * FROM users')).toEqual([])
    expect(extractCteCompletions('')).toEqual([])
  })
})

describe('cteCompletionOptions', () => {
  const sql = 'WITH t AS (SELECT a, b FROM x) SELECT  FROM t'

  it('offers a CTE column when completing after "cte."', () => {
    const opts = cteCompletionOptions(sql, 't.')
    expect(opts.map((o) => o.label).sort()).toEqual(['a', 'b'])
  })

  it('offers CTE names in a general position', () => {
    const opts = cteCompletionOptions(sql, 'FROM ')
    expect(opts.map((o) => o.label)).toContain('t')
  })

  it('returns [] when after an unknown alias dot', () => {
    expect(cteCompletionOptions(sql, 'zzz.')).toEqual([])
  })
})
```

- [ ] **Step 2: Run the test to verify it fails**

Run: `npx vitest run src/__tests__/renderer/lib/extractCteCompletions.test.ts`
Expected: FAIL — module not found.

- [ ] **Step 3: Implement**

Create `src/renderer/src/lib/extractCteCompletions.ts`:

```ts
export interface CteDef {
  name: string
  columns: string[]
}

export interface CteOption {
  label: string
  type: string
}

/** Find the matching close paren index for an open paren at `open`. */
function matchParen(s: string, open: number): number {
  let depth = 0
  for (let i = open; i < s.length; i++) {
    if (s[i] === '(') depth++
    else if (s[i] === ')') {
      depth--
      if (depth === 0) return i
    }
  }
  return -1
}

/** Split a select list on top-level commas (depth 0). */
function splitTopLevel(list: string): string[] {
  const parts: string[] = []
  let depth = 0
  let start = 0
  for (let i = 0; i < list.length; i++) {
    const c = list[i]
    if (c === '(') depth++
    else if (c === ')') depth--
    else if (c === ',' && depth === 0) {
      parts.push(list.slice(start, i))
      start = i + 1
    }
  }
  parts.push(list.slice(start))
  return parts.map((p) => p.trim()).filter(Boolean)
}

/** Derive an output column name from a select-list item, or null if not derivable. */
function columnNameFromItem(item: string): string | null {
  // explicit alias: "... AS name" or "... name" (trailing identifier)
  const asMatch = /\bas\s+([A-Za-z_][A-Za-z0-9_]*)\s*$/i.exec(item)
  if (asMatch) return asMatch[1]
  // trailing bare identifier (e.g. "u.name" -> "name", "a" -> "a")
  const tail = /([A-Za-z_][A-Za-z0-9_]*)\s*$/.exec(item)
  if (!tail) return null
  // a function call like count(*) with no alias has trailing ")" -> tail won't match; null
  return tail[1]
}

/**
 * Parse top-level CTEs from a `WITH name AS ( SELECT … ) [, name2 AS (…)]` clause.
 * Best-effort: top-level CTE list only (no nested/recursive scoping). Never throws.
 */
export function extractCteCompletions(sql: string): CteDef[] {
  const withIdx = /\bwith\b/i.exec(sql)
  if (!withIdx) return []
  const defs: CteDef[] = []
  let cursor = withIdx.index + withIdx[0].length

  // Repeatedly match "name AS ( … )" starting at cursor, separated by commas.
  const nameRe = /\s*([A-Za-z_][A-Za-z0-9_]*)\s+as\s*\(/iy
  while (cursor < sql.length) {
    nameRe.lastIndex = cursor
    const m = nameRe.exec(sql)
    if (!m) break
    const name = m[1]
    const open = nameRe.lastIndex - 1 // the '(' just consumed
    const close = matchParen(sql, open)
    if (close === -1) break
    const body = sql.slice(open + 1, close)

    // Extract the first SELECT's select list (between SELECT and FROM at depth 0).
    let columns: string[] = []
    const selMatch = /\bselect\b/i.exec(body)
    if (selMatch) {
      const afterSelect = body.slice(selMatch.index + selMatch[0].length)
      const fromMatch = /\bfrom\b/i.exec(afterSelect)
      const listText = fromMatch ? afterSelect.slice(0, fromMatch.index) : afterSelect
      if (!/^\s*\*\s*$/.test(listText)) {
        columns = splitTopLevel(listText)
          .map(columnNameFromItem)
          .filter((c): c is string => c !== null)
      }
    }
    defs.push({ name, columns })

    // Advance past close paren and an optional comma to the next CTE.
    cursor = close + 1
    const comma = /^\s*,/.exec(sql.slice(cursor))
    if (!comma) break
    cursor += comma[0].length
  }
  return defs
}

/**
 * Given the document and the text immediately before the cursor, return CTE-based
 * completion options: a CTE's columns when `textBefore` ends with `cteName.`,
 * otherwise the CTE names (offered where a table is expected).
 */
export function cteCompletionOptions(sql: string, textBefore: string): CteOption[] {
  const defs = extractCteCompletions(sql)
  if (defs.length === 0) return []

  const dotMatch = /([A-Za-z_][A-Za-z0-9_]*)\.\s*[A-Za-z0-9_]*$/.exec(textBefore)
  if (dotMatch) {
    const cte = defs.find((d) => d.name.toLowerCase() === dotMatch[1].toLowerCase())
    if (!cte) return []
    return cte.columns.map((c) => ({ label: c, type: 'property' }))
  }
  return defs.map((d) => ({ label: d.name, type: 'class' }))
}
```

- [ ] **Step 4: Run the test to verify it passes**

Run: `npx vitest run src/__tests__/renderer/lib/extractCteCompletions.test.ts`
Expected: PASS (9 tests).

> If `columnNameFromItem` returns a wrong value for `count(*) AS total` (it should hit the `AS` branch first → `total`) or for `u.name` (no AS → trailing identifier `name`), re-check the regex order: the `AS` branch must run before the trailing-identifier branch. The provided code already orders them correctly.

- [ ] **Step 5: Commit**

```bash
git add src/renderer/src/lib/extractCteCompletions.ts src/__tests__/renderer/lib/extractCteCompletions.test.ts
git commit -m "✨ feat(editor): extractCteCompletions + cteCompletionOptions

Co-Authored-By: Claude Opus 4.8 <noreply@anthropic.com>"
```

---

## Task 4: `buildTableLookup` (TDD)

**Files:**
- Create: `src/renderer/src/lib/buildTableLookup.ts`
- Test: `src/__tests__/renderer/lib/buildTableLookup.test.ts`

- [ ] **Step 1: Write the failing test**

Create `src/__tests__/renderer/lib/buildTableLookup.test.ts`:

```ts
import { describe, it, expect } from 'vitest'
import { buildTableLookup } from '../../../renderer/src/lib/buildTableLookup'
import type { Table } from '../../../shared/types'

const t = (over: Partial<Table>): Table => ({
  id: 'users', datasetId: 'analytics', projectId: 'proj', name: 'users', type: 'TABLE', ...over,
})

describe('buildTableLookup', () => {
  it('maps bare and qualified names (case-insensitive) to ids', () => {
    const tablesByDataset = {
      'conn1:analytics': [t({})],
    }
    const lookup = buildTableLookup('conn1', tablesByDataset)
    expect(lookup.get('users')).toEqual({ projectId: 'proj', datasetId: 'analytics', tableId: 'users' })
    expect(lookup.get('analytics.users')).toEqual({ projectId: 'proj', datasetId: 'analytics', tableId: 'users' })
    expect(lookup.get('USERS')).toBeUndefined() // keys are lowercased; caller lowercases lookups
  })

  it('only includes tables for the given connection', () => {
    const tablesByDataset = {
      'conn1:analytics': [t({})],
      'conn2:other': [t({ datasetId: 'other', name: 'ghost', id: 'ghost' })],
    }
    const lookup = buildTableLookup('conn1', tablesByDataset)
    expect(lookup.get('ghost')).toBeUndefined()
    expect([...lookup.keys()]).toContain('users')
  })

  it('returns an empty map when nothing is loaded', () => {
    expect(buildTableLookup('conn1', {}).size).toBe(0)
  })
})
```

- [ ] **Step 2: Run the test to verify it fails**

Run: `npx vitest run src/__tests__/renderer/lib/buildTableLookup.test.ts`
Expected: FAIL — module not found.

- [ ] **Step 3: Implement**

Create `src/renderer/src/lib/buildTableLookup.ts`:

```ts
import type { Table } from '@shared/types'

export interface TableLocation {
  projectId: string
  datasetId: string
  tableId: string
}

/**
 * Build a case-insensitive lookup from table reference names to catalog ids,
 * for tables already loaded under the given connection. Both the bare name
 * (`users`) and the qualified name (`dataset.users`) are registered (lowercased).
 * Keys collide last-write-wins; that's acceptable for prefetch resolution.
 */
export function buildTableLookup(
  connectionId: string,
  tablesByDataset: Record<string, Table[]>,
): Map<string, TableLocation> {
  const map = new Map<string, TableLocation>()
  const prefix = `${connectionId}:`
  for (const [key, tables] of Object.entries(tablesByDataset)) {
    if (!key.startsWith(prefix)) continue
    for (const tbl of tables) {
      const loc: TableLocation = {
        projectId: tbl.projectId,
        datasetId: tbl.datasetId,
        tableId: tbl.id,
      }
      map.set(tbl.name.toLowerCase(), loc)
      map.set(`${tbl.datasetId}.${tbl.name}`.toLowerCase(), loc)
    }
  }
  return map
}
```

- [ ] **Step 4: Run the test to verify it passes**

Run: `npx vitest run src/__tests__/renderer/lib/buildTableLookup.test.ts`
Expected: PASS (3 tests).

- [ ] **Step 5: Commit**

```bash
git add src/renderer/src/lib/buildTableLookup.ts src/__tests__/renderer/lib/buildTableLookup.test.ts
git commit -m "✨ feat(editor): buildTableLookup catalog name→ids resolver

Co-Authored-By: Claude Opus 4.8 <noreply@anthropic.com>"
```

---

## Task 5: `sqlCompletion.ts` — lang-sql support + CTE source

**Files:**
- Create: `src/renderer/src/lib/sqlCompletion.ts`

- [ ] **Step 1: Create the module**

Create `src/renderer/src/lib/sqlCompletion.ts`:

```ts
import { sql, PostgreSQL, StandardSQL } from '@codemirror/lang-sql'
import type { Completion, CompletionContext, CompletionResult } from '@codemirror/autocomplete'
import type { Extension } from '@codemirror/state'
import type { ConnectionEngine } from '@shared/types'
import { cteCompletionOptions } from './extractCteCompletions'

const CM_DIALECT_MAP = {
  bigquery: StandardSQL,
  postgres: PostgreSQL,
  snowflake: StandardSQL,
  neo4j: StandardSQL, // unused — Cypher uses its own StreamLanguage
} satisfies Record<ConnectionEngine, typeof StandardSQL>

/**
 * Completion source for CTE names + their output columns, derived live from the
 * document. Layered on top of lang-sql's schema source (both contribute).
 */
function cteSource(context: CompletionContext): CompletionResult | null {
  const word = context.matchBefore(/[\w.]*/)
  if (!word || (word.from === word.to && !context.explicit)) return null
  const doc = context.state.doc.toString()
  const textBefore = doc.slice(0, context.pos)
  const options = cteCompletionOptions(doc, textBefore)
  if (options.length === 0) return null
  // When completing after "alias.", replace only the part after the dot.
  const dot = word.text.lastIndexOf('.')
  const from = dot === -1 ? word.from : word.from + dot + 1
  return {
    from,
    options: options.map((o): Completion => ({ label: o.label, type: o.type })),
    validFor: /^[\w]*$/,
  }
}

/**
 * Build the SQL language support for a given engine + schema, with lang-sql's
 * schema-aware completion (tables, columns, FROM-alias resolution) plus the
 * custom CTE source layered in via language data.
 */
export function sqlSupport(
  engine: ConnectionEngine | undefined,
  sqlSchema: Record<string, string[]> | undefined,
): Extension {
  const base = sql({
    dialect: engine ? CM_DIALECT_MAP[engine] : StandardSQL,
    schema: sqlSchema ?? {},
    upperCaseKeywords: true,
  })
  return [base, base.language.data.of({ autocomplete: cteSource })]
}
```

- [ ] **Step 2: Typecheck**

Run: `npm run typecheck:web`
Expected: PASS. If `CompletionResult`/`Completion` type imports error, confirm they come from `@codemirror/autocomplete` (they do in 6.x).

- [ ] **Step 3: Commit**

```bash
git add src/renderer/src/lib/sqlCompletion.ts
git commit -m "✨ feat(editor): sqlSupport — lang-sql schema completion + CTE source

Co-Authored-By: Claude Opus 4.8 <noreply@anthropic.com>"
```

---

## Task 6: `useSchemaPrefetch` hook

**Files:**
- Create: `src/renderer/src/hooks/useSchemaPrefetch.ts`

- [ ] **Step 1: Create the hook**

Create `src/renderer/src/hooks/useSchemaPrefetch.ts`:

```ts
import { useEffect } from 'react'
import { useCatalogStore } from '../store/catalogStore'
import { extractTableRefs } from '../lib/extractTableRefs'
import { buildTableLookup } from '../lib/buildTableLookup'

const DEBOUNCE_MS = 250
const MAX_CONCURRENT = 5

/** Run async tasks with a concurrency cap; resolves when all settle. */
async function runCapped<T>(items: T[], limit: number, fn: (item: T) => Promise<void>): Promise<void> {
  const queue = [...items]
  const workers = Array.from({ length: Math.min(limit, queue.length) }, async () => {
    while (queue.length) {
      const item = queue.shift()!
      await fn(item)
    }
  })
  await Promise.all(workers)
}

/**
 * Debounced background prefetch of column schemas for tables referenced in `sql`.
 * Resolves referenced names against already-loaded catalog table lists and calls
 * loadSchema for any not yet cached. Per-table errors are swallowed so one
 * inaccessible table never blocks completion for the rest. No-ops when there is
 * no connection or SQL.
 */
export function useSchemaPrefetch(sql: string, connectionId: string | undefined): void {
  // Subscribe to the table-list map so the resolver picks up newly expanded
  // datasets; read schemaCache + loadSchema lazily from the store to avoid
  // re-running on every cache write.
  const tablesByDataset = useCatalogStore((s) => s.tablesByDataset)

  useEffect(() => {
    if (!connectionId || !sql.trim()) return
    const handle = setTimeout(() => {
      const refs = extractTableRefs(sql)
      if (refs.length === 0) return
      const lookup = buildTableLookup(connectionId, tablesByDataset)
      const { schemaCache, loadSchema } = useCatalogStore.getState()
      const targets = refs
        .map((r) => lookup.get(r.name.toLowerCase()))
        .filter((loc): loc is NonNullable<typeof loc> => !!loc)
        .filter((loc) => !schemaCache[`${connectionId}:${loc.datasetId}:${loc.tableId}`])
      // De-dupe by cache key.
      const seen = new Set<string>()
      const unique = targets.filter((loc) => {
        const k = `${loc.datasetId}:${loc.tableId}`
        if (seen.has(k)) return false
        seen.add(k)
        return true
      })
      if (unique.length === 0) return
      void runCapped(unique, MAX_CONCURRENT, (loc) =>
        loadSchema(connectionId, loc.projectId, loc.datasetId, loc.tableId)
          .then(() => undefined)
          .catch(() => undefined),
      )
    }, DEBOUNCE_MS)
    return () => clearTimeout(handle)
  }, [sql, connectionId, tablesByDataset])
}
```

- [ ] **Step 2: Typecheck**

Run: `npm run typecheck:web`
Expected: PASS. (`loadSchema` signature is `(connectionId, projectId, datasetId, tableId) => Promise<TableField[]>`; the `.then(() => undefined)` adapts it to the `Promise<void>` expected by `runCapped`.)

- [ ] **Step 3: Commit**

```bash
git add src/renderer/src/hooks/useSchemaPrefetch.ts
git commit -m "✨ feat(editor): useSchemaPrefetch — debounced referenced-table schema prefetch

Co-Authored-By: Claude Opus 4.8 <noreply@anthropic.com>"
```

---

## Task 7: Wire into `QueryEditor` + `Editor`

**Files:**
- Modify: `src/renderer/src/components/editor/QueryEditor.tsx`
- Modify: `src/renderer/src/pages/Editor.tsx`

- [ ] **Step 1: Use `sqlSupport()` + `autocompletion()` in QueryEditor**

In `src/renderer/src/components/editor/QueryEditor.tsx`:

a) Add imports after the existing `cypher` import (line ~10):

```ts
import { autocompletion } from '@codemirror/autocomplete'
import { sqlSupport } from '../../lib/sqlCompletion'
```

b) Replace the `languageExtension` memo (lines 60-67) — keep the Cypher branch, route SQL engines through `sqlSupport`:

```ts
  const languageExtension = useMemo(() => {
    if (engine === 'neo4j') return cypher(cypherSchema)
    return sqlSupport(engine, sqlSchema)
  }, [sqlSchema, cypherSchema, engine])
```

c) Add a stable autocompletion config extension. After the `extensions` memo that the responsiveness refactor added (the one returning `[languageExtension, keymapExtension, customTheme]`), include the autocompletion tuning. Replace that memo with:

```ts
  const extensions = useMemo(
    () => [
      languageExtension,
      keymapExtension,
      customTheme,
      autocompletion({ activateOnTyping: true, defaultKeymap: true, icons: true }),
    ],
    [languageExtension, keymapExtension],
  )
```

> `sql(...)`/`StandardSQL` are still imported and used inside `sqlSupport` now, but `QueryEditor` no longer calls `sql()` directly. Remove the now-unused `sql` import from `@codemirror/lang-sql` in QueryEditor **only if** typecheck flags it as unused; `PostgreSQL`/`StandardSQL` are also only used by the (now-removed) inline config — if `CM_DIALECT_MAP` in QueryEditor becomes unused, remove it too. Run typecheck (Step 3) and delete exactly what it reports as unused, nothing more.

- [ ] **Step 2: Call `useSchemaPrefetch` from Editor**

In `src/renderer/src/pages/Editor.tsx`:

a) Add the import near the other hook/lib imports:

```ts
import { useSchemaPrefetch } from '../hooks/useSchemaPrefetch'
```

b) After `const activeTab = useQueryStore(...)` / the `activeTab` derivation, add:

```ts
  // Background-prefetch column schemas for tables referenced in the active query
  // so SQL autocomplete has columns even for tables the user hasn't opened.
  useSchemaPrefetch(activeTab?.sql ?? '', activeConnectionId ?? undefined)
```

- [ ] **Step 3: Typecheck**

Run: `npm run typecheck`
Expected: PASS. Remove any binding typecheck reports as unused in `QueryEditor.tsx` (per the note in Step 1c).

- [ ] **Step 4: Full suite + build**

Run: `npx vitest run`
Expected: PASS (existing tests + the new lib tests; no store API change).

Run: `npm run build`
Expected: completes without error.

- [ ] **Step 5: Commit**

```bash
git add src/renderer/src/components/editor/QueryEditor.tsx src/renderer/src/pages/Editor.tsx
git commit -m "✨ feat(editor): wire CTE-aware completion + schema prefetch + auto-trigger

QueryEditor routes SQL engines through sqlSupport() (lang-sql schema
completion + CTE source) and adds autocompletion({ activateOnTyping }).
Editor calls useSchemaPrefetch for the active tab. Cypher path unchanged.

Co-Authored-By: Claude Opus 4.8 <noreply@anthropic.com>"
```

---

## Task 8: Manual verification + docs

**Files:**
- Modify: `README.md` (optional), `CHANGELOG.md`, `CLAUDE.md`

- [ ] **Step 1: Manual verification (run the app)**

Run `just dev`, connect to a SQL engine (BigQuery/Postgres/Snowflake), expand a dataset so its table list loads, then:
1. In a new query type `SELECT  FROM <dataset>.<table>` (a table you did NOT open). After ~250 ms, put the cursor in the SELECT list and confirm the table's **columns** appear in autocomplete (prefetch worked).
2. Type `FROM users u` then `u.` → confirm `users`' columns complete.
3. Type `WITH t AS (SELECT id, name FROM users) SELECT  FROM t`, then complete after `t.` → confirm `id`, `name`.
4. Confirm the popup auto-opens while typing an identifier and right after `.`; Tab/Enter accept, Esc dismisses; no perceptible lag.
5. Switch to a Neo4j connection → confirm Cypher completion (labels/types/properties) still works unchanged.

Record the observations in the PR description.

- [ ] **Step 2: Update CHANGELOG**

Under `## [Unreleased]` in `CHANGELOG.md` (create it above the latest version if absent):

```markdown
### Changed
- **Smarter SQL autocomplete** — column suggestions now appear for any table referenced in the query (a background prefetch loads referenced tables' schemas, so you no longer have to open a table first), `alias.` and CTE (`WITH t AS (…)` → `t.`) completions resolve to the right columns, and suggestions auto-open as you type and on `.` with no lag. Completion stays fully local/instant. Cypher completion is unchanged.
```

- [ ] **Step 3: Add the CLAUDE.md change-log entry**

Insert at the top of the entries (newest first) in `CLAUDE.md`:

```markdown
### [2026-06-14] Feature: Smarter SQL autocomplete

**Type:** Change
**Context:** SQL autocomplete only knew columns for tables the user had manually opened (the `sqlSchema` fed to `@codemirror/lang-sql` was built from `catalogStore.schemaCache`, which only fills on table-detail open), had no alias/CTE awareness, and didn't reliably auto-open. Per the spec at `docs/superpowers/specs/2026-06-14-sql-autocomplete-design.md` and plan at `docs/superpowers/plans/2026-06-14-sql-autocomplete.md`.
**Problem / Change:** Completions lacked columns for un-opened tables, ignored aliases/CTEs, and felt unhelpful.
**Solution / Outcome:**
- **`useSchemaPrefetch`** (new hook) — debounced (250 ms); parses the active query for referenced tables (`extractTableRefs`), resolves them against loaded catalog table lists (`buildTableLookup`), and background-loads their schemas via `catalogStore.loadSchema` (concurrency-capped at 5, errors swallowed). Columns now appear without opening a table.
- **`sqlCompletion.ts`** (new) — `sqlSupport(engine, sqlSchema)` builds lang-sql's schema-aware completion (tables/columns/FROM-alias resolution) and layers a custom CTE completion source (`cteCompletionOptions` from `extractCteCompletions`) via language data.
- **`extractTableRefs` / `extractCteCompletions` / `buildTableLookup`** (new, pure, unit-tested) — the parsing/resolution core.
- **`QueryEditor`** — SQL engines route through `sqlSupport`; added `autocompletion({ activateOnTyping, defaultKeymap, icons })` to the memoized extensions for auto-open. Cypher path unchanged.
- **`Editor.tsx`** — calls `useSchemaPrefetch(activeTab.sql, activeConnectionId)`.
- Completion stays local/instant (no IPC on the completion path; prefetch happens ahead in the background). No store API change → existing tests stay green; new pure parsers add unit tests.

**Files affected:**
- `src/renderer/src/lib/{extractTableRefs,extractCteCompletions,buildTableLookup,sqlCompletion}.ts` — created
- `src/renderer/src/hooks/useSchemaPrefetch.ts` — created
- `src/renderer/src/components/editor/QueryEditor.tsx` — sqlSupport + autocompletion config
- `src/renderer/src/pages/Editor.tsx` — useSchemaPrefetch call
- `src/__tests__/renderer/lib/{extractTableRefs,extractCteCompletions,buildTableLookup}.test.ts` — created
- `README.md`, `CHANGELOG.md` — docs
```

- [ ] **Step 4: Commit**

```bash
git add README.md CHANGELOG.md CLAUDE.md
git commit -m "📝 docs: document smarter SQL autocomplete"
```

- [ ] **Step 5: Push + open PR**

```bash
git push -u origin feat/sql-autocomplete
```
Open a PR summarizing the prefetch + CTE/alias completion + auto-trigger, the manual verification results, and that typecheck/tests/build pass.

---

## Self-Review

**1. Spec coverage:**
- Background schema prefetch (`useSchemaPrefetch` + `extractTableRefs` + `buildTableLookup`) → Tasks 2, 4, 6 ✓
- Alias awareness via lang-sql built-in (fed by prefetch) → Tasks 5, 6 ✓
- CTE awareness (`extractCteCompletions` + `cteCompletionOptions` + CTE source) → Tasks 3, 5 ✓
- Trigger/feel (`autocompletion({ activateOnTyping … })`, memoized extensions) → Task 7 ✓
- Local/instant, no completion-path IPC → prefetch is background; completion sources read in-memory schema + doc ✓
- SQL only, Cypher unchanged → Task 7 keeps the `engine === 'neo4j'` branch ✓
- No store API change; tests stay green → verified Tasks 7 (vitest run) ✓
- Error handling (swallow per-table errors, tolerant parsers) → Tasks 2, 3, 6 ✓
- Docs → Task 8 ✓

**2. Placeholder scan:** No TBD/"similar to"/vague steps — every code step has full paste-able code + exact commands. The unused-import cleanup in Task 7 is guarded with "delete exactly what typecheck reports."

**3. Type consistency:** `TableRef { name, alias? }` (Task 2) used by `useSchemaPrefetch` (Task 6). `TableLocation { projectId, datasetId, tableId }` (Task 4) matches `loadSchema(connectionId, projectId, datasetId, tableId)` call order (Task 6) and the `schemaCache` key `${connectionId}:${datasetId}:${tableId}` (matches `catalogStore.loadSchema`). `cteCompletionOptions(sql, textBefore)` (Task 3) consumed by `cteSource` (Task 5). `sqlSupport(engine, sqlSchema)` (Task 5) signature matches the QueryEditor call (Task 7). `CteOption { label, type }` mapped to CM `Completion` in Task 5.

---

## Execution Handoff

**Plan complete and saved to `docs/superpowers/plans/2026-06-14-sql-autocomplete.md`. Two execution options:**

**1. Subagent-Driven (recommended)** — fresh subagent per task, two-stage review between tasks.

**2. Inline Execution** — execute here with checkpoints.

**Which approach?**
