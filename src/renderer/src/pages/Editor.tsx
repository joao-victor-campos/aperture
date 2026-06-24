import { useCallback, useEffect, useMemo, useRef, useState } from 'react'
import { Plus, X, Table2, Pin, Bookmark } from 'lucide-react'
import EditorPane from '../components/editor/EditorPane'
import ResultsTable from '../components/results/ResultsTable'
import ResultsRegion from '../components/results/ResultsRegion'
import TableDetailPanel from '../components/catalog/TableDetailPanel'
import SaveQueryModal from '../components/editor/SaveQueryModal'
import { useQueryStore, type GroupId } from '../store/queryStore'
import { useConnectionStore } from '../store/connectionStore'
import { useCatalogStore } from '../store/catalogStore'
import { useSavedQueryStore } from '../store/savedQueryStore'
import { useSchemaPrefetch } from '../hooks/useSchemaPrefetch'
import type { QueryTab } from '@shared/types'

export default function Editor() {
  const tabs = useQueryStore((s) => s.tabs)
  const focusedGroup = useQueryStore((s) => s.focusedGroup)
  const activeByGroup = useQueryStore((s) => s.activeByGroup)
  const openTab = useQueryStore((s) => s.openTab)
  const closeTab = useQueryStore((s) => s.closeTab)
  const setActiveTab = useQueryStore((s) => s.setActiveTab)
  const focusGroup = useQueryStore((s) => s.focusGroup)
  const moveTabToGroup = useQueryStore((s) => s.moveTabToGroup)
  const splitGroup = useQueryStore((s) => s.splitGroup)

  const dragTabId = useRef<string | null>(null)
  const { connections, activeConnectionId, setActive } = useConnectionStore()
  const { datasetsByConnection, tablesByDataset, schemaCache } = useCatalogStore()
  const { updateQuery } = useSavedQueryStore()

  const [splitPct, setSplitPct] = useState(55)      // editor/results vertical split (shared)
  const [splitHPct, setSplitHPct] = useState(50)    // horizontal split between groups
  const [savingTabId, setSavingTabId] = useState<string | null>(null)
  const [savedFlash, setSavedFlash] = useState(false)
  const isDragging = useRef(false)
  const isHDragging = useRef(false)
  const containerRef = useRef<HTMLDivElement>(null)
  const savedFlashTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null)

  const rightExists = tabs.some((t) => t.groupId === 'right')

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

  // The catalog sidebar + title-bar breadcrumb follow the focused group's
  // active tab connection. Never mutates a tab; only points the sidebar.
  const focusedTab = tabs.find((t) => t.id === activeByGroup[focusedGroup])
  useEffect(() => {
    if (focusedTab?.connectionId && focusedTab.connectionId !== activeConnectionId) {
      setActive(focusedTab.connectionId)
    }
  }, [focusedTab?.connectionId, focusedTab?.id])

  // Autocomplete schema for the focused connection (the editor you type in).
  const focusedEngine = connections.find((c) => c.id === activeConnectionId)?.engine
  const sqlSchema = useMemo(() => {
    if (!activeConnectionId) return {}
    const schema: Record<string, string[]> = {}
    const datasets = datasetsByConnection[activeConnectionId] ?? []
    for (const ds of datasets) {
      const dsTables = tablesByDataset[`${activeConnectionId}:${ds.id}`] ?? []
      for (const t of dsTables) {
        const cacheKey = `${activeConnectionId}:${ds.id}:${t.id}`
        const fields = schemaCache[cacheKey]
        const cols = fields ? fields.map((f) => f.name) : []
        schema[`${ds.name}.${t.name}`] = cols
        schema[t.name] = cols
      }
    }
    return schema
  }, [activeConnectionId, datasetsByConnection, tablesByDataset, schemaCache])

  const cypherSchema = useMemo(() => {
    if (!activeConnectionId || focusedEngine !== 'neo4j') return undefined
    const labels: string[] = []
    const relationshipTypes: string[] = []
    const propertyKeys = new Set<string>()
    const datasets = datasetsByConnection[activeConnectionId] ?? []
    for (const ds of datasets) {
      const dsTables = tablesByDataset[`${activeConnectionId}:${ds.id}`] ?? []
      for (const t of dsTables) {
        if (t.type === 'RELATIONSHIP_TYPE') relationshipTypes.push(t.name)
        else labels.push(t.name)
        const fields = schemaCache[`${activeConnectionId}:${ds.id}:${t.id}`]
        if (fields) for (const f of fields) propertyKeys.add(f.name)
      }
    }
    return { labels, relationshipTypes, propertyKeys: Array.from(propertyKeys) }
  }, [activeConnectionId, focusedEngine, datasetsByConnection, tablesByDataset, schemaCache])

  useSchemaPrefetch(focusedTab?.sql ?? '', activeConnectionId ?? undefined)

  const handleSave = useCallback(async () => {
    const { tabs: cur, activeTabId: id } = useQueryStore.getState()
    const tab = cur.find((t) => t.id === id)
    if (!tab || !tab.sql.trim()) return
    if (tab.savedQueryId) {
      const { queries } = useSavedQueryStore.getState()
      const existing = queries.find((q) => q.id === tab.savedQueryId)
      if (existing) {
        await updateQuery({ ...existing, sql: tab.sql, params: tab.params })
        setSavedFlash(true)
        if (savedFlashTimerRef.current) clearTimeout(savedFlashTimerRef.current)
        savedFlashTimerRef.current = setTimeout(() => setSavedFlash(false), 1500)
      }
    } else {
      setSavingTabId(id)
    }
  }, [updateQuery])

  const handleDividerMouseDown = (e: React.MouseEvent) => {
    e.preventDefault()
    isDragging.current = true
    const onMove = (ev: MouseEvent) => {
      if (!isDragging.current || !containerRef.current) return
      const rect = containerRef.current.getBoundingClientRect()
      const pct = ((ev.clientY - rect.top) / rect.height) * 100
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

  // ── Tab strip (one per group) ──────────────────────────────────────────────
  const renderTabStrip = (group: GroupId) => {
    const groupTabs = tabs.filter((t) => (t.groupId ?? 'left') === group)
    const activeId = activeByGroup[group]
    return (
      <div
        className="flex items-center gap-1 px-2 h-10 border-b border-app-border bg-app-bg shrink-0 overflow-x-auto"
        onDragOver={(e) => { e.preventDefault(); e.dataTransfer.dropEffect = 'move' }}
        onDrop={(e) => {
          e.preventDefault()
          if (dragTabId.current) moveTabToGroup(dragTabId.current, group)
          dragTabId.current = null
        }}
      >
        {groupTabs.map((tab) => {
          const isActive = activeId === tab.id
          return (
            <div
              key={tab.id}
              draggable
              onDragStart={(e) => { dragTabId.current = tab.id; e.dataTransfer.effectAllowed = 'move' }}
              onDragOver={(e) => { e.preventDefault(); e.dataTransfer.dropEffect = 'move' }}
              onDrop={(e) => {
                e.preventDefault()
                e.stopPropagation()
                if (dragTabId.current && dragTabId.current !== tab.id) {
                  moveTabToGroup(dragTabId.current, group, tab.id)
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
              {tab.type === 'table' && <Table2 size={11} className="text-app-cat-green shrink-0" />}
              {tab.type === 'result' && <Pin size={11} className="text-app-accent shrink-0" />}
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
          onClick={() => { focusGroup(group); openTab({ connectionId: activeConnectionId ?? undefined }) }}
          title="New query tab"
          className="p-1.5 rounded-md text-app-text-3 hover:text-app-text hover:bg-app-elevated transition-colors shrink-0"
        >
          <Plus size={13} />
        </button>
      </div>
    )
  }

  // ── One group's content (tab strip + editor/results for its active tab) ─────
  const renderGroup = (group: GroupId) => {
    const activeTab: QueryTab | undefined = tabs.find((t) => t.id === activeByGroup[group])
    return (
      <div
        className="flex flex-col flex-1 min-w-0 overflow-hidden"
        onMouseDownCapture={() => { if (focusedGroup !== group) focusGroup(group) }}
      >
        {renderTabStrip(group)}
        <div className="flex-1 flex flex-col overflow-hidden min-h-0">
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
              <div style={{ height: `${splitPct}%` }} className="flex flex-col overflow-hidden min-h-0">
                <EditorPane
                  tabId={activeTab.id}
                  sqlSchema={sqlSchema}
                  cypherSchema={cypherSchema}
                  isSplit={rightExists}
                  onSplit={splitGroup}
                  onSave={handleSave}
                />
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
          )}
        </div>
      </div>
    )
  }

  return (
    <div className="flex flex-col h-full">
      <div ref={containerRef} className="flex-1 flex overflow-hidden">
        {renderGroup('left')}
        {rightExists && (
          <>
            <div
              onMouseDown={handleHDividerMouseDown}
              className="w-1.5 bg-app-border hover:bg-app-accent/60 cursor-col-resize transition-colors shrink-0"
            />
            <div style={{ width: `${100 - splitHPct}%` }} className="flex min-w-0">
              {renderGroup('right')}
            </div>
          </>
        )}
      </div>

      {savedFlash && (
        <div className="fixed bottom-4 right-4 z-50 bg-app-elevated border border-app-border text-app-text text-xs px-3 py-2 rounded shadow-lg animate-fade-in">
          ✓ Query updated
        </div>
      )}

      {savingTabId && (
        <SaveQueryModal tabId={savingTabId} onClose={() => setSavingTabId(null)} />
      )}
    </div>
  )
}
