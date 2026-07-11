import { useCallback, useEffect, useMemo, useRef, useState } from 'react'
import EditorPane from '../components/editor/EditorPane'
import ResultsTable from '../components/results/ResultsTable'
import ResultsRegion from '../components/results/ResultsRegion'
import TableDetailPanel from '../components/catalog/TableDetailPanel'
import SaveQueryModal from '../components/editor/SaveQueryModal'
import TabStrip from '../components/editor/TabStrip'
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
  const focusGroup = useQueryStore((s) => s.focusGroup)
  const splitGroup = useQueryStore((s) => s.splitGroup)
  const unsplitGroups = useQueryStore((s) => s.unsplitGroups)

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
        await updateQuery({ ...existing, sql: tab.sql, params: tab.params ?? existing.params })
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

  // ── One group's content (tab strip + editor/results for its active tab) ─────
  const renderGroup = (group: GroupId) => {
    const activeTab: QueryTab | undefined = tabs.find((t) => t.id === activeByGroup[group])
    return (
      <div
        className="flex flex-col flex-1 min-w-0 overflow-hidden"
        onMouseDownCapture={() => { if (focusedGroup !== group) focusGroup(group) }}
      >
        <TabStrip group={group} dragTabIdRef={dragTabId} />
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
                  onSplit={rightExists ? unsplitGroups : splitGroup}
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
