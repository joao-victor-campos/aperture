# formatBytes Consolidation Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Replace the four divergent `formatBytes` definitions with a single shared, tested helper in `src/shared/formatBytes.ts`, used by both the main and renderer processes.

**Architecture:** Fourth step of the "harden what exists" campaign. `formatBytes` is currently defined four times: the canonical decimal version in `src/renderer/src/lib/formatBytes.ts` (tested), byte-identical copies in `src/main/db/bigquery.ts` and `src/renderer/src/components/results/ExplainPanel.tsx`, and a **divergent** copy in `src/renderer/src/components/chat/RunConfirmCard.tsx` (binary/1024-based units + an `'unknown'` fallback). Because the helper is shared across the main and renderer processes, the single source of truth lives in `src/shared/` (dependency-free, importable by both). Renderer consumers import it via the `@shared` alias; the main process imports it by relative path (`../../shared/...`), matching that process's existing convention (e.g. `bigquery.ts` already does `import … from '../../shared/types'`).

**Tech Stack:** TypeScript (strict), React, Vitest. Aliases: `@shared` → `src/shared` (configured for main, preload, renderer in `electron.vite.config.ts`, and in `vitest.config.ts`).

## Global Constraints

- **Branch only — never commit to `master`.** Work happens on branch `harden/formatbytes-consolidation` (already created from `origin/master`).
- **TypeScript strict mode; no `any`.**
- **The unified behavior is the canonical decimal formatter** (verbatim from the current `lib/formatBytes.ts`): `< 1e6 → "X.X KB"`, `< 1e9 → "X.X MB"`, else `"X.XX GB"` (1000-based). `0 → "0.0 KB"`.
- **Two of the three local copies (`ExplainPanel`, `bigquery.ts`) are byte-identical to canonical** → deleting them and importing the shared helper is a pure no-op refactor.
- **`RunConfirmCard`'s copy DIVERGES and its replacement is a deliberate behavior change:** it currently uses 1024-based units (`B/KB/MB/GB/TB`) and returns `'unknown'` for `0`/falsy. After this change it uses the canonical decimal formatter (so `0 → "0.0 KB"`, and large values use decimal GB). This is intended (consistency) and must be called out in the Change Log.
- **`src/shared/**` is NOT in the coverage `include` set** (the gate covers `main/db`, `main/ipc`, `renderer/src/store`, `renderer/src/lib`). Moving the canonical helper from `lib/` to `shared/` removes it from gate enforcement, but it stays fully tested by its relocated unit test. This is an accepted trade for a single source of truth. `just ci` must stay green.
- **Append a Change Log entry to `CLAUDE.md`** (Task 2). README needs no update.

---

### Task 1: Create the shared `formatBytes` helper

**Files:**
- Create: `src/shared/formatBytes.ts`
- Test: `src/__tests__/shared/formatBytes.test.ts`

**Interfaces:**
- Consumes: nothing.
- Produces: `function formatBytes(bytes: number): string` (decimal KB/MB/GB).

- [ ] **Step 1: Write the failing test**

Create `src/__tests__/shared/formatBytes.test.ts`:

```ts
import { describe, it, expect } from 'vitest'
import { formatBytes } from '@shared/formatBytes'

describe('formatBytes', () => {
  it('formats zero as 0.0 KB', () => {
    expect(formatBytes(0)).toBe('0.0 KB')
  })
  it('formats < 1MB as KB (one decimal)', () => {
    expect(formatBytes(2_000)).toBe('2.0 KB')
  })
  it('formats < 1GB as MB (one decimal)', () => {
    expect(formatBytes(2_000_000)).toBe('2.0 MB')
  })
  it('formats >= 1GB as GB (two decimals)', () => {
    expect(formatBytes(2_000_000_000)).toBe('2.00 GB')
  })
  it('keeps very large values in GB', () => {
    expect(formatBytes(5_000_000_000_000)).toBe('5000.00 GB')
  })
})
```

- [ ] **Step 2: Run the test to verify it fails**

Run: `npx vitest run src/__tests__/shared/formatBytes.test.ts`
Expected: FAIL — cannot resolve `@shared/formatBytes`.

- [ ] **Step 3: Write the minimal implementation**

Create `src/shared/formatBytes.ts`:

```ts
/**
 * Format a byte count using decimal (1000-based) units: KB / MB / GB.
 * Single source of truth shared by the main and renderer processes.
 */
export function formatBytes(bytes: number): string {
  if (bytes < 1e6) return `${(bytes / 1e3).toFixed(1)} KB`
  if (bytes < 1e9) return `${(bytes / 1e6).toFixed(1)} MB`
  return `${(bytes / 1e9).toFixed(2)} GB`
}
```

- [ ] **Step 4: Run the test to verify it passes**

Run: `npx vitest run src/__tests__/shared/formatBytes.test.ts`
Expected: PASS — all 5 tests green.

- [ ] **Step 5: Commit**

```bash
git add src/shared/formatBytes.ts src/__tests__/shared/formatBytes.test.ts
git commit -m "refactor(shared): add single source-of-truth formatBytes helper + tests"
```

---

### Task 2: Repoint all consumers to the shared helper; delete the four local copies

**Files:**
- Modify: `src/renderer/src/components/results/ResultsToolbar.tsx` (import path only)
- Modify: `src/renderer/src/components/results/ExplainPanel.tsx` (drop local copy + import)
- Modify: `src/renderer/src/components/chat/RunConfirmCard.tsx` (drop local copy + import — behavior change)
- Modify: `src/main/db/bigquery.ts` (drop local copy + import)
- Delete: `src/renderer/src/lib/formatBytes.ts`
- Delete: `src/__tests__/renderer/lib/formatBytes.test.ts` (superseded by `src/__tests__/shared/formatBytes.test.ts` from Task 1)
- Modify: `CLAUDE.md` (Change Log entry)

**Interfaces:**
- Consumes: `formatBytes` from `@shared/formatBytes` (Task 1).
- Produces: nothing new.

- [ ] **Step 1: Repoint `ResultsToolbar.tsx`**

Change the import on line 3 from:

```ts
import { formatBytes } from '../../lib/formatBytes'
```

to:

```ts
import { formatBytes } from '@shared/formatBytes'
```

- [ ] **Step 2: Repoint `ExplainPanel.tsx`**

Add this import directly below the existing `import { X } from 'lucide-react'` (line 1):

```ts
import { formatBytes } from '@shared/formatBytes'
```

Then delete the local definition at the bottom of the file (the byte-identical copy):

```ts
function formatBytes(bytes: number): string {
  if (bytes < 1e6) return `${(bytes / 1e3).toFixed(1)} KB`
  if (bytes < 1e9) return `${(bytes / 1e6).toFixed(1)} MB`
  return `${(bytes / 1e9).toFixed(2)} GB`
}
```

- [ ] **Step 3: Repoint `RunConfirmCard.tsx` (deliberate behavior change)**

Add this import directly below the existing `import { Play, X } from 'lucide-react'` (line 1):

```ts
import { formatBytes } from '@shared/formatBytes'
```

Then delete the divergent local definition (lines 10–16):

```ts
function formatBytes(n: number): string {
  if (!n) return 'unknown'
  const units = ['B', 'KB', 'MB', 'GB', 'TB']
  let v = n, i = 0
  while (v >= 1024 && i < units.length - 1) { v /= 1024; i++ }
  return `${v.toFixed(1)} ${units[i]}`
}
```

> The call site `formatBytes(bytesProcessed)` (in the `Est. … scanned` label) is unchanged; it now resolves to the shared decimal formatter. This intentionally changes the card's display from 1024-based units to decimal, and `0 bytes` now renders `"0.0 KB"` instead of `"unknown"`.

- [ ] **Step 4: Repoint `bigquery.ts` (main process — relative import)**

Add this import below the existing `import type … from '../../shared/types'` (line 3):

```ts
import { formatBytes } from '../../shared/formatBytes'
```

Then delete the local definition (the byte-identical copy near line 274):

```ts
function formatBytes(bytes: number): string {
  if (bytes < 1e6) return `${(bytes / 1e3).toFixed(1)} KB`
  if (bytes < 1e9) return `${(bytes / 1e6).toFixed(1)} MB`
  return `${(bytes / 1e9).toFixed(2)} GB`
}
```

- [ ] **Step 5: Delete the old renderer lib helper and its test**

```bash
git rm src/renderer/src/lib/formatBytes.ts src/__tests__/renderer/lib/formatBytes.test.ts
```

- [ ] **Step 6: Typecheck — confirm no dangling references**

Run: `npm run typecheck`
Expected: PASS. (A failure here most likely means a missed import addition or a leftover reference to the deleted `lib/formatBytes`.)

- [ ] **Step 7: Confirm no `formatBytes` definitions or stale imports remain**

Run: `grep -rn "function formatBytes\|lib/formatBytes" src --include='*.ts' --include='*.tsx'`
Expected: NO output (the only definition now lives in `src/shared/formatBytes.ts`, and no file imports the deleted `lib/formatBytes`).

- [ ] **Step 8: Run the full test suite**

Run: `npx vitest run`
Expected: PASS — entire suite green, including `src/__tests__/shared/formatBytes.test.ts`.

- [ ] **Step 9: Append the Change Log entry to `CLAUDE.md`**

Add this as the newest entry, immediately below the `<!-- Entries go below this line, newest first -->` comment:

```markdown
### [2026-06-23] Refactor: Consolidate formatBytes into one shared helper (+ fix RunConfirmCard units)

**Type:** Change
**Context:** Fourth step of the "harden what exists" campaign. `formatBytes` was defined four times: the canonical tested decimal version in `lib/formatBytes.ts`, byte-identical copies in `main/db/bigquery.ts` and `results/ExplainPanel.tsx`, and a **divergent** copy in `chat/RunConfirmCard.tsx` (1024-based `B/KB/MB/GB/TB` units + an `'unknown'` fallback). The chat run-confirmation card therefore showed a different byte figure than the rest of the app for the same scan.
**Problem / Change:** 4× duplication with a real user-visible inconsistency in the AI run-confirm card.
**Solution / Outcome:**
- **`src/shared/formatBytes.ts`** (new): single source of truth, the canonical decimal formatter (`KB`/`MB`/`GB`, 1000-based). Lives in `shared/` because both the main and renderer processes use it. Renderer imports via `@shared/formatBytes`; `bigquery.ts` imports by relative path (`../../shared/formatBytes`), matching the main process's convention.
- **Consumers repointed:** `ResultsToolbar.tsx` (import path swap), `ExplainPanel.tsx`, `RunConfirmCard.tsx`, and `bigquery.ts` (each drops its local copy and imports the shared one). `lib/formatBytes.ts` and its test deleted; the test relocated to `src/__tests__/shared/formatBytes.test.ts`.
- **Behavior change (intended):** `RunConfirmCard` now uses the canonical decimal formatter — the "Est. … scanned" label switches from 1024-based units to decimal, and `0` bytes renders `"0.0 KB"` instead of `"unknown"`. All other call sites are unchanged (their copies were byte-identical).
- **Coverage:** the helper moved out of the gated `lib/**` set into ungated `shared/**`, but stays fully covered by `src/__tests__/shared/formatBytes.test.ts`. `just ci` green.

**Files affected:**
- `src/shared/formatBytes.ts` — created
- `src/__tests__/shared/formatBytes.test.ts` — created
- `src/renderer/src/lib/formatBytes.ts`, `src/__tests__/renderer/lib/formatBytes.test.ts` — deleted
- `src/renderer/src/components/results/{ResultsToolbar,ExplainPanel}.tsx`, `src/renderer/src/components/chat/RunConfirmCard.tsx`, `src/main/db/bigquery.ts` — import the shared helper; local copies removed
```

- [ ] **Step 10: Run the full CI suite locally**

Run: `just ci`
Expected: PASS — typecheck + tests + coverage gate all green.

- [ ] **Step 11: Commit**

```bash
git add -A
git commit -m "refactor: consolidate formatBytes to shared helper; fix RunConfirmCard units"
```

---

## Done when

- `src/shared/formatBytes.ts` is the only `formatBytes` definition; all four former copies are gone.
- `ResultsToolbar`, `ExplainPanel`, `RunConfirmCard`, and `bigquery.ts` import it; `RunConfirmCard` now renders decimal units.
- The grep in Step 7 returns nothing.
- `just ci` is green.
- The `CLAUDE.md` Change Log has the 2026-06-23 `formatBytes` entry.
