import { useEffect, useRef, useState } from 'react'
import { ChevronRight, ChevronDown, Table2, Layers, RefreshCw, MoreHorizontal, Copy, Check, Search, X, Play, Circle, ArrowLeftRight } from 'lucide-react'
import { useCatalogStore } from '../../store/catalogStore'
import { useConnectionStore } from '../../store/connectionStore'
import { useQueryStore } from '../../store/queryStore'
import type { Table } from '@shared/types'
import { buildSelectQuery } from '../../lib/buildSelectQuery'
import { buildLabelQuery, buildRelationshipTypeQuery } from '../../lib/buildCypherQuery'
import { byName } from '../../lib/sortByName'

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
  const { openTableTab, openTab, tabs, activeTabId } = useQueryStore()
  // The currently-active table tab (if any) — used to highlight its row in the catalog
  const activeTableRef = tabs.find((t) => t.id === activeTabId && t.type === 'table')?.tableRef
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
  const activeEngine = activeConn?.engine ?? 'bigquery'
  const projectContextId = activeConn
    ? activeConn.engine === 'bigquery'
      ? activeConn.projectId
      : activeConn.engine === 'snowflake'
      ? activeConn.account
      : activeConn.database ?? ''
    : ''
  const isLoadingDatasets = !!isLoading[activeConnectionId]
  const datasets = datasetsByConnection[activeConnectionId] ?? []
  const query = search.trim().toLowerCase()

  // Filter: show dataset if its name matches OR if any loaded table's name matches
  const filteredDatasets = query
    ? datasets.filter((ds) => {
        if (ds.name.toLowerCase().includes(query)) return true
        const key = `${activeConnectionId}:${ds.id}`
        return (tablesByDataset[key] ?? []).some((t) => t.name.toLowerCase().includes(query))
      })
    : datasets
  // Render datasets alphabetically (sort a copy — never mutate store state)
  const visibleDatasets = [...filteredDatasets].sort(byName)

  return (
    <div className="py-1">
      {/* Header row */}
      <div className="flex items-center justify-between px-3 py-1.5">
        <span className="app-section-label">Datasets</span>
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
          <div key={dataset.id} className={isExpanded ? 'bg-app-accent-subtle/40' : ''}>
            <button
              onClick={() => {
                toggleDataset(dataset.id)
                if (!tablesByDataset[key]) loadTables(activeConnectionId, dataset.id)
              }}
              className={`w-full flex items-center gap-1.5 px-3 py-1.5 text-xs transition-colors ${
                isExpanded
                  ? 'text-app-text font-medium'
                  : 'text-app-text-2 hover:bg-app-elevated/60 hover:text-app-text'
              }`}
            >
              {isExpanded
                ? <ChevronDown size={11} className="text-app-text-3 shrink-0" />
                : <ChevronRight size={11} className="text-app-text-3 shrink-0" />
              }
              <Layers size={11} className="text-app-accent-text shrink-0" />
              <span className="truncate">{dataset.name}</span>
            </button>

            {isExpanded && (() => {
              const renderRow = (table: Table) => (
                <TableRow
                  key={table.id}
                  table={table}
                  datasetId={dataset.id}
                  connectionId={activeConnectionId}
                  isActive={
                    activeTableRef?.tableId === table.id &&
                    activeTableRef?.datasetId === dataset.id
                  }
                  onOpen={() =>
                    openTableTab(
                      activeConnectionId,
                      activeEngine,
                      projectContextId,
                      dataset.id,
                      table.id,
                      table.name,
                    )
                  }
                  onQueryTable={() => {
                    const sql =
                      activeEngine === 'neo4j'
                        ? table.type === 'RELATIONSHIP_TYPE'
                          ? buildRelationshipTypeQuery(table.id)
                          : buildLabelQuery(table.id)
                        : buildSelectQuery(activeEngine, projectContextId, dataset.id, table.id)
                    openTab({ sql, connectionId: activeConnectionId, title: table.name })
                  }}
                />
              )

              return (
                <div className="ml-3 border-l border-app-border">
                  {isTableLoading ? (
                    <div className="px-3 py-1.5 text-xs text-app-text-3 animate-pulse">Loading tables…</div>
                  ) : tables.length === 0 && allTables.length === 0 ? (
                    <div className="px-3 py-1.5 text-xs text-app-text-3">No tables.</div>
                  ) : activeEngine === 'neo4j' ? (
                    <>
                      {tables.some((t) => t.type === 'LABEL') && (
                        <div className="px-3 pt-1.5 pb-0.5"><span className="app-section-label">Labels</span></div>
                      )}
                      {tables.filter((t) => t.type === 'LABEL').map(renderRow)}
                      {tables.some((t) => t.type === 'RELATIONSHIP_TYPE') && (
                        <div className="px-3 pt-2 pb-0.5"><span className="app-section-label">Relationship Types</span></div>
                      )}
                      {tables.filter((t) => t.type === 'RELATIONSHIP_TYPE').map(renderRow)}
                    </>
                  ) : (
                    tables.map(renderRow)
                  )}
                </div>
              )
            })()}
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
  isActive?: boolean
  onOpen: () => void
  onQueryTable: () => void
}

function TableRow({ table, datasetId, isActive, onOpen, onQueryTable }: TableRowProps) {
  const [menuOpen, setMenuOpen] = useState(false)
  const [copied, setCopied] = useState(false)
  const menuRef = useRef<HTMLDivElement>(null)
  // Neo4j label / relationship type → teal; views → purple; tables → green
  const isLabel = table.type === 'LABEL'
  const isRelType = table.type === 'RELATIONSHIP_TYPE'
  // For graph kinds the bare label/type name is the useful reference; else dataset.table
  const ref = isLabel || isRelType ? table.id : `${datasetId}.${table.id}`

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

  const isView = table.type === 'VIEW' || table.type === 'MATERIALIZED_VIEW'
  const iconColor =
    isLabel || isRelType ? 'text-app-cat-teal' : isView ? 'text-app-cat-purple' : 'text-app-cat-green'
  const Icon = isRelType ? ArrowLeftRight : isLabel ? Circle : Table2

  return (
    <div
      className={`group relative flex items-center pr-1 ${
        isActive ? 'bg-app-accent-sub-2 border-l-2 border-app-accent -ml-px' : ''
      }`}
    >
      <button
        onClick={onOpen}
        className={`flex-1 flex items-center gap-1.5 px-3 py-1.5 text-xs transition-colors text-left min-w-0 ${
          isActive
            ? 'text-app-text font-semibold'
            : 'text-app-text-2 hover:bg-app-elevated/60 hover:text-app-text'
        }`}
      >
        <Icon size={11} className={`${iconColor} shrink-0`} />
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
              onClick={(e) => { e.stopPropagation(); onQueryTable(); setMenuOpen(false) }}
              className="w-full flex items-center gap-2 px-3 py-2 text-xs text-app-text hover:bg-app-elevated transition-colors"
            >
              <Play size={12} className="shrink-0 text-app-accent" />
              <span>Query table</span>
            </button>
            <button
              onClick={handleCopy}
              className="w-full flex items-center gap-2 px-3 py-2 text-xs text-app-text hover:bg-app-elevated transition-colors"
            >
              {copied
                ? <Check size={12} className="text-app-ok shrink-0" />
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
