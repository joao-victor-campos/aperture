import { useCallback, useEffect, useMemo, useRef, useState } from 'react'
import { Plus, X, Table2, Pin, Bookmark } from 'lucide-react'
import QueryEditor from '../components/editor/QueryEditor'
import ResultsTable from '../components/results/ResultsTable'
import ResultsRegion from '../components/results/ResultsRegion'
import LimitWarningBanner from '../components/editor/LimitWarningBanner'
import TableDetailPanel from '../components/catalog/TableDetailPanel'
import SaveQueryModal from '../components/editor/SaveQueryModal'
import { useQueryStore } from '../store/queryStore'
import { useConnectionStore } from '../store/connectionStore'
import { useCatalogStore } from '../store/catalogStore'
import { useSavedQueryStore } from '../store/savedQueryStore'
import { detectMissingLimit } from '../lib/detectMissingLimit'

export default function Editor() {
  const {
    tabs, activeTabId,
    openTab, openResultTab, closeTab, setActiveTab, updateTabSql,
    runQuery, cancelQuery, explainQuery, clearExplain, fetchPage, reorderTabs,
    toggleGraphView, toggleSplit, updateRightPaneSql, runRightPane, cancelRightPane,
  } = useQueryStore()
  const dragTabId = useRef<string | null>(null)
  const { connections, activeConnectionId } = useConnectionStore()
  const activeEngine = connections.find((c) => c.id === activeConnectionId)?.engine
  const { datasetsByConnection, tablesByDataset, schemaCache } = useCatalogStore()
  const { updateQuery } = useSavedQueryStore()
  const [splitPct, setSplitPct] = useState(55)
  const [splitHPct, setSplitHPct] = useState(50) // horizontal split between left/right pane
  const [savingTabId, setSavingTabId] = useState<string | null>(null)
  const [savedFlash, setSavedFlash] = useState(false)
  const [limitWarningTabId, setLimitWarningTabId] = useState<string | null>(null)
  const isDragging = useRef(false)
  const isHDragging = useRef(false)
  const containerRef = useRef<HTMLDivElement>(null)
  const savedFlashTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null)

  // Clean up timers and any in-flight drag listeners on unmount
  useEffect(() => {
    return () => {
      if (savedFlashTimerRef.current) clearTimeout(savedFlashTimerRef.current)
      isDragging.current = false
      isHDragging.current = false
    }
  }, [])

  useEffect(() => {
    if (tabs.length === 0) openTab({ connectionId: activeConnectionId ?? undefined })
  }, [])

  useEffect(() => {
    if (!activeConnectionId || !activeTabId) return
    useQueryStore.setState((s) => ({
      tabs: s.tabs.map((t) =>
        // Don't silently swap the connection while a query is in flight
        t.id === activeTabId && !t.isRunning ? { ...t, connectionId: activeConnectionId } : t
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

  // Build Cypher autocomplete schema (labels / relationship types / property keys)
  // from the active Neo4j connection's loaded catalog data.
  const cypherSchema = useMemo(() => {
    if (!activeConnectionId || activeEngine !== 'neo4j') return undefined
    const labels: string[] = []
    const relationshipTypes: string[] = []
    const propertyKeys = new Set<string>()
    const datasets = datasetsByConnection[activeConnectionId] ?? []
    for (const ds of datasets) {
      const tables = tablesByDataset[`${activeConnectionId}:${ds.id}`] ?? []
      for (const t of tables) {
        if (t.type === 'RELATIONSHIP_TYPE') relationshipTypes.push(t.name)
        else labels.push(t.name)
        const fields = schemaCache[`${activeConnectionId}:${ds.id}:${t.id}`]
        if (fields) for (const f of fields) propertyKeys.add(f.name)
      }
    }
    return { labels, relationshipTypes, propertyKeys: Array.from(propertyKeys) }
  }, [activeConnectionId, activeEngine, datasetsByConnection, tablesByDataset, schemaCache])

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
        if (savedFlashTimerRef.current) clearTimeout(savedFlashTimerRef.current)
        savedFlashTimerRef.current = setTimeout(() => setSavedFlash(false), 1500)
      }
    } else {
      setSavingTabId(activeTabId)
    }
  }

  // Auto-limit guard: intercept run if SELECT has no LIMIT
  const handleRun = (tabId: string) => {
    const tab = tabs.find((t) => t.id === tabId)
    if (!tab) return
    // Clear any stale explain result when running a real query
    if (tab.explainResult) clearExplain(tabId)
    if (detectMissingLimit(tab.sql)) {
      setLimitWarningTabId(tabId)
    } else {
      runQuery(tabId)
    }
  }

  const handleRunAnyway = () => {
    if (limitWarningTabId) {
      runQuery(limitWarningTabId)
      setLimitWarningTabId(null)
    }
  }

  const handleAddLimit = () => {
    if (limitWarningTabId) {
      const tab = tabs.find((t) => t.id === limitWarningTabId)
      if (tab) {
        const newSql = tab.sql.trimEnd() + '\nLIMIT 1000'
        updateTabSql(limitWarningTabId, newSql)
        runQuery(limitWarningTabId)
      }
      setLimitWarningTabId(null)
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

  const handleHDividerMouseDown = useCallback((e: React.MouseEvent) => {
    e.preventDefault()
    isHDragging.current = true
    const onMove = (ev: MouseEvent) => {
      if (!isHDragging.current || !containerRef.current) return
      const rect = containerRef.current.getBoundingClientRect()
      const pct = ((ev.clientX - rect.left) / rect.width) * 100
      setSplitHPct(Math.min(80, Math.max(20, pct)))
    }
    const onUp = () => {
      isHDragging.current = false
      window.removeEventListener('mousemove', onMove)
      window.removeEventListener('mouseup', onUp)
    }
    window.addEventListener('mousemove', onMove)
    window.addEventListener('mouseup', onUp)
  }, [])

  return (
    <div className="flex flex-col h-full">
      {/* Tab bar — entire bar is draggable; tabs and buttons opt out */}
      <div
        className="flex items-center gap-1 px-2 h-10 border-b border-app-border bg-app-bg shrink-0"
        style={{ WebkitAppRegion: 'drag' } as React.CSSProperties}
      >
        <div className="flex items-center gap-1 overflow-x-auto" style={{ WebkitAppRegion: 'no-drag' } as React.CSSProperties}>
          {tabs.map((tab) => {
            const isActive = activeTabId === tab.id
            return (
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
                className={`flex items-center gap-1.5 px-3 py-1 rounded-md text-ui-sm cursor-grab active:cursor-grabbing transition-all shrink-0 ${
                  isActive
                    ? 'bg-app-surface text-app-text shadow-app-pill'
                    : 'text-app-text-2 hover:text-app-text hover:bg-app-elevated/60'
                }`}
              >
                {tab.type === 'table' && (
                  <Table2 size={11} className="text-app-cat-green shrink-0" />
                )}
                {tab.type === 'result' && (
                  <Pin size={11} className="text-app-accent shrink-0" />
                )}
                {tab.savedQueryId && tab.type !== 'table' && tab.type !== 'result' && (
                  <Bookmark size={11} className="text-app-accent shrink-0" />
                )}
                {!tab.type && tab.isRunning && (
                  <span className="app-dot shrink-0 animate-pulse" style={{ backgroundColor: 'rgb(var(--c-accent))' }} />
                )}
                <span className="max-w-[140px] truncate">{tab.title}</span>
                <button
                  onClick={(e) => { e.stopPropagation(); closeTab(tab.id) }}
                  className="text-app-text-3 hover:text-app-text transition-colors ml-0.5"
                >
                  <X size={10} />
                </button>
              </div>
            )
          })}
          <button
            onClick={() => openTab({ connectionId: activeConnectionId ?? undefined })}
            title="New query tab"
            className="p-1.5 rounded-md text-app-text-3 hover:text-app-text hover:bg-app-elevated transition-colors shrink-0"
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
          activeTab.rightPane ? (
            /* ── Split layout ────────────────────────────────────────────── */
            <div className="flex flex-1 overflow-hidden min-h-0">
              {/* Left pane */}
              <div className="flex flex-col overflow-hidden min-h-0" style={{ width: `${splitHPct}%` }}>
                <div style={{ height: `${splitPct}%` }} className="flex flex-col overflow-hidden min-h-0">
                  <QueryEditor
                    value={activeTab.sql}
                    onChange={(sql) => updateTabSql(activeTab.id, sql)}
                    onRun={() => handleRun(activeTab.id)}
                    onCancel={() => cancelQuery(activeTab.id)}
                    onExplain={() => explainQuery(activeTab.id)}
                    onSave={handleSave}
                    onSplit={() => toggleSplit(activeTab.id)}
                    isSplit
                    isRunning={activeTab.isRunning}
                    isExplaining={activeTab.isExplaining}
                    savedQueryId={activeTab.savedQueryId}
                    sqlSchema={sqlSchema}
                    cypherSchema={cypherSchema}
                    engine={activeEngine}
                  />
                  {limitWarningTabId === activeTab.id && (
                    <LimitWarningBanner
                      onRunAnyway={handleRunAnyway}
                      onAddLimit={handleAddLimit}
                      onDismiss={() => setLimitWarningTabId(null)}
                    />
                  )}
                </div>
                <div
                  onMouseDown={handleDividerMouseDown}
                  className="h-1.5 bg-app-border hover:bg-app-accent/60 cursor-row-resize transition-colors shrink-0"
                />
                <div style={{ height: `${100 - splitPct}%` }} className="overflow-hidden min-h-0">
                  <div className="flex flex-col h-full overflow-hidden">
                    <ResultsRegion tabId={activeTab.id} />
                  </div>
                </div>
              </div>

              {/* Horizontal divider between left and right pane */}
              <div
                onMouseDown={handleHDividerMouseDown}
                className="w-1.5 bg-app-border hover:bg-app-accent/60 cursor-col-resize transition-colors shrink-0"
              />

              {/* Right pane */}
              <div className="flex flex-col flex-1 overflow-hidden min-h-0">
                <div style={{ height: `${splitPct}%` }} className="overflow-hidden min-h-0">
                  <QueryEditor
                    value={activeTab.rightPane.sql}
                    onChange={(sql) => updateRightPaneSql(activeTab.id, sql)}
                    onRun={() => runRightPane(activeTab.id)}
                    onCancel={() => cancelRightPane(activeTab.id)}
                    isRunning={activeTab.rightPane.isRunning}
                    sqlSchema={sqlSchema}
                    cypherSchema={cypherSchema}
                    engine={activeEngine}
                  />
                </div>
                <div
                  onMouseDown={handleDividerMouseDown}
                  className="h-1.5 bg-app-border hover:bg-app-accent/60 cursor-row-resize transition-colors shrink-0"
                />
                <div style={{ height: `${100 - splitPct}%` }} className="overflow-hidden min-h-0">
                  <ResultsTable
                    result={activeTab.rightPane.result}
                    error={activeTab.rightPane.error}
                    isRunning={activeTab.rightPane.isRunning}
                    cancelled={activeTab.rightPane.cancelled}
                    logs={activeTab.rightPane.logs}
                  />
                </div>
              </div>
            </div>
          ) : (
            /* ── Single-pane layout ──────────────────────────────────────── */
            <>
              <div style={{ height: `${splitPct}%` }} className="flex flex-col overflow-hidden min-h-0">
                <QueryEditor
                  value={activeTab.sql}
                  onChange={(sql) => updateTabSql(activeTab.id, sql)}
                  onRun={() => handleRun(activeTab.id)}
                  onCancel={() => cancelQuery(activeTab.id)}
                  onExplain={() => explainQuery(activeTab.id)}
                  onSave={handleSave}
                  onSplit={() => toggleSplit(activeTab.id)}
                  isSplit={false}
                  isRunning={activeTab.isRunning}
                  isExplaining={activeTab.isExplaining}
                  savedQueryId={activeTab.savedQueryId}
                  sqlSchema={sqlSchema}
                  cypherSchema={cypherSchema}
                  engine={activeEngine}
                />
                {limitWarningTabId === activeTab.id && (
                  <LimitWarningBanner
                    onRunAnyway={handleRunAnyway}
                    onAddLimit={handleAddLimit}
                    onDismiss={() => setLimitWarningTabId(null)}
                  />
                )}
              </div>

              <div
                onMouseDown={handleDividerMouseDown}
                className="h-1.5 bg-app-border hover:bg-app-accent/60 cursor-row-resize transition-colors shrink-0"
              />

              <div style={{ height: `${100 - splitPct}%` }} className="overflow-hidden min-h-0">
                <div className="flex flex-col h-full overflow-hidden">
                  <ResultsRegion tabId={activeTab.id} />
                </div>
              </div>
            </>
          )
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
