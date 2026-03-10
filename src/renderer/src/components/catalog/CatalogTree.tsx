import { useEffect, useRef, useState } from 'react'
import { ChevronRight, ChevronDown, Table2, Layers, RefreshCw, MoreHorizontal, Copy, Check } from 'lucide-react'
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
    toggleDataset
  } = useCatalogStore()
  const { openTableTab } = useQueryStore()

  useEffect(() => {
    if (activeConnectionId) {
      loadDatasets(activeConnectionId)
    }
  }, [activeConnectionId, loadDatasets])

  if (!activeConnectionId) {
    return (
      <div className="p-4 flex flex-col gap-3">
        <p className="text-xs text-gray-600">No active connection.</p>
        <button onClick={onAddConnection} className="text-xs text-indigo-400 hover:text-indigo-300 text-left">
          + Add connection
        </button>
      </div>
    )
  }

  const activeConn = connections.find((c) => c.id === activeConnectionId)
  const isLoadingDatasets = !!isLoading[activeConnectionId]
  const datasets = datasetsByConnection[activeConnectionId] ?? []

  return (
    <div className="py-1">
      <div className="flex items-center justify-between px-3 py-1.5">
        <span className="text-[10px] uppercase tracking-widest text-gray-600 font-medium">Datasets</span>
        <button
          onClick={() => loadDatasets(activeConnectionId)}
          disabled={isLoadingDatasets}
          className="text-gray-600 hover:text-gray-400 transition-colors disabled:opacity-40"
        >
          <RefreshCw size={11} className={isLoadingDatasets ? 'animate-spin' : ''} />
        </button>
      </div>

      {isLoadingDatasets && datasets.length === 0 && (
        <div className="px-3 py-2 text-xs text-gray-600 animate-pulse">Loading datasets…</div>
      )}
      {!isLoadingDatasets && datasets.length === 0 && (
        <div className="px-3 py-2 text-xs text-gray-600">No datasets found.</div>
      )}

      {datasets.map((dataset) => {
        const key = `${activeConnectionId}:${dataset.id}`
        const isExpanded = expandedDatasets.has(dataset.id)
        const tables = tablesByDataset[key] ?? []
        const isTableLoading = !!isLoading[key]

        return (
          <div key={dataset.id}>
            {/* Dataset row */}
            <button
              onClick={() => {
                toggleDataset(dataset.id)
                if (!tablesByDataset[key]) loadTables(activeConnectionId, dataset.id)
              }}
              className="w-full flex items-center gap-1.5 px-3 py-1.5 text-xs text-gray-400 hover:bg-gray-800/60 hover:text-gray-200 transition-colors"
            >
              {isExpanded
                ? <ChevronDown size={11} className="text-gray-600 shrink-0" />
                : <ChevronRight size={11} className="text-gray-600 shrink-0" />
              }
              <Layers size={11} className="text-indigo-400 shrink-0" />
              <span className="truncate">{dataset.name}</span>
            </button>

            {/* Tables list */}
            {isExpanded && (
              <div className="ml-3 border-l border-gray-800">
                {isTableLoading ? (
                  <div className="px-3 py-1.5 text-xs text-gray-600 animate-pulse">Loading tables…</div>
                ) : tables.length === 0 ? (
                  <div className="px-3 py-1.5 text-xs text-gray-600">No tables.</div>
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

  // Close menu on outside click
  useEffect(() => {
    if (!menuOpen) return
    const handler = (e: MouseEvent) => {
      if (menuRef.current && !menuRef.current.contains(e.target as Node)) {
        setMenuOpen(false)
      }
    }
    document.addEventListener('mousedown', handler)
    return () => document.removeEventListener('mousedown', handler)
  }, [menuOpen])

  const handleCopy = async (e: React.MouseEvent) => {
    e.stopPropagation()
    await navigator.clipboard.writeText(ref)
    setCopied(true)
    setTimeout(() => {
      setCopied(false)
      setMenuOpen(false)
    }, 1000)
  }

  return (
    <div className="group relative flex items-center pr-1">
      {/* Clickable table name */}
      <button
        onClick={onOpen}
        className="flex-1 flex items-center gap-1.5 px-3 py-1.5 text-xs text-gray-500 hover:bg-gray-800/60 hover:text-gray-200 transition-colors text-left min-w-0"
      >
        <Table2 size={11} className="text-emerald-500 shrink-0" />
        <span className="truncate">{table.name}</span>
      </button>

      {/* "..." menu button — visible on hover */}
      <div ref={menuRef} className="relative shrink-0">
        <button
          onClick={(e) => {
            e.stopPropagation()
            setMenuOpen((v) => !v)
          }}
          className="opacity-0 group-hover:opacity-100 p-1 rounded text-gray-600 hover:text-gray-300 hover:bg-gray-700 transition-all"
          title="Table options"
        >
          <MoreHorizontal size={12} />
        </button>

        {menuOpen && (
          <div className="absolute right-0 top-full mt-0.5 z-50 bg-gray-800 border border-gray-700 rounded-lg shadow-xl py-1 w-52">
            <button
              onClick={handleCopy}
              className="w-full flex items-center gap-2 px-3 py-2 text-xs text-gray-300 hover:bg-gray-700 transition-colors"
            >
              {copied ? (
                <Check size={12} className="text-emerald-400 shrink-0" />
              ) : (
                <Copy size={12} className="shrink-0" />
              )}
              <span className="truncate">
                {copied ? 'Copied!' : `Copy · ${ref}`}
              </span>
            </button>
          </div>
        )}
      </div>
    </div>
  )
}
