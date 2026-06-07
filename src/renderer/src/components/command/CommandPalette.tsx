import { useEffect, useImperativeHandle, useLayoutEffect, useMemo, useRef, useState, forwardRef } from 'react'
import { createPortal } from 'react-dom'
import {
  Search, Table2, Bookmark, Clock, Plug, Plus, Settings, Play
} from 'lucide-react'
import { CHANNELS } from '@shared/ipc'
import type { TableSearchHit, Connection, ConnectionEngine } from '@shared/types'
import { useConnectionStore } from '../../store/connectionStore'
import { useSavedQueryStore } from '../../store/savedQueryStore'
import { useHistoryStore } from '../../store/historyStore'
import { useQueryStore } from '../../store/queryStore'
import { useCatalogStore } from '../../store/catalogStore'
import { rankCommands, groupByKind, type CommandItem, type CommandKind, type CommandIcon } from '../../lib/commandSearch'

export interface CommandPaletteHandle {
  /** Focus the input (used by the global ⌘K listener in App.tsx). */
  focus: () => void
}

interface CommandPaletteProps {
  onAddConnection: () => void
  onOpenSettings: () => void
  onShowShortcuts?: () => void
}

const SEARCH_DEBOUNCE_MS = 150
const MAX_TABLES = 8
const MAX_SAVED = 6
const MAX_HISTORY = 6

const KIND_LABEL: Record<CommandKind, string> = {
  table: 'Tables',
  saved: 'Saved queries',
  history: 'History',
  connection: 'Connections',
  action: 'Actions',
}

const ICON_MAP: Record<CommandIcon, typeof Search> = {
  table: Table2,
  bookmark: Bookmark,
  clock: Clock,
  plug: Plug,
  play: Play,
  settings: Settings,
  plus: Plus,
  wand: Search, // not currently used but kept for future Format SQL action
}

const ICON_COLOR: Record<CommandIcon, string> = {
  table: 'text-app-cat-green',
  bookmark: 'text-app-accent',
  clock: 'text-app-text-3',
  plug: 'text-app-cat-blue',
  play: 'text-app-accent',
  settings: 'text-app-text-2',
  plus: 'text-app-text-3',
  wand: 'text-app-text-3',
}

const CommandPalette = forwardRef<CommandPaletteHandle, CommandPaletteProps>(function CommandPalette(
  { onAddConnection, onOpenSettings, onShowShortcuts },
  ref,
) {
  // ── State ─────────────────────────────────────────────────────────────────
  const [open, setOpen] = useState(false)
  const [query, setQuery] = useState('')
  const [activeIndex, setActiveIndex] = useState(0)
  const [remoteTables, setRemoteTables] = useState<TableSearchHit[]>([])
  const [searching, setSearching] = useState(false)

  const inputRef = useRef<HTMLInputElement>(null)
  const wrapperRef = useRef<HTMLDivElement>(null)
  const popoverRef = useRef<HTMLDivElement>(null)
  const [popoverStyle, setPopoverStyle] = useState<{ top: number; left: number }>({ top: 0, left: 0 })

  // Latest debounce timer + latest query "generation" — used to discard stale IPC responses
  const debounceRef = useRef<ReturnType<typeof setTimeout> | null>(null)
  const searchGenRef = useRef(0)

  useImperativeHandle(ref, () => ({
    focus: () => {
      setOpen(true)
      // Defer to give the popover layout effect a frame to position
      requestAnimationFrame(() => {
        inputRef.current?.focus()
        inputRef.current?.select()
      })
    },
  }), [])

  // ── Stores ────────────────────────────────────────────────────────────────
  const { connections, activeConnectionId, setActive } = useConnectionStore()
  const { queries: savedQueries } = useSavedQueryStore()
  const { entries: historyEntries } = useHistoryStore()
  const { tabs, activeTabId, openTab, openTableTab, runQuery, cancelQuery } = useQueryStore()
  const { datasetsByConnection, tablesByDataset } = useCatalogStore()

  const activeConn = connections.find((c) => c.id === activeConnectionId)
  const activeTab = tabs.find((t) => t.id === activeTabId)

  // ── Close handlers ────────────────────────────────────────────────────────
  const close = () => {
    setOpen(false)
    setQuery('')
    setRemoteTables([])
    setActiveIndex(0)
    inputRef.current?.blur()
  }

  // Outside click closes the popover (input itself stays mounted)
  useEffect(() => {
    if (!open) return
    const handler = (e: MouseEvent) => {
      const target = e.target as Node
      if (
        wrapperRef.current && !wrapperRef.current.contains(target) &&
        popoverRef.current && !popoverRef.current.contains(target)
      ) {
        close()
      }
    }
    document.addEventListener('mousedown', handler)
    return () => document.removeEventListener('mousedown', handler)
  }, [open])

  // ── Popover positioning ───────────────────────────────────────────────────
  useLayoutEffect(() => {
    if (!open || !wrapperRef.current) return
    const r = wrapperRef.current.getBoundingClientRect()
    const popoverWidth = 480
    // Center the popover under the input (input is centered in the title bar)
    const left = r.left + r.width / 2 - popoverWidth / 2
    setPopoverStyle({ top: r.bottom + 6, left: Math.max(8, left) })
  }, [open, query])

  // ── Backend catalog search (debounced) ────────────────────────────────────
  useEffect(() => {
    if (debounceRef.current) clearTimeout(debounceRef.current)
    if (!open || !activeConnectionId || query.trim().length < 2) {
      setRemoteTables([])
      setSearching(false)
      return
    }
    setSearching(true)
    const gen = ++searchGenRef.current
    debounceRef.current = setTimeout(async () => {
      try {
        const hits = await window.api.invoke(CHANNELS.CATALOG_SEARCH_TABLES, {
          connectionId: activeConnectionId,
          query: query.trim(),
          limit: 50,
        })
        // Discard stale responses
        if (gen === searchGenRef.current) {
          setRemoteTables(hits)
          setSearching(false)
        }
      } catch {
        if (gen === searchGenRef.current) {
          setRemoteTables([])
          setSearching(false)
        }
      }
    }, SEARCH_DEBOUNCE_MS)
    return () => {
      if (debounceRef.current) clearTimeout(debounceRef.current)
    }
  }, [open, query, activeConnectionId])

  // ── Build the candidate items ─────────────────────────────────────────────
  const items: CommandItem[] = useMemo(() => {
    const out: CommandItem[] = []
    const q = query.trim().toLowerCase()

    // Tables — merge remote + local catalog cache, dedupe by datasetId:tableId
    if (activeConn && activeConnectionId) {
      const seen = new Set<string>()
      const projectContextId = projectContextFor(activeConn)
      const engine = activeConn.engine ?? 'bigquery'

      // Local cache first — instant
      if (q.length >= 2) {
        const datasets = datasetsByConnection[activeConnectionId] ?? []
        for (const ds of datasets) {
          const tables = tablesByDataset[`${activeConnectionId}:${ds.id}`] ?? []
          for (const t of tables) {
            if (!t.name.toLowerCase().includes(q)) continue
            const key = `${ds.id}:${t.id}`
            if (seen.has(key)) continue
            seen.add(key)
            const tableType = t.type === 'VIEW' || t.type === 'MATERIALIZED_VIEW' ? 'VIEW' : 'TABLE'
            out.push(makeTableItem(activeConnectionId, engine, projectContextId, ds.id, t.id, t.name, tableType, openTableTab))
            if (countOfKind(out, 'table') >= MAX_TABLES) break
          }
          if (countOfKind(out, 'table') >= MAX_TABLES) break
        }
      }

      // Remote results — fills in tables in unloaded datasets
      for (const hit of remoteTables) {
        const key = `${hit.datasetId}:${hit.tableId}`
        if (seen.has(key)) continue
        seen.add(key)
        out.push(makeTableItem(activeConnectionId, engine, projectContextId, hit.datasetId, hit.tableId, hit.name, hit.type, openTableTab))
        if (countOfKind(out, 'table') >= MAX_TABLES) break
      }
    }

    // Saved queries
    {
      const filtered = q.length > 0
        ? savedQueries.filter((s) => s.title.toLowerCase().includes(q) || s.sql.toLowerCase().includes(q))
        : [...savedQueries].sort((a, b) => +new Date(b.updatedAt) - +new Date(a.updatedAt)).slice(0, MAX_SAVED)
      for (const s of filtered.slice(0, MAX_SAVED)) {
        out.push({
          id: `saved:${s.id}`,
          kind: 'saved',
          label: s.title,
          sublabel: previewSql(s.sql),
          searchText: `${s.title} ${s.sql}`.toLowerCase(),
          icon: 'bookmark',
          action: () => {
            openTab({
              sql: s.sql,
              connectionId: s.connectionId ?? activeConnectionId ?? undefined,
              title: s.title,
              savedQueryId: s.id,
            })
          },
        })
      }
    }

    // History
    {
      const filtered = q.length > 0
        ? historyEntries.filter((h) => h.sql.toLowerCase().includes(q))
        : historyEntries.slice(0, MAX_HISTORY)
      for (const h of filtered.slice(0, MAX_HISTORY)) {
        out.push({
          id: `history:${h.id}`,
          kind: 'history',
          label: previewSql(h.sql),
          sublabel: `${h.connectionName} · ${h.rowCount.toLocaleString()} rows · ${h.durationMs}ms`,
          searchText: h.sql.toLowerCase(),
          icon: 'clock',
          action: () => {
            openTab({
              sql: h.sql,
              connectionId: h.connectionId ?? activeConnectionId ?? undefined,
              title: previewSql(h.sql, 30),
            })
          },
        })
      }
    }

    // Connections — only show when typing (avoid clutter in Recent mode)
    if (q.length > 0) {
      for (const c of connections) {
        if (c.id === activeConnectionId) continue
        const engine = c.engine ?? 'bigquery'
        out.push({
          id: `conn:${c.id}`,
          kind: 'connection',
          label: c.name,
          sublabel: engine,
          searchText: `switch ${c.name} ${engine}`.toLowerCase(),
          icon: 'plug',
          action: () => setActive(c.id),
        })
      }
    }

    // Static actions — always shown
    out.push({
      id: 'action:new-tab',
      kind: 'action',
      label: 'New query tab',
      searchText: 'new query tab open',
      icon: 'plus',
      action: () => openTab({ connectionId: activeConnectionId ?? undefined }),
    })
    if (activeTab && !activeTab.isRunning && activeTab.sql.trim() && activeTab.connectionId) {
      out.push({
        id: 'action:run',
        kind: 'action',
        label: 'Run query',
        sublabel: 'Run the active tab',
        searchText: 'run execute query',
        icon: 'play',
        action: () => runQuery(activeTab.id),
      })
    }
    if (activeTab && activeTab.isRunning) {
      out.push({
        id: 'action:cancel',
        kind: 'action',
        label: 'Cancel running query',
        searchText: 'cancel stop query',
        icon: 'play',
        action: () => cancelQuery(activeTab.id),
      })
    }
    out.push({
      id: 'action:add-connection',
      kind: 'action',
      label: 'Add connection…',
      searchText: 'add new connection',
      icon: 'plus',
      action: onAddConnection,
    })
    out.push({
      id: 'action:settings',
      kind: 'action',
      label: 'Settings',
      searchText: 'settings theme preferences',
      icon: 'settings',
      action: onOpenSettings,
    })
    if (onShowShortcuts) {
      out.push({
        id: 'action:shortcuts',
        kind: 'action',
        label: 'Keyboard shortcuts',
        searchText: 'keyboard shortcuts help keys cheatsheet hotkeys',
        icon: 'wand',
        action: onShowShortcuts,
      })
    }

    return out
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [query, remoteTables, activeConnectionId, activeConn, connections, savedQueries, historyEntries, datasetsByConnection, tablesByDataset, activeTab?.id, activeTab?.isRunning, activeTab?.sql, activeTab?.connectionId])

  // ── Rank + group ──────────────────────────────────────────────────────────
  const ranked = useMemo(() => rankCommands(items, query), [items, query])
  const grouped = useMemo(() => groupByKind(ranked), [ranked])
  const orderedKinds: CommandKind[] = ['table', 'saved', 'history', 'connection', 'action']
  // Flat list in display order — used for arrow-key navigation
  const displayItems = useMemo(() => {
    const flat: CommandItem[] = []
    for (const k of orderedKinds) flat.push(...grouped[k])
    return flat
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [grouped])

  // Reset selection when items change
  useEffect(() => {
    setActiveIndex(0)
  }, [query, displayItems.length])

  // ── Keyboard ──────────────────────────────────────────────────────────────
  const handleKeyDown = (e: React.KeyboardEvent<HTMLInputElement>) => {
    if (e.key === 'Escape') {
      e.preventDefault()
      close()
      return
    }
    if (e.key === 'Enter') {
      e.preventDefault()
      const item = displayItems[activeIndex]
      if (item) {
        item.action()
        close()
      }
      return
    }
    if (e.key === 'ArrowDown') {
      e.preventDefault()
      setActiveIndex((i) => (displayItems.length === 0 ? 0 : (i + 1) % displayItems.length))
      return
    }
    if (e.key === 'ArrowUp') {
      e.preventDefault()
      setActiveIndex((i) => (displayItems.length === 0 ? 0 : (i - 1 + displayItems.length) % displayItems.length))
      return
    }
  }

  // ── Render ────────────────────────────────────────────────────────────────
  return (
    <>
      <div
        ref={wrapperRef}
        style={{ WebkitAppRegion: 'no-drag' } as React.CSSProperties}
        className="relative flex items-center w-[360px] h-7 bg-app-surface border border-app-border rounded-md focus-within:border-app-accent/60 focus-within:ring-1 focus-within:ring-app-accent/20 transition-colors"
      >
        <Search size={11} className="absolute left-2.5 text-app-text-3 pointer-events-none" />
        <input
          ref={inputRef}
          type="text"
          value={query}
          onChange={(e) => { setQuery(e.target.value); setOpen(true) }}
          onFocus={() => setOpen(true)}
          onKeyDown={handleKeyDown}
          placeholder="Jump to table, query, or run…"
          className="w-full bg-transparent text-app-text text-ui pl-7 pr-12 outline-none placeholder-app-text-3"
        />
        <kbd className="app-kbd absolute right-2 pointer-events-none">⌘K</kbd>
      </div>

      {open && createPortal(
        <div
          ref={popoverRef}
          className="fixed z-[9999] w-[480px] max-h-[440px] overflow-y-auto bg-app-surface border border-app-border rounded-xl shadow-app-card"
          style={{ top: popoverStyle.top, left: popoverStyle.left }}
        >
          {displayItems.length === 0 ? (
            <div className="px-4 py-6 text-center text-xs text-app-text-3">
              {searching ? 'Searching…' : query.trim() ? `No matches for "${query.trim()}"` : 'Type to search…'}
            </div>
          ) : (
            orderedKinds.map((kind) => {
              const groupItems = grouped[kind]
              if (groupItems.length === 0) return null
              return (
                <div key={kind} className="py-1">
                  <div className="px-3 pt-2 pb-1">
                    <span className="app-section-label">
                      {KIND_LABEL[kind]}
                      {kind === 'table' && searching && <span className="ml-2 text-app-text-3 normal-case">searching…</span>}
                    </span>
                  </div>
                  {groupItems.map((item) => {
                    const flatIndex = displayItems.indexOf(item)
                    const isActive = flatIndex === activeIndex
                    const Icon = item.icon ? ICON_MAP[item.icon] : Search
                    const iconColor = item.icon ? ICON_COLOR[item.icon] : 'text-app-text-3'
                    return (
                      <button
                        key={item.id}
                        onMouseEnter={() => setActiveIndex(flatIndex)}
                        onClick={() => { item.action(); close() }}
                        className={`w-full flex items-center gap-2.5 px-3 py-1.5 text-left transition-colors ${
                          isActive
                            ? 'bg-app-accent-subtle border-l-2 border-app-accent pl-[10px]'
                            : 'border-l-2 border-transparent hover:bg-app-elevated/40'
                        }`}
                      >
                        <Icon size={12} className={`${iconColor} shrink-0`} />
                        <div className="flex-1 min-w-0 flex items-baseline gap-2">
                          <span className="text-ui-sm text-app-text truncate font-medium">{item.label}</span>
                          {item.sublabel && (
                            <span className="text-[10px] text-app-text-3 truncate font-tabular">{item.sublabel}</span>
                          )}
                        </div>
                        {isActive && <kbd className="app-kbd shrink-0">⏎</kbd>}
                      </button>
                    )
                  })}
                </div>
              )
            })
          )}
          {/* Footer hints */}
          <div className="flex items-center justify-between px-3 py-1.5 border-t border-app-border bg-app-bg/40 text-[10px] text-app-text-3">
            <span className="flex items-center gap-1.5">
              <kbd className="app-kbd">↑↓</kbd> navigate
              <kbd className="app-kbd ml-1">⏎</kbd> open
            </span>
            <span className="flex items-center gap-1.5">
              <kbd className="app-kbd">esc</kbd> close
            </span>
          </div>
        </div>,
        document.body
      )}
    </>
  )
})

export default CommandPalette

// ── Helpers ──────────────────────────────────────────────────────────────────

function countOfKind(items: CommandItem[], kind: CommandKind): number {
  let n = 0
  for (const i of items) if (i.kind === kind) n++
  return n
}

function previewSql(sql: string, max = 56): string {
  const clean = sql.replace(/\s+/g, ' ').trim()
  return clean.length <= max ? clean : clean.slice(0, max) + '…'
}

function projectContextFor(c: Connection): string {
  if (c.engine === 'bigquery') return c.projectId
  if (c.engine === 'snowflake') return c.account
  return c.database ?? ''
}

function makeTableItem(
  connectionId: string,
  engine: ConnectionEngine,
  projectContextId: string,
  datasetId: string,
  tableId: string,
  name: string,
  type: 'TABLE' | 'VIEW',
  openTableTab: (
    connectionId: string,
    engine: ConnectionEngine,
    projectId: string,
    datasetId: string,
    tableId: string,
    tableName: string
  ) => void,
): CommandItem {
  // Reference for sublabel (e.g. "dataset.table") — also makes table easier to disambiguate
  const ref = `${datasetId}.${tableId}`
  return {
    id: `table:${connectionId}:${ref}`,
    kind: 'table',
    label: name,
    sublabel: `${type === 'VIEW' ? 'view · ' : ''}${ref}`,
    // buildSelectQuery isn't called here — we only use it if user picks the row.
    // Including the ref in searchText so "schema.table" queries also match.
    searchText: `${name} ${ref}`.toLowerCase(),
    icon: 'table',
    action: () => openTableTab(connectionId, engine, projectContextId, datasetId, tableId, name),
  }
}

