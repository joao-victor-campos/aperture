import { useEffect, useMemo, useRef, useState } from 'react'
import { Plus, X, Table2, Pin } from 'lucide-react'
import QueryEditor from '../components/editor/QueryEditor'
import ResultsTable from '../components/results/ResultsTable'
import TableDetailPanel from '../components/catalog/TableDetailPanel'
import SaveQueryModal from '../components/editor/SaveQueryModal'
import { useQueryStore } from '../store/queryStore'
import { useConnectionStore } from '../store/connectionStore'
import { useCatalogStore } from '../store/catalogStore'
import { useSavedQueryStore } from '../store/savedQueryStore'

export default function Editor() {
  const { tabs, activeTabId, openTab, openResultTab, closeTab, setActiveTab, updateTabSql, runQuery, cancelQuery, fetchPage, reorderTabs } =
    useQueryStore()
  const dragTabId = useRef<string | null>(null)
  const { connections, activeConnectionId } = useConnectionStore()
  const activeEngine = connections.find((c) => c.id === activeConnectionId)?.engine
  const { datasetsByConnection, tablesByDataset, schemaCache } = useCatalogStore()
  const { updateQuery } = useSavedQueryStore()
  const [splitPct, setSplitPct] = useState(55)
  const [savingTabId, setSavingTabId] = useState<string | null>(null)
  const [savedFlash, setSavedFlash] = useState(false)
  const isDragging = useRef(false)
  const containerRef = useRef<HTMLDivElement>(null)

  useEffect(() => {
    if (tabs.length === 0) openTab({ connectionId: activeConnectionId ?? undefined })
  }, [])

  useEffect(() => {
    if (!activeConnectionId || !activeTabId) return
    useQueryStore.setState((s) => ({
      tabs: s.tabs.map((t) =>
        t.id === activeTabId ? { ...t, connectionId: activeConnectionId } : t
      ),
    }))
  }, [activeConnectionId, activeTabId])

  // Build SQL autocomplete schema from the active connection's loaded catalog data
  const sqlSchema = useMemo(() => {
    if (!activeConnectionId) return {}
    const schema: Record<string, string[]> = {}
    const datasets = datasetsByConnection[activeConnectionId] ?? []
    for (const ds of datasets) {
      const tables = tablesByDataset[`${activeConnectionId}:${ds.id}`] ?? []
      for (const t of tables) {
        const cacheKey = `${activeConnectionId}:${ds.id}:${t.id}`
        const fields = schemaCache[cacheKey]
        const cols = fields ? fields.map((f) => f.name) : []
        // Register both fully-qualified and bare names for flexible completion
        schema[`${ds.name}.${t.name}`] = cols
        schema[t.name] = cols
      }
    }
    return schema
  }, [activeConnectionId, datasetsByConnection, tablesByDataset, schemaCache])

  const activeTab = tabs.find((t) => t.id === activeTabId)

  // Handle save: silent update if already saved, otherwise open modal
  const handleSave = async () => {
    if (!activeTab || !activeTab.sql.trim()) return
    if (activeTab.savedQueryId) {
      // Find and update the existing saved query
      const { queries } = useSavedQueryStore.getState()
      const existing = queries.find((q) => q.id === activeTab.savedQueryId)
      if (existing) {
        await updateQuery({ ...existing, sql: activeTab.sql })
        setSavedFlash(true)
        setTimeout(() => setSavedFlash(false), 1500)
      }
    } else {
      setSavingTabId(activeTabId)
    }
  }

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
      {/* Tab bar — entire bar is draggable; tabs and buttons opt out */}
      <div
        className="flex items-center gap-0.5 px-2 py-2 border-b border-app-border bg-app-surface shrink-0"
        style={{ WebkitAppRegion: 'drag' } as React.CSSProperties}
      >
        <div className="flex items-center gap-0.5 overflow-x-auto" style={{ WebkitAppRegion: 'no-drag' } as React.CSSProperties}>
          {tabs.map((tab) => (
            <div
              key={tab.id}
              draggable
              onDragStart={(e) => {
                dragTabId.current = tab.id
                e.dataTransfer.effectAllowed = 'move'
              }}
              onDragOver={(e) => {
                e.preventDefault()
                e.dataTransfer.dropEffect = 'move'
              }}
              onDrop={(e) => {
                e.preventDefault()
                if (dragTabId.current && dragTabId.current !== tab.id) {
                  reorderTabs(dragTabId.current, tab.id)
                }
                dragTabId.current = null
              }}
              onDragEnd={() => { dragTabId.current = null }}
              onClick={() => setActiveTab(tab.id)}
              className={`flex items-center gap-1.5 px-3 py-1 rounded-md text-xs cursor-grab active:cursor-grabbing transition-colors shrink-0 ${
                activeTabId === tab.id
                  ? 'bg-app-elevated text-app-text'
                  : 'text-app-text-2 hover:text-app-text hover:bg-app-elevated/50'
              }`}
            >
              {tab.type === 'table'
                ? <Table2 size={11} className="text-emerald-500 shrink-0" />
                : tab.type === 'result'
                  ? <Pin size={11} className="text-app-accent shrink-0" />
                  : tab.isRunning && (
                      <span className="w-1.5 h-1.5 rounded-full bg-app-accent animate-pulse shrink-0" />
                    )
              }
              <span className="max-w-[120px] truncate">{tab.title}</span>
              <button
                onClick={(e) => { e.stopPropagation(); closeTab(tab.id) }}
                className="text-app-text-3 hover:text-app-text transition-colors ml-0.5"
              >
                <X size={10} />
              </button>
            </div>
          ))}
          <button
            onClick={() => openTab({ connectionId: activeConnectionId ?? undefined })}
            className="p-1.5 text-app-text-3 hover:text-app-text transition-colors shrink-0"
          >
            <Plus size={13} />
          </button>
        </div>
        {/* Remaining space is drag area */}
        <div className="flex-1 min-h-[20px]" />
      </div>

      {/* Main content */}
      <div ref={containerRef} className="flex-1 flex flex-col overflow-hidden">
        {!activeTab && (
          <div className="h-full flex items-center justify-center text-app-text-3 text-sm">
            Open a new tab to start querying
          </div>
        )}

        {activeTab?.type === 'table' && activeTab.tableRef && activeTab.connectionId && (
          <TableDetailPanel
            connectionId={activeTab.connectionId}
            projectId={activeTab.tableRef.projectId}
            datasetId={activeTab.tableRef.datasetId}
            tableId={activeTab.tableRef.tableId}
            tableName={activeTab.title}
          />
        )}

        {activeTab?.type === 'result' && (
          <div className="flex-1 overflow-hidden min-h-0">
            <ResultsTable result={activeTab.result} pinned />
          </div>
        )}

        {activeTab && activeTab.type !== 'table' && activeTab.type !== 'result' && (
          <>
            <div style={{ height: `${splitPct}%` }} className="overflow-hidden min-h-0">
              <QueryEditor
                value={activeTab.sql}
                onChange={(sql) => updateTabSql(activeTab.id, sql)}
                onRun={() => runQuery(activeTab.id)}
                onCancel={() => cancelQuery(activeTab.id)}
                onSave={handleSave}
                isRunning={activeTab.isRunning}
                savedQueryId={activeTab.savedQueryId}
                sqlSchema={sqlSchema}
                engine={activeEngine}
              />
            </div>

            <div
              onMouseDown={handleDividerMouseDown}
              className="h-1.5 bg-app-border hover:bg-app-accent/60 cursor-row-resize transition-colors shrink-0"
            />

            <div style={{ height: `${100 - splitPct}%` }} className="overflow-hidden min-h-0">
              <ResultsTable
                result={activeTab.result}
                error={activeTab.error}
                isRunning={activeTab.isRunning}
                cancelled={activeTab.cancelled}
                logs={activeTab.logs}
                onFetchPage={() => fetchPage(activeTab.id)}
                onPin={() => openResultTab(activeTab.id)}
              />
            </div>
          </>
        )}
      </div>

      {/* "Saved" flash indicator */}
      {savedFlash && (
        <div className="fixed bottom-4 right-4 z-50 bg-app-elevated border border-app-border text-app-text text-xs px-3 py-2 rounded shadow-lg animate-fade-in">
          ✓ Query updated
        </div>
      )}

      {/* Save modal (only shown when saving a new query) */}
      {savingTabId && (
        <SaveQueryModal
          tabId={savingTabId}
          onClose={() => setSavingTabId(null)}
        />
      )}
    </div>
  )
}
