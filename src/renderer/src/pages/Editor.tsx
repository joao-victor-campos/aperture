import { useEffect, useRef, useState } from 'react'
import { Plus, X, Table2 } from 'lucide-react'
import QueryEditor from '../components/editor/QueryEditor'
import ResultsTable from '../components/results/ResultsTable'
import TableDetailPanel from '../components/catalog/TableDetailPanel'
import { useQueryStore } from '../store/queryStore'
import { useConnectionStore } from '../store/connectionStore'

export default function Editor() {
  const { tabs, activeTabId, openTab, closeTab, setActiveTab, updateTabSql, runQuery, cancelQuery } =
    useQueryStore()
  const { activeConnectionId } = useConnectionStore()
  const [splitPct, setSplitPct] = useState(55)
  const isDragging = useRef(false)
  const containerRef = useRef<HTMLDivElement>(null)

  // Open a default tab on mount
  useEffect(() => {
    if (tabs.length === 0) {
      openTab({ connectionId: activeConnectionId ?? undefined })
    }
  }, [])

  // Sync active connection into the active tab when it changes
  useEffect(() => {
    if (!activeConnectionId || !activeTabId) return
    useQueryStore.setState((s) => ({
      tabs: s.tabs.map((t) =>
        t.id === activeTabId ? { ...t, connectionId: activeConnectionId } : t
      )
    }))
  }, [activeConnectionId, activeTabId])

  const activeTab = tabs.find((t) => t.id === activeTabId)

  const handleDividerMouseDown = (e: React.MouseEvent) => {
    e.preventDefault()
    isDragging.current = true

    const onMove = (e: MouseEvent) => {
      if (!isDragging.current || !containerRef.current) return
      const rect = containerRef.current.getBoundingClientRect()
      const pct = ((e.clientY - rect.top) / rect.height) * 100
      setSplitPct(Math.min(85, Math.max(15, pct)))
    }

    const onUp = () => {
      isDragging.current = false
      window.removeEventListener('mousemove', onMove)
      window.removeEventListener('mouseup', onUp)
    }

    window.addEventListener('mousemove', onMove)
    window.addEventListener('mouseup', onUp)
  }

  return (
    <div className="flex flex-col h-full">
      {/* Tab bar */}
      <div className="flex items-center gap-0.5 px-2 py-1.5 border-b border-gray-800 bg-gray-950 overflow-x-auto shrink-0">
        {tabs.map((tab) => (
          <div
            key={tab.id}
            onClick={() => setActiveTab(tab.id)}
            className={`flex items-center gap-1.5 px-3 py-1 rounded-md text-xs cursor-default transition-colors shrink-0 ${
              activeTabId === tab.id
                ? 'bg-gray-800 text-gray-200'
                : 'text-gray-500 hover:text-gray-300 hover:bg-gray-800/50'
            }`}
          >
            {tab.type === 'table'
              ? <Table2 size={11} className="text-emerald-500 shrink-0" />
              : tab.isRunning && <span className="w-1.5 h-1.5 rounded-full bg-indigo-400 animate-pulse shrink-0" />
            }
            <span className="max-w-[120px] truncate">{tab.title}</span>
            <button
              onClick={(e) => {
                e.stopPropagation()
                closeTab(tab.id)
              }}
              className="text-gray-600 hover:text-gray-300 transition-colors ml-0.5"
            >
              <X size={10} />
            </button>
          </div>
        ))}
        <button
          onClick={() => openTab({ connectionId: activeConnectionId ?? undefined })}
          className="p-1.5 text-gray-600 hover:text-gray-300 transition-colors shrink-0"
        >
          <Plus size={13} />
        </button>
      </div>

      {/* Main content */}
      <div ref={containerRef} className="flex-1 flex flex-col overflow-hidden">
        {!activeTab && (
          <div className="h-full flex items-center justify-center text-gray-700 text-sm">
            Open a new tab to start querying
          </div>
        )}

        {/* Table inspection panel */}
        {activeTab?.type === 'table' && activeTab.tableRef && activeTab.connectionId && (
          <TableDetailPanel
            connectionId={activeTab.connectionId}
            projectId={activeTab.tableRef.projectId}
            datasetId={activeTab.tableRef.datasetId}
            tableId={activeTab.tableRef.tableId}
            tableName={activeTab.title}
          />
        )}

        {/* Query editor + results split pane */}
        {activeTab && activeTab.type !== 'table' && (
          <>
            <div style={{ height: `${splitPct}%` }} className="overflow-hidden min-h-0">
              <QueryEditor
                value={activeTab.sql}
                onChange={(sql) => updateTabSql(activeTab.id, sql)}
                onRun={() => runQuery(activeTab.id)}
                onCancel={() => cancelQuery(activeTab.id)}
                isRunning={activeTab.isRunning}
              />
            </div>

            {/* Draggable divider */}
            <div
              onMouseDown={handleDividerMouseDown}
              className="h-1.5 bg-gray-800 hover:bg-indigo-600/60 cursor-row-resize transition-colors shrink-0"
            />

            <div style={{ height: `${100 - splitPct}%` }} className="overflow-hidden min-h-0">
              <ResultsTable
                result={activeTab.result}
                error={activeTab.error}
                isRunning={activeTab.isRunning}
                cancelled={activeTab.cancelled}
                logs={activeTab.logs}
              />
            </div>
          </>
        )}
      </div>
    </div>
  )
}
