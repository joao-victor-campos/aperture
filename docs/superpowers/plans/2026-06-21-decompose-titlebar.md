# Decompose `TitleBar.tsx` (TD-4) Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Split the 310-line, most-churned `TitleBar.tsx` into focused units — a connection menu, an actions cluster, a status dot, and pure metadata helpers — leaving `TitleBar` a thin layout shell, with zero behavior change.

**Architecture:** `TitleBar` becomes a layout shell: traffic-light spacer + brand + a left **`ConnectionMenu`** (breadcrumb trigger + "add" button + the portal dropdown with the edit/delete-confirm state machine) + the centered `CommandPalette` + a right **`TitleBarActions`** cluster (AI chat toggle + settings/update badge). `ConnectionMenu` reads `connectionStore`/`queryStore` itself (as today); `TitleBarActions` reads `updateStore`. Pure metadata functions (`connectionLabel`, `engineAccent`, `engineColor`) and the `StatusDot` component move out. No prop-surface or behavior change.

**Tech Stack:** React 18 + TypeScript (strict), `react-dom` portal, Tailwind, Vitest.

**Source of truth:** the current `src/renderer/src/components/layout/TitleBar.tsx` (read it; this plan cites its line ranges).

## Global Constraints

- TypeScript strict mode; no `any`.
- **No behavior change.** Identical DOM/classes; identical interactions (breadcrumb dropdown open/close/position, outside-click, per-engine accent colors, status dots, edit, delete-confirm with 3s auto-dismiss, re-point focused tab on select, add-connection, AI toggle `aria-pressed`, settings update badge, `WebkitAppRegion` drag/no-drag regions, macOS traffic-light spacer).
- `TitleBar` keeps its **default export** and its existing `TitleBarProps` (consumed by `App.tsx`) — do not change the public prop surface.
- The `CommandPalette` slot and its `paletteRef` forwarding must stay exactly as-is (global ⌘K depends on it).
- No component-test infra exists (`@testing-library` absent). Verification per task = `npx tsc --noEmit -p tsconfig.web.json` clean + `npx vitest run` stays green (502 tests). The pure `lib/connectionMeta.ts` (Task 1) gets real unit tests. Final task = manual verification in the running app.
- Tailwind utility classes only; reuse the exact class strings being moved, including the inline `WebkitAppRegion` style objects.
- Work on the current branch `feat/tier2-decomposition`; commit per task.

## File Structure

New files:
- `src/renderer/src/lib/connectionMeta.ts` — `connectionLabel(c)`, `engineAccent(engine)`, `engineColor(engine)`.
- `src/renderer/src/components/layout/StatusDot.tsx` — the health dot.
- `src/renderer/src/components/layout/ConnectionMenu.tsx` — breadcrumb + add button + portal dropdown + delete-confirm state.
- `src/renderer/src/components/layout/TitleBarActions.tsx` — AI chat toggle + settings/update badge.

Modified:
- `src/renderer/src/components/layout/TitleBar.tsx` — thin shell (~55 lines).

**Convention for moved JSX:** each task gives the new file in full and the exact `TitleBar` edit. Where a block is moved verbatim, the cited line range is the authority — copy it exactly, changing only references that now come from props/imports.

---

### Task 1: Extract pure metadata helpers to `lib/connectionMeta.ts` (with tests)

**Files:**
- Create: `src/renderer/src/lib/connectionMeta.ts`
- Create: `src/__tests__/renderer/lib/connectionMeta.test.ts`
- Modify: `src/renderer/src/components/layout/TitleBar.tsx`

**Interfaces:**
- Produces:
  - `connectionLabel(c: Connection): string`
  - `engineAccent(engine: string): string`
  - `engineColor(engine: string): string`

- [ ] **Step 1: Write the failing test**

`src/__tests__/renderer/lib/connectionMeta.test.ts`:

```ts
import { describe, it, expect } from 'vitest'
import { connectionLabel, engineAccent, engineColor } from '../../../renderer/src/lib/connectionMeta'
import type { Connection } from '../../../shared/types'

const base = { id: '1', name: 'c', createdAt: '2024-01-01T00:00:00.000Z' }

describe('connectionLabel', () => {
  it('BigQuery → projectId', () => {
    expect(connectionLabel({ ...base, engine: 'bigquery', projectId: 'proj-x' } as Connection)).toBe('proj-x')
  })
  it('Snowflake → account', () => {
    expect(connectionLabel({ ...base, engine: 'snowflake', account: 'acct-1' } as Connection)).toBe('acct-1')
  })
  it('Neo4j → database, falling back to uri', () => {
    expect(connectionLabel({ ...base, engine: 'neo4j', database: 'graph', uri: 'neo4j://h' } as Connection)).toBe('graph')
    expect(connectionLabel({ ...base, engine: 'neo4j', database: '', uri: 'neo4j://h' } as Connection)).toBe('neo4j://h')
  })
  it('Postgres → database, falling back to host', () => {
    expect(connectionLabel({ ...base, engine: 'postgres', database: 'db', host: 'h' } as Connection)).toBe('db')
  })
})

describe('engineAccent / engineColor', () => {
  it('map known engines', () => {
    expect(engineAccent('bigquery')).toBe('text-app-cat-blue')
    expect(engineAccent('snowflake')).toBe('text-app-accent-text')
    expect(engineAccent('postgres')).toBe('text-app-cat-purple')
    expect(engineAccent('neo4j')).toBe('text-app-cat-teal')
    expect(engineColor('bigquery')).toBe('text-app-cat-blue')
  })
  it('use distinct fallbacks for unknown engines', () => {
    expect(engineAccent('???')).toBe('text-app-text-3')
    expect(engineColor('???')).toBe('text-app-text')
  })
})
```

- [ ] **Step 2: Run test to verify it fails**

Run: `npx vitest run src/__tests__/renderer/lib/connectionMeta.test.ts`
Expected: FAIL — cannot find module `connectionMeta`.

- [ ] **Step 3: Create `connectionMeta.ts`**

Move `connectionLabel` (TitleBar.tsx:23–29) and `engineAccent` (296–303) verbatim, and add `engineColor` derived from the inline mapping at TitleBar.tsx:102–107 (note the distinct fallbacks: `engineColor` → `text-app-text`, `engineAccent` → `text-app-text-3`).

```ts
import type {
  BigQueryConnection, Connection, Neo4jConnection, PostgresConnection, SnowflakeConnection,
} from '@shared/types'

export function connectionLabel(c: Connection): string {
  const engine = c.engine ?? 'bigquery'
  if (engine === 'bigquery') return (c as BigQueryConnection).projectId
  if (engine === 'snowflake') return (c as SnowflakeConnection).account
  if (engine === 'neo4j') return (c as Neo4jConnection).database || (c as Neo4jConnection).uri
  return (c as PostgresConnection).database ?? (c as PostgresConnection).host
}

/** Categorical accent used in the dropdown row subtitle (unknown → muted text-3). */
export function engineAccent(engine: string): string {
  if (engine === 'bigquery') return 'text-app-cat-blue'
  if (engine === 'snowflake') return 'text-app-accent-text'
  if (engine === 'postgres') return 'text-app-cat-purple'
  if (engine === 'neo4j') return 'text-app-cat-teal'
  return 'text-app-text-3'
}

/** Accent for the breadcrumb engine name (unknown → default text). */
export function engineColor(engine: string): string {
  if (engine === 'bigquery') return 'text-app-cat-blue'
  if (engine === 'snowflake') return 'text-app-accent-text'
  if (engine === 'postgres') return 'text-app-cat-purple'
  if (engine === 'neo4j') return 'text-app-cat-teal'
  return 'text-app-text'
}
```

- [ ] **Step 4: Update TitleBar to import from lib**

In `TitleBar.tsx`: delete the local `connectionLabel` (23–29) and `engineAccent` (296–303) functions, and replace the inline `engineColor` computation (102–107) with a call. Add import:

```ts
import { connectionLabel, engineAccent, engineColor } from '../../lib/connectionMeta'
```

Change lines 100–107 to:

```ts
  const engineLabel = activeConn ? (activeConn.engine ?? 'bigquery') : null
  const engineColorClass = engineLabel ? engineColor(engineLabel) : 'text-app-text'
```

and update the breadcrumb usage (line 137) from `${engineColor}` to `${engineColorClass}`. (`connectionLabel`/`engineAccent` calls in the dropdown stay, now resolving to the imports.)

- [ ] **Step 5: Verify**

Run: `npx vitest run src/__tests__/renderer/lib/connectionMeta.test.ts` → PASS.
Run: `npx tsc --noEmit -p tsconfig.web.json` → clean.

- [ ] **Step 6: Commit**

```bash
git add src/renderer/src/lib/connectionMeta.ts src/__tests__/renderer/lib/connectionMeta.test.ts \
        src/renderer/src/components/layout/TitleBar.tsx
git commit -m "refactor(titlebar): extract connectionMeta helpers to lib (TD-4)"
```

---

### Task 2: Extract `StatusDot` to its own file

**Files:**
- Create: `src/renderer/src/components/layout/StatusDot.tsx`
- Modify: `src/renderer/src/components/layout/TitleBar.tsx`

**Interfaces:**
- Consumes: `ConnectionStatus` from `connectionStore`.
- Produces: `StatusDot({ status }: { status: ConnectionStatus })` (default export).

- [ ] **Step 1: Create `StatusDot.tsx`**

Move the component verbatim (TitleBar.tsx:305–310).

```tsx
import type { ConnectionStatus } from '../../store/connectionStore'

export default function StatusDot({ status }: { status: ConnectionStatus }) {
  // Design-system primitives (.app-dot with halo glow); fallback grey for unknown
  if (status === 'ok') return <span className="app-dot app-dot--ok shrink-0" />
  if (status === 'error') return <span className="app-dot app-dot--err shrink-0" />
  return <span className="app-dot shrink-0" style={{ backgroundColor: 'rgb(var(--c-text-3))' }} />
}
```

- [ ] **Step 2: Update TitleBar**

Delete the local `StatusDot` function (305–310). Add `import StatusDot from './StatusDot'`. The two `<StatusDot status=... />` usages (lines 134, 233) now resolve to the import. If, after this task, `TitleBar` no longer references the `ConnectionStatus` type directly, remove that type import (verify with `tsc`).

- [ ] **Step 3: Verify** — `npx tsc --noEmit -p tsconfig.web.json` clean; `npx vitest run` → 502 passing.

- [ ] **Step 4: Commit**

```bash
git add src/renderer/src/components/layout/StatusDot.tsx src/renderer/src/components/layout/TitleBar.tsx
git commit -m "refactor(titlebar): extract StatusDot component (TD-4)"
```

---

### Task 3: Extract `ConnectionMenu` (breadcrumb + add + dropdown)

**Files:**
- Create: `src/renderer/src/components/layout/ConnectionMenu.tsx`
- Modify: `src/renderer/src/components/layout/TitleBar.tsx`

**Interfaces:**
- Consumes: `useConnectionStore`, `useQueryStore`, `StatusDot`, `connectionLabel`/`engineAccent`/`engineColor`.
- Produces: `ConnectionMenu({ onAddConnection, onEditConnection }: { onAddConnection: () => void; onEditConnection: (c: Connection) => void })` (default export).

This is the churn-magnet core: the breadcrumb trigger, the "+" add button, and the portal dropdown with the full delete-confirm state machine. It reads the stores directly, exactly as `TitleBar` does today.

- [ ] **Step 1: Create `ConnectionMenu.tsx`**

Move: state (open/deletingId/confirmDeleteId/confirmTimeoutRef/triggerRef/menuRef/menuStyle — TitleBar 33–41), `activeConn`/position effect/outside-click effect/unmount cleanup (44, 47–72), `clearPendingConfirm`/`requestDelete`/`cancelDelete`/`confirmDelete` (74–97), `engineLabel`/`engineColorClass` (100–101 after Task 1), the breadcrumb button (127–146), the add button (148–156), and the portal dropdown (204–291).

```tsx
import { useEffect, useLayoutEffect, useRef, useState } from 'react'
import { createPortal } from 'react-dom'
import { Plus, ChevronDown, Trash2, Pencil } from 'lucide-react'
import { useConnectionStore } from '../../store/connectionStore'
import { useQueryStore } from '../../store/queryStore'
import type { Connection } from '@shared/types'
import StatusDot from './StatusDot'
import { connectionLabel, engineAccent, engineColor } from '../../lib/connectionMeta'

interface ConnectionMenuProps {
  onAddConnection: () => void
  onEditConnection: (conn: Connection) => void
}

export default function ConnectionMenu({ onAddConnection, onEditConnection }: ConnectionMenuProps) {
  const { connections, activeConnectionId, setActive, remove, statuses } = useConnectionStore()
  const [open, setOpen] = useState(false)
  const [deletingId, setDeletingId] = useState<string | null>(null)
  const [confirmDeleteId, setConfirmDeleteId] = useState<string | null>(null)
  const confirmTimeoutRef = useRef<ReturnType<typeof setTimeout> | null>(null)
  const triggerRef = useRef<HTMLButtonElement>(null)
  const menuRef = useRef<HTMLDivElement>(null)
  const [menuStyle, setMenuStyle] = useState<{ top: number; left: number }>({ top: 0, left: 0 })

  const activeConn = connections.find((c) => c.id === activeConnectionId)

  useLayoutEffect(() => {
    if (open && triggerRef.current) {
      const r = triggerRef.current.getBoundingClientRect()
      setMenuStyle({ top: r.bottom + 4, left: r.left })
    }
  }, [open])

  useEffect(() => {
    if (!open) return
    const handler = (e: MouseEvent) => {
      const target = e.target as Node
      if (
        triggerRef.current && !triggerRef.current.contains(target) &&
        menuRef.current && !menuRef.current.contains(target)
      ) {
        setOpen(false)
        clearPendingConfirm()
      }
    }
    document.addEventListener('mousedown', handler)
    return () => document.removeEventListener('mousedown', handler)
  }, [open])

  useEffect(() => () => { if (confirmTimeoutRef.current) clearTimeout(confirmTimeoutRef.current) }, [])

  const clearPendingConfirm = () => {
    if (confirmTimeoutRef.current) clearTimeout(confirmTimeoutRef.current)
    setConfirmDeleteId(null)
  }
  const requestDelete = (e: React.MouseEvent, id: string) => {
    e.stopPropagation()
    if (confirmTimeoutRef.current) clearTimeout(confirmTimeoutRef.current)
    setConfirmDeleteId(id)
    confirmTimeoutRef.current = setTimeout(() => setConfirmDeleteId(null), 3000)
  }
  const cancelDelete = (e: React.MouseEvent) => {
    e.stopPropagation()
    clearPendingConfirm()
  }
  const confirmDelete = async (e: React.MouseEvent, id: string) => {
    e.stopPropagation()
    clearPendingConfirm()
    setDeletingId(id)
    await remove(id)
    setDeletingId(null)
  }

  const engineLabel = activeConn ? (activeConn.engine ?? 'bigquery') : null
  const engineColorClass = engineLabel ? engineColor(engineLabel) : 'text-app-text'

  return (
    <>
      {connections.length > 0 && (
        <button
          ref={triggerRef}
          onClick={() => setOpen((v) => !v)}
          style={{ WebkitAppRegion: 'no-drag' } as React.CSSProperties}
          className="flex items-center gap-1.5 px-2 py-1 rounded-md text-ui hover:bg-app-elevated transition-colors max-w-72"
        >
          {activeConn && <StatusDot status={statuses[activeConn.id] ?? 'unknown'} />}
          {activeConn ? (
            <>
              <span className={`font-semibold truncate ${engineColorClass}`}>{engineLabel}</span>
              <span className="text-app-text-3">/</span>
              <span className="text-app-text truncate">{activeConn.name}</span>
            </>
          ) : (
            <span className="text-app-text-2">Select connection</span>
          )}
          <ChevronDown size={11} className="shrink-0 text-app-text-3" />
        </button>
      )}

      <button
        onClick={onAddConnection}
        title="Add connection"
        style={{ WebkitAppRegion: 'no-drag' } as React.CSSProperties}
        className="flex items-center justify-center w-6 h-6 rounded-md text-app-text-3 hover:text-app-text hover:bg-app-elevated transition-colors"
      >
        <Plus size={13} />
      </button>

      {open && createPortal(
        <div
          ref={menuRef}
          className="fixed z-[9999] bg-app-surface border border-app-border rounded-lg shadow-xl py-1 min-w-64"
          style={{ top: menuStyle.top, left: menuStyle.left, WebkitAppRegion: 'no-drag' } as React.CSSProperties}
        >
          {connections.map((c) => (
            <div
              key={c.id}
              className={`group flex items-center gap-1 px-2 py-1.5 cursor-pointer transition-colors ${
                c.id === activeConnectionId ? 'bg-app-accent-subtle' : 'hover:bg-app-elevated'
              }`}
              style={{ WebkitAppRegion: 'no-drag' } as React.CSSProperties}
              onClick={() => {
                if (confirmDeleteId !== c.id) {
                  const qs = useQueryStore.getState()
                  const focusedTabId = qs.activeByGroup[qs.focusedGroup]
                  if (focusedTabId) qs.setTabConnection(focusedTabId, c.id)
                  setActive(c.id)
                  setOpen(false)
                }
              }}
            >
              <StatusDot status={statuses[c.id] ?? 'unknown'} />
              <div className="flex-1 min-w-0 px-1">
                <div className="text-xs font-medium text-app-text truncate">{c.name}</div>
                <div className="text-[10px] text-app-text-3 truncate font-tabular">
                  <span className={engineAccent(c.engine ?? 'bigquery')}>{c.engine ?? 'bigquery'}</span>
                  {' · '}{connectionLabel(c)}
                </div>
              </div>
              {confirmDeleteId === c.id ? (
                <div className="flex items-center gap-1 shrink-0" onClick={(e) => e.stopPropagation()}>
                  <span className="text-[10px] text-app-text-3 mr-0.5">Delete?</span>
                  <button
                    onClick={cancelDelete}
                    className="text-[10px] px-1.5 py-0.5 rounded text-app-text-2 hover:text-app-text transition-colors"
                  >
                    No
                  </button>
                  <button
                    onClick={(e) => confirmDelete(e, c.id)}
                    disabled={deletingId === c.id}
                    className="text-[10px] px-1.5 py-0.5 rounded bg-app-err-subtle text-app-err hover:bg-app-err-subtle/80 transition-colors disabled:opacity-40"
                  >
                    Yes
                  </button>
                </div>
              ) : (
                <div className="opacity-0 group-hover:opacity-100 flex items-center gap-0.5 shrink-0 transition-opacity">
                  <button
                    onClick={(e) => { e.stopPropagation(); setOpen(false); onEditConnection(c) }}
                    title="Edit connection"
                    className="p-1.5 rounded text-app-text-3 hover:text-app-text hover:bg-app-elevated/60 transition-all"
                  >
                    <Pencil size={11} />
                  </button>
                  <button
                    onClick={(e) => requestDelete(e, c.id)}
                    title="Delete connection"
                    className="p-1.5 rounded text-app-text-3 hover:text-app-err hover:bg-app-err-subtle/60 transition-all"
                  >
                    <Trash2 size={12} />
                  </button>
                </div>
              )}
            </div>
          ))}
        </div>,
        document.body
      )}
    </>
  )
}
```

- [ ] **Step 2: Wire into TitleBar**

In `TitleBar.tsx`: delete all the moved state, refs, effects, handlers, and `activeConn`/`engineLabel`/`engineColorClass` (lines 32–52, 54–101 except keep `updateAvailable` at 43), and the breadcrumb (127–146), add button (148–156), and portal dropdown (203–291). The `useConnectionStore` destructure and `useQueryStore` import move into `ConnectionMenu` — remove them from TitleBar if unused there (verify with `tsc`). Add `import ConnectionMenu from './ConnectionMenu'`. In the left flex group, replace the breadcrumb+add block with:

```tsx
        <ConnectionMenu onAddConnection={onAddConnection} onEditConnection={onEditConnection} />
```

- [ ] **Step 3: Verify** — `npx tsc --noEmit -p tsconfig.web.json` clean; `npx vitest run` → 502 passing.

- [ ] **Step 4: Commit**

```bash
git add src/renderer/src/components/layout/ConnectionMenu.tsx src/renderer/src/components/layout/TitleBar.tsx
git commit -m "refactor(titlebar): extract ConnectionMenu (breadcrumb + dropdown) (TD-4)"
```

---

### Task 4: Extract `TitleBarActions` (AI toggle + settings)

**Files:**
- Create: `src/renderer/src/components/layout/TitleBarActions.tsx`
- Modify: `src/renderer/src/components/layout/TitleBar.tsx`

**Interfaces:**
- Consumes: `useUpdateStore`.
- Produces: `TitleBarActions({ onOpenSettings, onToggleChat, chatOpen }: { onOpenSettings: () => void; onToggleChat?: () => void; chatOpen?: boolean })` (default export).

- [ ] **Step 1: Create `TitleBarActions.tsx`**

Move the AI chat toggle (TitleBar 172–184) and the settings button + update badge (186–200), plus the `updateAvailable` subscription (43).

```tsx
import { Settings, Sparkles } from 'lucide-react'
import { useUpdateStore } from '../../store/updateStore'

interface TitleBarActionsProps {
  onOpenSettings: () => void
  onToggleChat?: () => void
  chatOpen?: boolean
}

export default function TitleBarActions({ onOpenSettings, onToggleChat, chatOpen }: TitleBarActionsProps) {
  const updateAvailable = useUpdateStore((s) => s.status?.updateAvailable ?? false)

  return (
    <>
      <button
        type="button"
        onClick={onToggleChat}
        aria-label="Toggle AI assistant"
        aria-pressed={chatOpen}
        style={{ WebkitAppRegion: 'no-drag' } as React.CSSProperties}
        className={`p-1.5 rounded-md transition-colors ${
          chatOpen ? 'text-app-accent-text bg-app-accent-subtle' : 'text-app-text-3 hover:text-app-text hover:bg-app-elevated'
        }`}
      >
        <Sparkles size={15} />
      </button>

      <button
        onClick={onOpenSettings}
        title={updateAvailable ? 'Settings — update available' : 'Settings'}
        style={{ WebkitAppRegion: 'no-drag' } as React.CSSProperties}
        className="relative p-1.5 rounded-md text-app-text-2 hover:text-app-text hover:bg-app-elevated transition-colors"
      >
        <Settings size={14} />
        {updateAvailable && (
          <span
            className="absolute top-0.5 right-0.5 w-2 h-2 rounded-full bg-app-accent ring-2 ring-app-bg"
            aria-label="Update available"
          />
        )}
      </button>
    </>
  )
}
```

- [ ] **Step 2: Wire into TitleBar**

Delete the `updateAvailable` line (43), the AI toggle (172–184), and the settings button (186–200). Add `import TitleBarActions from './TitleBarActions'`. Replace the right-cluster buttons with:

```tsx
        <TitleBarActions onOpenSettings={onOpenSettings} onToggleChat={onToggleChat} chatOpen={chatOpen} />
```

Remove the now-unused `Settings`, `Sparkles` lucide imports and the `useUpdateStore` import from TitleBar (verify with `tsc`).

- [ ] **Step 3: Verify** — `npx tsc --noEmit -p tsconfig.web.json` clean; `npx vitest run` → 502 passing.

- [ ] **Step 4: Commit**

```bash
git add src/renderer/src/components/layout/TitleBarActions.tsx src/renderer/src/components/layout/TitleBar.tsx
git commit -m "refactor(titlebar): extract TitleBarActions cluster (TD-4)"
```

---

### Task 5: Thin shell + manual verification + docs

**Files:**
- Modify: `src/renderer/src/components/layout/TitleBar.tsx` (import hygiene), `CHANGELOG.md`, `CLAUDE.md`

- [ ] **Step 1: Confirm the thin shell**

`TitleBar.tsx` should now be ~55 lines: imports (`ApertureIcon`, `CommandPalette` + its handle type, `ConnectionMenu`, `TitleBarActions`, the `Connection`/`CommandPaletteHandle` types, `RefObject`), the unchanged `TitleBarProps`, and a return that is purely layout:

```tsx
  return (
    <div
      className="h-[46px] flex items-center px-4 gap-3 border-b border-app-border bg-app-bg shrink-0"
      style={{ WebkitAppRegion: 'drag' } as React.CSSProperties}
    >
      <div className={`${window.platform === 'darwin' ? 'w-16' : 'w-4'} shrink-0`} />
      <div className="flex items-center gap-2 shrink-0">
        <ApertureIcon size={16} />
        <span className="text-app-text font-semibold uppercase tracking-caps text-[12px]">Aperture</span>
      </div>
      <div className="flex items-center gap-2 ml-3 flex-1">
        <ConnectionMenu onAddConnection={onAddConnection} onEditConnection={onEditConnection} />
        <div className="flex-1" />
        <CommandPalette ref={paletteRef} onAddConnection={onAddConnection} onOpenSettings={onOpenSettings} onShowShortcuts={onShowShortcuts} />
        <div className="flex-1" />
        <TitleBarActions onOpenSettings={onOpenSettings} onToggleChat={onToggleChat} chatOpen={chatOpen} />
      </div>
    </div>
  )
```

Run `npx tsc --noEmit -p tsconfig.web.json` and remove every now-unused import (`createPortal`, the lucide icons, `useConnectionStore`, `ConnectionStatus`, `useUpdateStore`, `useQueryStore`, the connection sub-type imports — most should be gone). The only stores/types TitleBar still references are what its props need.

- [ ] **Step 2: Full CI**

Run: `just ci`
Expected: typecheck clean; 502 + new `connectionMeta` tests pass; coverage gate holds (new `lib/connectionMeta.ts` sits outside the include set like other `lib/*` helpers; the `layout/*` components are outside it too).

- [ ] **Step 3: Manual verification (the real safety net)**

Run `just dev` and verify each interaction is unchanged:
- Breadcrumb shows `engine / name` with the correct per-engine accent color and a status dot; "Select connection" when none active.
- Click breadcrumb → dropdown opens positioned under the trigger; click outside → closes (and clears any pending delete confirm).
- Each dropdown row: status dot, name, `engine · label` subtitle with engine accent; active row highlighted.
- Click a row → re-points the focused editor tab's connection, sets active, closes (sidebar follows).
- Hover a row → Pencil + Trash appear; Pencil → opens edit modal + closes dropdown; Trash → inline "Delete? No/Yes", auto-dismiss after 3s, Yes removes (disabled while deleting).
- "+" → opens add-connection modal.
- AI Sparkles toggle reflects `chatOpen` (accent bg + `aria-pressed`).
- Settings gear opens settings; the terracotta update dot shows only when an update is available.
- Window drag still works on the bar background; buttons remain clickable (no-drag regions intact). Traffic-light spacer width correct on macOS.

Capture a screenshot of the title bar with the dropdown open for the PR.

- [ ] **Step 4: Docs + commit**

Add a CHANGELOG "Changed" line (internal: TitleBar decomposed into ConnectionMenu/TitleBarActions/StatusDot + connectionMeta, no behavior change) and a CLAUDE.md change-log entry following the existing format. Then:

```bash
git add CHANGELOG.md CLAUDE.md src/renderer/src/components/layout/TitleBar.tsx
git commit -m "docs: TitleBar decomposition (TD-4) changelog + change-log"
```

---

## Self-Review notes (for the implementer)

- **Behavior parity is the whole point.** Moved blocks keep exact classes, `WebkitAppRegion` style objects, `aria-*`, and logic; only the store/prop wiring changes.
- **`ConnectionMenu` reads the stores itself** (as `TitleBar` did) — it is not a pure presentational component, and that's intentional: it encapsulates all connection-switching concerns, which is what makes the churn magnet self-contained.
- **The `CommandPalette` slot stays in `TitleBar`** with its `paletteRef` — do not move it into a child (global ⌘K targets it).
- **`engineColor` vs `engineAccent` have different unknown-engine fallbacks** (`text-app-text` vs `text-app-text-3`) — keep them distinct.
