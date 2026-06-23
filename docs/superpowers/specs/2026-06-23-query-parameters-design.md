# Query Parameters (`{{name}}`) — Design

**Date:** 2026-06-23
**Type:** Feature
**Status:** Approved (design); pending spec review → plan

## Purpose

Let users write a query once with named placeholders and run it repeatedly with
different values — without editing SQL by hand each time. This completes a long-standing
analyst workflow gap: today every "same query, different filter" run means manual text
edits.

Example:

```sql
SELECT *
FROM events
WHERE country = {{country}}
  AND ts >= {{start_date}}
LIMIT 1000
```

The user fills `country` and `start_date` in an inputs panel and runs. The raw `{{...}}`
text is what's stored and saved; substitution happens only at execute time.

## Approach (decided)

**Client-side substitution** (Approach A of three considered). Placeholders are detected in
the SQL, the user supplies values in an inputs panel, and the values are substituted into
the SQL **string** before it is sent to the existing `QUERY_EXECUTE` / `QUERY_DRY_RUN` IPC
channels.

- **Uniform across all four engines** (BigQuery, Postgres, Snowflake, Neo4j) — substitution
  is dialect-agnostic; no adapter or IPC changes.
- **Small surface** — all new code is renderer-side: two pure `lib/` helpers, store actions,
  one UI component, and two shared-type additions.

Rejected alternatives:

- **B — Native bind parameters per engine.** Correctly typed and injection-safe, but ~4× the
  adapter work, requires a per-param type picker wired through IPC, and BigQuery requires
  explicit parameter types. The safety property barely matters here: the user runs their own
  SQL against their own warehouse with values they typed themselves.
- **C — Hybrid (A now, pre-built seam for B).** Deferred. We are **not** pre-building the B
  seam (YAGNI); if native binding is ever wanted, it can be added then.

**Placeholder syntax:** `{{name}}` (handlebars-style, as in dbt and Metabase). Zero collision
with real SQL/Cypher, instantly readable as "a variable goes here". Param names match
`[A-Za-z_][A-Za-z0-9_]*` with optional surrounding whitespace inside the braces
(`{{ name }}` == `{{name}}`).

## Type model & quoting (correctness core)

Each parameter carries an **explicit type** (no inference). The pure `substituteParams` helper
renders each value according to its type:

| Type | Rendering | Notes |
|---|---|---|
| **Text** (default) | single-quoted, internal `'` doubled | `O'Brien` → `'O''Brien'` |
| **Number** | verbatim | blocked with a clear error if the value does not parse as a finite number |
| **Boolean** | `true` / `false` | lowercase, unquoted |
| **Raw / SQL** | inserted verbatim | for identifiers, `IN (...)` lists, snippets — user owns correctness |

Guard rails (execution is **blocked** with a surfaced error, not silently run):

- A param appears in the SQL but has **no value entered** → "Fill in {{name}} before running."
- A **Number** param's value is not a finite number → "{{name}} is not a valid number."

An **empty value** counts as "no value entered" and blocks for **Text, Number, and Boolean**
(this prevents accidental `= ''` runs). **Raw** is the one exception: an empty Raw value is
allowed and inserts nothing — Raw is the power-user escape hatch and owns its own correctness.

Blocking means: `runQuery` / `explainQuery` set the tab's `error` field and return early
without an IPC call.

## Pure helpers (renderer `lib/`, coverage-gated)

Both are pure and live inside the `src/renderer/src/lib/**` coverage gate (≥70%).

### `extractParams.ts`

```ts
extractParams(sql: string): string[]
```

Returns the **ordered, de-duplicated** list of param names referenced in `sql`. Strips SQL
comments and string literals first, reusing the same comment/string-stripping approach already
used by `detectMissingLimit` / `extractTableRefs`, so a `{{...}}` that appears inside a string
literal or comment is **not** treated as a param. Order = first appearance.

### `substituteParams.ts`

```ts
type QueryParam = { name: string; type: 'text' | 'number' | 'boolean' | 'raw'; value: string }

substituteParams(
  sql: string,
  params: Record<string, { type: QueryParam['type']; value: string }>
): { sql: string } | { error: string }
```

Replaces every `{{name}}` occurrence with the type-rendered value. Returns `{ error }` on the
first missing-value / invalid-number failure (message names the offending param). Does **not**
strip comments/strings — substitution is literal over the original text, matching what the
engine will run. (Detection strips comments; substitution does not. A `{{x}}` inside a comment
is not surfaced as an input, and is left untouched at run time since it has no entry in
`params`.) Unknown `{{...}}` tokens with no matching key are left verbatim.

## State & shared types

`src/shared/types.ts`:

- New `QueryParam = { name: string; type: 'text' | 'number' | 'boolean' | 'raw'; value: string }`.
- `QueryTab` gains `params?: QueryParam[]` — **runtime** values for the open tab.
- `SavedQuery` gains `params?: QueryParam[]` — **persisted defaults** (types + last values).

`src/renderer/src/store/queryStore.ts`:

- New action `setTabParams(id: string, params: QueryParam[])`.
- A **reconcile** step (debounced on SQL change, mirroring `useSchemaPrefetch`'s pattern):
  recomputes `extractParams(sql)`, then produces the tab's `params` as: keep existing
  `{type,value}` for names that still exist (preserve by name), append new names with default
  `type: 'text'`, value `''`, drop names no longer present. Order follows `extractParams`.
- `runQuery` and `explainQuery` build effective SQL via
  `substituteParams(tab.sql, paramsAsRecord)`; on `{ error }` they set the tab `error` and
  return early; on success they send the substituted SQL through the existing channels
  (`QUERY_EXECUTE` / `QUERY_DRY_RUN`). The `tabId` and all other request fields are unchanged.

`src/renderer/src/store/savedQueryStore.ts` + the save flow: carry `params` through on
`saveQuery` / `updateQuery` so reopening a saved query restores the inputs panel. Opening a
saved query into a tab seeds `tab.params` from `SavedQuery.params` (reconciled against the
current SQL so they can't drift).

## UI

New `src/renderer/src/components/editor/ParamsPanel.tsx`:

- Rendered by `EditorPane` when `extractParams(sql).length > 0`, in the same slot as the
  existing `LimitWarningBanner` (between the toolbar and the results region).
- One row per param: **name** (read-only label) · **type** dropdown (`Text / Number / Boolean
  / Raw`) · **value** input (a checkbox-style toggle for Boolean is acceptable).
- Calls `setTabParams` on edit. Tailwind tokens only; visual language matches
  `LimitWarningBanner` and the existing `.app-segmented` controls. No inline styles.

No changes to the editor language/autocomplete extensions — `{{name}}` is plain text to
CodeMirror.

## Out of scope (YAGNI)

- Native bind parameters and any pre-built seam for them.
- Param value history / autocomplete of previously-used values.
- Multi-value / list pickers beyond what **Raw** already allows (`a, b, c`).
- Cross-tab or global parameters shared by name.
- Param usage in catalog/table-detail preview queries (editor tabs only).

## Testing

Pure unit tests (coverage-gated):

- `extractParams`: empty, none, single, repeated (dedup + order), whitespace inside braces,
  inside string literal (ignored), inside comment (ignored), adjacent tokens, invalid names.
- `substituteParams`: each of the four types; Text quote-escaping; Number verbatim + invalid
  → error; Boolean rendering; Raw verbatim; missing value → error (names the param); unknown
  token left verbatim; multiple params in one query.

`queryStore` tests: `setTabParams`; reconcile preserves value/type by name, adds new, drops
removed; `runQuery` sends substituted SQL; `runQuery` blocks (sets `error`, no IPC) on missing
value / invalid number; `explainQuery` substitutes too.

`ParamsPanel` is a UI component (outside the coverage gate) — verified via `tsc`, the full
suite staying green, and manual check in the running app (`just dev`): panel appears/updates
as `{{...}}` are typed, run uses substituted values, save/reopen restores defaults.

## Acceptance

- Typing `{{name}}` in an editor tab surfaces an inputs row; removing it removes the row;
  values survive edits to unrelated SQL.
- Run / Explain / "Run anyway" all execute the substituted SQL across all four engines.
- Text values are quoted+escaped; Number/Boolean/Raw render per the table; missing value or
  invalid number blocks the run with a clear message and no IPC call.
- Saving a parameterized query persists types+values; reopening restores the panel.
- `just ci` green; new `lib/` helpers covered ≥70%; CLAUDE.md change-log entry + README/
  CHANGELOG updated.
