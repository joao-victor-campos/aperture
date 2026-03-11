import { useEffect, useRef, useState } from 'react'
import { ChevronRight, ChevronDown, Table2, Layers, RefreshCw, MoreHorizontal, Copy, Check, Search, X } from 'lucide-react'
import { useCatalogStore } from '../../store/catalogStore'
import { useConnectionStore } from '../../store/connectionStore'
import { useQueryStore } from '../../store/queryStore'
import type { Table } from '@shared/types'

interface CatalogTreeProps {
  onAddConnection: () => void
}

export default function CatalogTree({ onAddConnection }: CatalogTreeProps) {
  const { activeConnectionId, connections } = useConnectionStore()
  const {
    datasetsByConnection,
    tablesByDataset,
    expandedDatasets,
    isLoading,
    loadDatasets,
    loadTables,
    toggleDataset,
  } = useCatalogStore()
  const { openTableTab } = useQueryStore()
  const [search, setSearch] = useState('')

  useEffect(() => {
    if (activeConnectionId) loadDatasets(activeConnectionId)
  }, [activeConnectionId, loadDatasets])

  if (!activeConnectionId) {
    return (
      <div className="p-4 flex flex-col gap-3">
        <p className="text-xs text-app-text-3">No active connection.</p>
        <button onClick={onAddConnection} className="text-xs text-app-accent-text hover:opacity-80 text-left">
          + Add connection
        </button>
      </div>
    )
  }

  const activeConn = connections.find((c) => c.id === activeConnectionId)
  const isLoadingDatasets = !!isLoading[activeConnectionId]
  const datasets = datasetsByConnection[activeConnectionId] ?? []
  const query = search.trim().toLowerCase()

  // Filter: show dataset if its name matches OR if any loaded table's name matches
  const visibleDatasets = query
    ? datasets.filter((ds) => {
        if (ds.name.toLowerCase().includes(query)) return true
        const key = `${activeConnectionId}:${ds.id}`
        return (tablesByDataset[key] ?? []).some((t) => t.name.toLowerCase().includes(query))
      })
    : datasets

  return (
    <div className="py-1">
      {/* Header row */}
      <div className="flex items-center justify-between px-3 py-1.5">
        <span className="text-[10px] uppercase tracking-widest text-app-text-3 font-medium">Datasets</span>
        <button
          onClick={() => loadDatasets(activeConnectionId)}
          disabled={isLoadingDatasets}
          className="text-app-text-3 hover:text-app-text-2 transition-colors disabled:opacity-40"
        >
          <RefreshCw size={11} className={isLoadingDatasets ? 'animate-spin' : ''} />
        </button>
      </div>

      {/* Search bar */}
      <div className="px-2 pb-1.5">
        <div className="relative flex items-center">
          <Search size={11} className="absolute left-2.5 text-app-text-3 pointer-events-none" />
          <input
            type="text"
            value={search}
            onChange={(e) => setSearch(e.target.value)}
            placeholder="Search tables…"
            className="w-full bg-app-elevated border border-app-border rounded-md pl-7 pr-6 py-1.5 text-xs text-app-text placeholder-app-text-3 focus:outline-none focus:border-app-accent transition-colors"
          />
          {search && (
            <button
              onClick={() => setSearch('')}
              className="absolute right-2 text-app-text-3 hover:text-app-text-2 transition-colors"
            >
              <X size={10} />
            </button>
          )}
        </div>
      </div>

      {isLoadingDatasets && datasets.length === 0 && (
        <div className="px-3 py-2 text-xs text-app-text-3 animate-pulse">Loading datasets…</div>
      )}
      {!isLoadingDatasets && datasets.length === 0 && (
        <div className="px-3 py-2 text-xs text-app-text-3">No datasets found.</div>
      )}
      {!isLoadingDatasets && datasets.length > 0 && visibleDatasets.length === 0 && (
        <div className="px-3 py-2 text-xs text-app-text-3">No matches for "{search}".</div>
      )}

      {visibleDatasets.map((dataset) => {
        const key = `${activeConnectionId}:${dataset.id}`
        const isExpanded = query ? true : expandedDatasets.has(dataset.id)
        const allTables = tablesByDataset[key] ?? []
        const tables = query
          ? allTables.filter((t) => t.name.toLowerCase().includes(query))
          : allTables
        const isTableLoading = !!isLoading[key]

        return (
          <div key={dataset.id}>
            <button
              onClick={() => {
                toggleDataset(dataset.id)
                if (!tablesByDataset[key]) loadTables(activeConnectionId, dataset.id)
              }}
              className="w-full flex items-center gap-1.5 px-3 py-1.5 text-xs text-app-text-2 hover:bg-app-elevated/60 hover:text-app-text transition-colors"
            >
              {isExpanded
                ? <ChevronDown size={11} className="text-app-text-3 shrink-0" />
                : <ChevronRight size={11} className="text-app-text-3 shrink-0" />
              }
              <Layers size={11} className="text-app-accent-text shrink-0" />
              <span className="truncate">{dataset.name}</span>
            </button>

            {isExpanded && (
              <div className="ml-3 border-l border-app-border">
                {isTableLoading ? (
                  <div className="px-3 py-1.5 text-xs text-app-text-3 animate-pulse">Loading tables…</div>
                ) : tables.length === 0 && !isTableLoading && allTables.length === 0 ? (
                  <div className="px-3 py-1.5 text-xs text-app-text-3">No tables.</div>
                ) : (
                  tables.map((table) => (
                    <TableRow
                      key={table.id}
                      table={table}
                      datasetId={dataset.id}
                      connectionId={activeConnectionId}
                      projectId={activeConn?.projectId ?? ''}
                      onOpen={() =>
                        openTableTab(
                          activeConnectionId,
                          activeConn?.projectId ?? '',
                          dataset.id,
                          table.id,
                          table.name
                        )
                      }
                    />
                  ))
                )}
              </div>
            )}
          </div>
        )
      })}
    </div>
  )
}

// ── TableRow ──────────────────────────────────────────────────────────────────

interface TableRowProps {
  table: Table
  datasetId: string
  connectionId: string
  projectId: string
  onOpen: () => void
}

function TableRow({ table, datasetId, onOpen }: TableRowProps) {
  const [menuOpen, setMenuOpen] = useState(false)
  const [copied, setCopied] = useState(false)
  const menuRef = useRef<HTMLDivElement>(null)
  const ref = `${datasetId}.${table.id}`

  useEffect(() => {
    if (!menuOpen) return
    const handler = (e: MouseEvent) => {
      if (menuRef.current && !menuRef.current.contains(e.target as Node)) setMenuOpen(false)
    }
    document.addEventListener('mousedown', handler)
    return () => document.removeEventListener('mousedown', handler)
  }, [menuOpen])

  const handleCopy = async (e: React.MouseEvent) => {
    e.stopPropagation()
    await navigator.clipboard.writeText(ref)
    setCopied(true)
    setTimeout(() => { setCopied(false); setMenuOpen(false) }, 1000)
  }

  return (
    <div className="group relative flex items-center pr-1">
      <button
        onClick={onOpen}
        className="flex-1 flex items-center gap-1.5 px-3 py-1.5 text-xs text-app-text-2 hover:bg-app-elevated/60 hover:text-app-text transition-colors text-left min-w-0"
      >
        <Table2 size={11} className="text-emerald-500 shrink-0" />
        <span className="truncate">{table.name}</span>
      </button>

      <div ref={menuRef} className="relative shrink-0">
        <button
          onClick={(e) => { e.stopPropagation(); setMenuOpen((v) => !v) }}
          className="opacity-0 group-hover:opacity-100 p-1 rounded text-app-text-3 hover:text-app-text-2 hover:bg-app-elevated transition-all"
          title="Table options"
        >
          <MoreHorizontal size={12} />
        </button>

        {menuOpen && (
          <div className="absolute right-0 top-full mt-0.5 z-50 bg-app-surface border border-app-border rounded-lg shadow-xl py-1 w-52">
            <button
              onClick={handleCopy}
              className="w-full flex items-center gap-2 px-3 py-2 text-xs text-app-text hover:bg-app-elevated transition-colors"
            >
              {copied
                ? <Check size={12} className="text-emerald-500 shrink-0" />
                : <Copy size={12} className="shrink-0" />
              }
              <span className="truncate">{copied ? 'Copied!' : `Copy · ${ref}`}</span>
            </button>
          </div>
        )}
      </div>
    </div>
  )
}
