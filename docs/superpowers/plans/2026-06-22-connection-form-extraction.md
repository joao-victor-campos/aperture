# ConnectionModal Logic Extraction Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Extract the per-engine validation and payload-building logic out of `ConnectionModal.tsx` into a pure, fully unit-tested `lib/connectionForm.ts` module, with zero behavior change.

**Architecture:** This is the first step of the "harden what exists" campaign (see `docs/adr/0001-testing-strategy-and-coverage-gate-scope.md`). We follow the codebase's established "extract pure helpers, unit-test those, keep components thin" pattern — no React Testing Library. Two pure functions, `isConnectionInputValid` and `buildConnectionPayload`, operate on a flat `ConnectionFormFields` snapshot that the component assembles from its `useState` values. The component keeps all its `useState` hooks and JSX exactly as-is; only the inline `isValid` IIFE and the `buildPayload` closure are replaced with calls into the new module.

**Tech Stack:** TypeScript (strict), React, Vitest, Zustand (unchanged). Vite path aliases `@shared` → `src/shared`.

## Global Constraints

- **Branch only — never commit to `master`.** Work happens on the current worktree branch `claude/admiring-jepsen-2e331b`.
- **TypeScript strict mode; no `any`.** Prefer explicit types.
- **Behavior must be byte-for-byte identical.** This is a pure refactor: the new functions must reproduce the exact semantics of the current inline code, including the deliberate asymmetries (Postgres and Neo4j passwords are NOT trimmed in the payload; Snowflake password IS trimmed; BigQuery `serviceAccountPath` is only set when `credentialType === 'service-account'`; optional Snowflake/Neo4j fields become `undefined` when blank).
- **All tests must pass before the work is considered done** (`just ci` green).
- **Coverage gate is unaffected by this plan.** `src/renderer/src/lib/**` is currently *outside* the coverage `include` set in `vitest.config.ts`, so the new file does not change the 70% gate. (Widening the gate to `lib/**` is a *later* campaign step, not part of this plan.)
- **Append a Change Log entry to `CLAUDE.md`** per the project's change-log rule (done in Task 3). README needs no update — this is an internal refactor with no user-facing, architecture, auth, or command changes.

---

### Task 1: `isConnectionInputValid` — pure per-engine validation

**Files:**
- Create: `src/renderer/src/lib/connectionForm.ts`
- Test: `src/__tests__/renderer/lib/connectionForm.test.ts`

**Interfaces:**
- Consumes: shared types `ConnectionEngine`, `BigQueryConnection` from `@shared/types`.
- Produces:
  - `interface ConnectionFormFields` — flat snapshot of every form field (engine-agnostic). Exact shape defined in Step 3 below; later tasks rely on these exact property names.
  - `function isConnectionInputValid(f: ConnectionFormFields): boolean`

- [ ] **Step 1: Write the failing test**

Create `src/__tests__/renderer/lib/connectionForm.test.ts`:

```ts
import { describe, it, expect } from 'vitest'
import {
  isConnectionInputValid,
  type ConnectionFormFields,
} from '../../../renderer/src/lib/connectionForm'

/** A fully-valid BigQuery fields snapshot; override per test. */
function makeFields(overrides: Partial<ConnectionFormFields> = {}): ConnectionFormFields {
  return {
    engine: 'bigquery',
    name: 'My Conn',
    projectId: 'my-project',
    credentialType: 'adc',
    serviceAccountPath: '',
    host: 'localhost',
    port: '5432',
    pgDatabase: 'db',
    pgUser: 'user',
    pgPassword: 'pass',
    sfAccount: 'acct',
    sfUsername: 'sfuser',
    sfPassword: 'sfpass',
    sfWarehouse: 'WH',
    sfDatabase: '',
    sfSchema: '',
    sfRole: '',
    neoUri: 'neo4j://localhost:7687',
    neoUsername: 'neo4j',
    neoPassword: 'neopass',
    neoDatabase: '',
    ...overrides,
  }
}

describe('isConnectionInputValid', () => {
  it('returns false when the connection name is blank, for any engine', () => {
    expect(isConnectionInputValid(makeFields({ name: '   ' }))).toBe(false)
    expect(isConnectionInputValid(makeFields({ engine: 'postgres', name: '' }))).toBe(false)
  })

  describe('bigquery', () => {
    it('is valid with a project id', () => {
      expect(isConnectionInputValid(makeFields({ engine: 'bigquery' }))).toBe(true)
    })
    it('is invalid without a project id', () => {
      expect(isConnectionInputValid(makeFields({ engine: 'bigquery', projectId: '  ' }))).toBe(false)
    })
  })

  describe('postgres', () => {
    it('is valid with host, database, user, password and a positive numeric port', () => {
      expect(isConnectionInputValid(makeFields({ engine: 'postgres' }))).toBe(true)
    })
    it('is invalid when a required field is blank', () => {
      expect(isConnectionInputValid(makeFields({ engine: 'postgres', host: '' }))).toBe(false)
      expect(isConnectionInputValid(makeFields({ engine: 'postgres', pgDatabase: '' }))).toBe(false)
      expect(isConnectionInputValid(makeFields({ engine: 'postgres', pgUser: '' }))).toBe(false)
      expect(isConnectionInputValid(makeFields({ engine: 'postgres', pgPassword: '' }))).toBe(false)
    })
    it('is invalid when the port is non-numeric or not positive', () => {
      expect(isConnectionInputValid(makeFields({ engine: 'postgres', port: 'abc' }))).toBe(false)
      expect(isConnectionInputValid(makeFields({ engine: 'postgres', port: '0' }))).toBe(false)
      expect(isConnectionInputValid(makeFields({ engine: 'postgres', port: '-1' }))).toBe(false)
    })
  })

  describe('neo4j', () => {
    it('is valid with uri, username and password', () => {
      expect(isConnectionInputValid(makeFields({ engine: 'neo4j' }))).toBe(true)
    })
    it('is invalid when any of uri/username/password is blank', () => {
      expect(isConnectionInputValid(makeFields({ engine: 'neo4j', neoUri: '' }))).toBe(false)
      expect(isConnectionInputValid(makeFields({ engine: 'neo4j', neoUsername: '' }))).toBe(false)
      expect(isConnectionInputValid(makeFields({ engine: 'neo4j', neoPassword: '' }))).toBe(false)
    })
  })

  describe('snowflake', () => {
    it('is valid with account, username, password and warehouse', () => {
      expect(isConnectionInputValid(makeFields({ engine: 'snowflake' }))).toBe(true)
    })
    it('is invalid when a required field is blank', () => {
      expect(isConnectionInputValid(makeFields({ engine: 'snowflake', sfAccount: '' }))).toBe(false)
      expect(isConnectionInputValid(makeFields({ engine: 'snowflake', sfWarehouse: '' }))).toBe(false)
    })
    it('does not require the optional database/schema/role fields', () => {
      expect(
        isConnectionInputValid(
          makeFields({ engine: 'snowflake', sfDatabase: '', sfSchema: '', sfRole: '' })
        )
      ).toBe(true)
    })
  })
})
```

- [ ] **Step 2: Run the test to verify it fails**

Run: `npx vitest run src/__tests__/renderer/lib/connectionForm.test.ts`
Expected: FAIL — module `connectionForm` not found / `isConnectionInputValid` is not a function.

- [ ] **Step 3: Write the minimal implementation**

Create `src/renderer/src/lib/connectionForm.ts`:

```ts
import type { BigQueryConnection, ConnectionEngine } from '@shared/types'

/**
 * Flat, engine-agnostic snapshot of every ConnectionModal form field.
 * The component assembles this from its useState values and hands it to the
 * pure helpers below. Keeping every field present (not a discriminated union)
 * keeps the assembly site in the component trivial.
 */
export interface ConnectionFormFields {
  engine: ConnectionEngine
  name: string
  // BigQuery
  projectId: string
  credentialType: BigQueryConnection['credentialType']
  serviceAccountPath: string
  // Postgres
  host: string
  port: string
  pgDatabase: string
  pgUser: string
  pgPassword: string
  // Snowflake
  sfAccount: string
  sfUsername: string
  sfPassword: string
  sfWarehouse: string
  sfDatabase: string
  sfSchema: string
  sfRole: string
  // Neo4j
  neoUri: string
  neoUsername: string
  neoPassword: string
  neoDatabase: string
}

/** True when the form holds the minimum required fields for its engine. */
export function isConnectionInputValid(f: ConnectionFormFields): boolean {
  if (!f.name.trim()) return false
  if (f.engine === 'bigquery') return Boolean(f.projectId.trim())
  if (f.engine === 'postgres')
    return Boolean(
      f.host.trim() &&
        f.pgDatabase.trim() &&
        f.pgUser.trim() &&
        f.pgPassword.trim() &&
        Number.isFinite(Number(f.port)) &&
        Number(f.port) > 0
    )
  if (f.engine === 'neo4j')
    return Boolean(f.neoUri.trim() && f.neoUsername.trim() && f.neoPassword.trim())
  // snowflake
  return Boolean(
    f.sfAccount.trim() && f.sfUsername.trim() && f.sfPassword.trim() && f.sfWarehouse.trim()
  )
}
```

- [ ] **Step 4: Run the test to verify it passes**

Run: `npx vitest run src/__tests__/renderer/lib/connectionForm.test.ts`
Expected: PASS — all `isConnectionInputValid` tests green.

- [ ] **Step 5: Commit**

```bash
git add src/renderer/src/lib/connectionForm.ts src/__tests__/renderer/lib/connectionForm.test.ts
git commit -m "refactor(connections): extract isConnectionInputValid pure helper + tests"
```

---

### Task 2: `buildConnectionPayload` — pure per-engine payload construction

**Files:**
- Modify: `src/renderer/src/lib/connectionForm.ts` (add one exported function + one import)
- Test: `src/__tests__/renderer/lib/connectionForm.test.ts` (add a `describe` block; reuse the existing `makeFields` factory)

**Interfaces:**
- Consumes: `ConnectionFormFields` (from Task 1), shared `ConnectionCreate` from `@shared/types`.
- Produces: `function buildConnectionPayload(f: ConnectionFormFields): ConnectionCreate`

- [ ] **Step 1: Write the failing test**

Append this `describe` block to `src/__tests__/renderer/lib/connectionForm.test.ts` (and add `buildConnectionPayload` to the existing import from `connectionForm`):

```ts
describe('buildConnectionPayload', () => {
  it('bigquery (adc): trims name/projectId and omits serviceAccountPath', () => {
    const p = buildConnectionPayload(
      makeFields({
        engine: 'bigquery',
        name: '  My Conn  ',
        projectId: '  my-project  ',
        credentialType: 'adc',
        serviceAccountPath: '/some/path.json',
      })
    )
    expect(p).toEqual({
      engine: 'bigquery',
      name: 'My Conn',
      projectId: 'my-project',
      credentialType: 'adc',
      serviceAccountPath: undefined,
    })
  })

  it('bigquery (service-account): includes the trimmed key path', () => {
    const p = buildConnectionPayload(
      makeFields({
        engine: 'bigquery',
        credentialType: 'service-account',
        serviceAccountPath: '  /keys/sa.json  ',
      })
    )
    expect(p).toMatchObject({
      engine: 'bigquery',
      credentialType: 'service-account',
      serviceAccountPath: '/keys/sa.json',
    })
  })

  it('postgres: coerces port to a number, trims fields, but preserves the password verbatim', () => {
    const p = buildConnectionPayload(
      makeFields({
        engine: 'postgres',
        host: '  db.example.com  ',
        port: '5433',
        pgDatabase: '  analytics  ',
        pgUser: '  reader  ',
        pgPassword: '  s3cret  ',
      })
    )
    expect(p).toEqual({
      engine: 'postgres',
      name: 'My Conn',
      host: 'db.example.com',
      port: 5433,
      database: 'analytics',
      user: 'reader',
      password: '  s3cret  ',
    })
  })

  it('neo4j: maps a blank database to undefined and preserves the password verbatim', () => {
    const p = buildConnectionPayload(
      makeFields({
        engine: 'neo4j',
        neoUri: '  neo4j://localhost:7687  ',
        neoUsername: '  neo4j  ',
        neoPassword: '  p@ss  ',
        neoDatabase: '   ',
      })
    )
    expect(p).toEqual({
      engine: 'neo4j',
      name: 'My Conn',
      uri: 'neo4j://localhost:7687',
      username: 'neo4j',
      password: '  p@ss  ',
      database: undefined,
    })
  })

  it('snowflake: trims the password and maps blank optional fields to undefined', () => {
    const p = buildConnectionPayload(
      makeFields({
        engine: 'snowflake',
        sfAccount: '  xy12345  ',
        sfUsername: '  USER  ',
        sfPassword: '  pw  ',
        sfWarehouse: '  COMPUTE_WH  ',
        sfDatabase: '   ',
        sfSchema: '',
        sfRole: '  SYSADMIN  ',
      })
    )
    expect(p).toEqual({
      engine: 'snowflake',
      name: 'My Conn',
      account: 'xy12345',
      username: 'USER',
      password: 'pw',
      warehouse: 'COMPUTE_WH',
      database: undefined,
      schema: undefined,
      role: 'SYSADMIN',
    })
  })
})
```

The import line at the top of the test file becomes:

```ts
import {
  isConnectionInputValid,
  buildConnectionPayload,
  type ConnectionFormFields,
} from '../../../renderer/src/lib/connectionForm'
```

- [ ] **Step 2: Run the test to verify it fails**

Run: `npx vitest run src/__tests__/renderer/lib/connectionForm.test.ts`
Expected: FAIL — `buildConnectionPayload` is not a function (the `isConnectionInputValid` tests still pass).

- [ ] **Step 3: Write the minimal implementation**

Add the import of `ConnectionCreate` and the function to `src/renderer/src/lib/connectionForm.ts`. The top import becomes:

```ts
import type { BigQueryConnection, ConnectionCreate, ConnectionEngine } from '@shared/types'
```

Append at the end of the file:

```ts
/** Construct the engine-specific ConnectionCreate payload from the form fields. */
export function buildConnectionPayload(f: ConnectionFormFields): ConnectionCreate {
  if (f.engine === 'bigquery') {
    return {
      engine: 'bigquery',
      name: f.name.trim(),
      projectId: f.projectId.trim(),
      credentialType: f.credentialType,
      serviceAccountPath:
        f.credentialType === 'service-account' ? f.serviceAccountPath.trim() : undefined,
    }
  }
  if (f.engine === 'postgres') {
    return {
      engine: 'postgres',
      name: f.name.trim(),
      host: f.host.trim(),
      port: Number(f.port),
      database: f.pgDatabase.trim(),
      user: f.pgUser.trim(),
      password: f.pgPassword,
    }
  }
  if (f.engine === 'neo4j') {
    return {
      engine: 'neo4j',
      name: f.name.trim(),
      uri: f.neoUri.trim(),
      username: f.neoUsername.trim(),
      password: f.neoPassword,
      database: f.neoDatabase.trim() || undefined,
    }
  }
  return {
    engine: 'snowflake',
    name: f.name.trim(),
    account: f.sfAccount.trim(),
    username: f.sfUsername.trim(),
    password: f.sfPassword.trim(),
    warehouse: f.sfWarehouse.trim(),
    database: f.sfDatabase.trim() || undefined,
    schema: f.sfSchema.trim() || undefined,
    role: f.sfRole.trim() || undefined,
  }
}
```

> Note the deliberate asymmetry that must be preserved exactly: `postgres` and `neo4j` use `password: f.pgPassword` / `f.neoPassword` (NO `.trim()`), while `snowflake` uses `f.sfPassword.trim()`. This mirrors the original component code.

- [ ] **Step 4: Run the test to verify it passes**

Run: `npx vitest run src/__tests__/renderer/lib/connectionForm.test.ts`
Expected: PASS — both `isConnectionInputValid` and `buildConnectionPayload` describe blocks green.

- [ ] **Step 5: Commit**

```bash
git add src/renderer/src/lib/connectionForm.ts src/__tests__/renderer/lib/connectionForm.test.ts
git commit -m "refactor(connections): extract buildConnectionPayload pure helper + tests"
```

---

### Task 3: Wire `ConnectionModal` to the extracted helpers

**Files:**
- Modify: `src/renderer/src/components/connections/ConnectionModal.tsx`
- Modify: `CLAUDE.md` (append Change Log entry)

**Interfaces:**
- Consumes: `isConnectionInputValid`, `buildConnectionPayload`, `ConnectionFormFields` (from Tasks 1–2).
- Produces: nothing new — the component's external props and rendered output are unchanged.

- [ ] **Step 1: Add the import**

In `src/renderer/src/components/connections/ConnectionModal.tsx`, add below the existing imports (after line 11):

```ts
import {
  isConnectionInputValid,
  buildConnectionPayload,
  type ConnectionFormFields,
} from '../../lib/connectionForm'
```

- [ ] **Step 2: Remove now-unused `ConnectionCreate` from the type import**

The existing type import block (lines 4–11) imports `ConnectionCreate`, which becomes unused once `buildPayload` is deleted. Edit it to drop only `ConnectionCreate` (keep the four `*Connection` types — they are still used by the `bqInit`/`pgInit`/`sfInit`/`neoInit` casts):

```ts
import type {
  BigQueryConnection,
  Connection,
  Neo4jConnection,
  PostgresConnection,
  SnowflakeConnection,
} from '@shared/types'
```

- [ ] **Step 3: Replace the inline `isValid` IIFE and `buildPayload` closure**

Delete the entire block currently at lines 75–138 (the `// ── Validation ──` comment, the `const isValid = …` IIFE, and the `const buildPayload = (): ConnectionCreate => { … }` closure) and replace it with:

```ts
  // ── Validation & payload (pure — see lib/connectionForm.ts) ───────────────
  const fields: ConnectionFormFields = {
    engine,
    name,
    projectId,
    credentialType,
    serviceAccountPath,
    host,
    port,
    pgDatabase,
    pgUser,
    pgPassword,
    sfAccount,
    sfUsername,
    sfPassword,
    sfWarehouse,
    sfDatabase,
    sfSchema,
    sfRole,
    neoUri,
    neoUsername,
    neoPassword,
    neoDatabase,
  }
  const isValid = isConnectionInputValid(fields)
```

- [ ] **Step 4: Update the two payload call sites**

In `handleSave`, replace both `buildPayload()` calls (originally lines 144 and 146) so the function body reads:

```ts
  const handleSave = async () => {
    if (!isValid) return
    setIsSaving(true)
    if (isEdit && initialConnection) {
      await update({ ...initialConnection, ...buildConnectionPayload(fields) } as Connection)
    } else {
      await add(buildConnectionPayload(fields))
    }
    setIsSaving(false)
    onClose()
  }
```

In `handleTest`, replace both `buildPayload()` calls (originally lines 158 and 161) so the function body reads:

```ts
  const handleTest = async () => {
    if (!isValid) return
    setIsTesting(true)
    setTestResult(null)
    let connId: string
    if (isEdit && initialConnection) {
      await update({ ...initialConnection, ...buildConnectionPayload(fields) } as Connection)
      connId = initialConnection.id
    } else {
      const newConn = await add(buildConnectionPayload(fields))
      connId = newConn.id
    }
    const result = await test(connId)
    setTestResult(result)
    setIsTesting(false)
    if (result.ok) onClose()
  }
```

- [ ] **Step 5: Typecheck to verify no unused imports / type drift**

Run: `npm run typecheck`
Expected: PASS — no errors. (If it flags `ConnectionCreate` as unused, Step 2 was missed; if it flags a missing field on `fields`, a property name was mistyped versus the `ConnectionFormFields` interface.)

- [ ] **Step 6: Run the full test suite to confirm zero behavior change**

Run: `npx vitest run`
Expected: PASS — the entire suite is green (the new `connectionForm` tests plus all pre-existing tests; no test referenced the old inline `buildPayload`, so nothing should need changing).

- [ ] **Step 7: Append the Change Log entry to `CLAUDE.md`**

Add this entry immediately below the `---` that follows the `### Format` code block (i.e. as the newest entry, above the `### [2026-06-20] Feature: Catalog warm-up` entry):

```markdown
### [2026-06-22] Refactor: Extract ConnectionModal validation + payload into a tested pure helper

**Type:** Change
**Context:** First step of the "harden what exists" campaign (see `docs/adr/0001-testing-strategy-and-coverage-gate-scope.md`). `ConnectionModal.tsx` carried two correctness-critical pure functions inline — an `isValid` per-engine required-field check and a `buildPayload` per-engine `ConnectionCreate` constructor — both untested (components sit outside the coverage gate).
**Problem / Change:** A wrong payload silently produces a broken connection, yet none of the per-engine validation/payload logic had tests.
**Solution / Outcome:**
- **`src/renderer/src/lib/connectionForm.ts`** (new, pure): `ConnectionFormFields` (flat snapshot of all form fields), `isConnectionInputValid(fields)`, and `buildConnectionPayload(fields)`. Semantics copied verbatim from the component, preserving the deliberate asymmetries (Postgres/Neo4j passwords untrimmed; Snowflake password trimmed; BigQuery `serviceAccountPath` only set for `service-account`; blank optional Snowflake/Neo4j fields → `undefined`).
- **`ConnectionModal.tsx`**: assembles a `ConnectionFormFields` object from its `useState` values and delegates to the two helpers; inline `isValid` IIFE and `buildPayload` closure removed; now-unused `ConnectionCreate` import dropped. No prop or render change.
- **Tests** (new): `connectionForm.test.ts` covers all four engines for both functions, including the password trim/no-trim asymmetry and optional-field handling. `lib/**` is outside the coverage `include` set, so the 70% gate is unaffected.

**Files affected:**
- `src/renderer/src/lib/connectionForm.ts` — created
- `src/__tests__/renderer/lib/connectionForm.test.ts` — created
- `src/renderer/src/components/connections/ConnectionModal.tsx` — delegate to helpers
- `docs/adr/0001-testing-strategy-and-coverage-gate-scope.md` — referenced (created alongside this work)
```

- [ ] **Step 8: Run the full CI suite locally**

Run: `just ci`
Expected: PASS — typecheck + tests + coverage gate all green (coverage threshold unchanged because `lib/**` is outside the include set).

- [ ] **Step 9: Commit**

```bash
git add src/renderer/src/components/connections/ConnectionModal.tsx CLAUDE.md
git commit -m "refactor(connections): wire ConnectionModal to extracted connectionForm helpers"
```

---

## Done when

- `src/renderer/src/lib/connectionForm.ts` exists with `ConnectionFormFields`, `isConnectionInputValid`, and `buildConnectionPayload`, all exported.
- `connectionForm.test.ts` covers all four engines for both functions and passes.
- `ConnectionModal.tsx` contains no inline `isValid` IIFE or `buildPayload` closure and renders identically.
- `just ci` is green.
- The `CLAUDE.md` Change Log has the 2026-06-22 entry.
