import { memo, useCallback, useMemo, useState } from 'react'
import { useShallow } from 'zustand/react/shallow'
import { useQueryStore } from '../../store/queryStore'
import { useConnectionStore } from '../../store/connectionStore'
import { detectMissingLimit } from '../../lib/detectMissingLimit'
import QueryEditor from './QueryEditor'
import LimitWarningBanner from './LimitWarningBanner'
import type { CypherSchema } from '../../lib/cypherLanguage'

interface EditorPaneProps {
  tabId: string
  sqlSchema?: Record<string, string[]>
  cypherSchema?: CypherSchema
  isSplit: boolean
  onSplit: () => void
  onSave: () => void
}

/**
 * The editor half of a query tab: CodeMirror + toolbar + auto-limit banner.
 * Engine is derived from the tab's own connection so split groups on different
 * engines each get the right language/dialect.
 */
function EditorPane({ tabId, sqlSchema, cypherSchema, isSplit, onSplit, onSave }: EditorPaneProps) {
  const { sql, isRunning, isExplaining, savedQueryId, connectionId } = useQueryStore(
    useShallow((s) => {
      const t = s.tabs.find((x) => x.id === tabId)
      return {
        sql: t?.sql ?? '',
        isRunning: t?.isRunning ?? false,
        isExplaining: t?.isExplaining,
        savedQueryId: t?.savedQueryId,
        connectionId: t?.connectionId,
      }
    }),
  )
  const updateTabSql = useQueryStore((s) => s.updateTabSql)
  const runQuery = useQueryStore((s) => s.runQuery)
  const cancelQuery = useQueryStore((s) => s.cancelQuery)
  const explainQuery = useQueryStore((s) => s.explainQuery)
  const clearExplain = useQueryStore((s) => s.clearExplain)
  const setTabConnection = useQueryStore((s) => s.setTabConnection)

  const connections = useConnectionStore((s) => s.connections)
  const pickerConnections = useMemo(
    () => connections.map((c) => ({ id: c.id, name: c.name, engine: c.engine })),
    [connections],
  )
  const engine = useMemo(
    () => connections.find((c) => c.id === connectionId)?.engine,
    [connections, connectionId],
  )

  const [showLimitWarning, setShowLimitWarning] = useState(false)

  const handleChange = useCallback((next: string) => updateTabSql(tabId, next), [updateTabSql, tabId])
  const handleConnectionChange = useCallback((id: string) => setTabConnection(tabId, id), [setTabConnection, tabId])

  const handleRun = useCallback(() => {
    clearExplain(tabId)
    const current = useQueryStore.getState().tabs.find((t) => t.id === tabId)?.sql ?? ''
    if (detectMissingLimit(current)) setShowLimitWarning(true)
    else runQuery(tabId)
  }, [clearExplain, runQuery, tabId])

  const handleCancel = useCallback(() => cancelQuery(tabId), [cancelQuery, tabId])
  const handleExplain = useCallback(() => explainQuery(tabId), [explainQuery, tabId])

  const handleRunAnyway = useCallback(() => {
    setShowLimitWarning(false)
    runQuery(tabId)
  }, [runQuery, tabId])

  const handleAddLimit = useCallback(() => {
    const current = useQueryStore.getState().tabs.find((t) => t.id === tabId)?.sql ?? ''
    updateTabSql(tabId, current.trimEnd() + '\nLIMIT 1000')
    runQuery(tabId)
    setShowLimitWarning(false)
  }, [updateTabSql, runQuery, tabId])

  return (
    <>
      <QueryEditor
        value={sql}
        onChange={handleChange}
        onRun={handleRun}
        onCancel={handleCancel}
        onExplain={handleExplain}
        onSave={onSave}
        onSplit={onSplit}
        isSplit={isSplit}
        isRunning={isRunning}
        isExplaining={isExplaining}
        savedQueryId={savedQueryId}
        sqlSchema={sqlSchema}
        cypherSchema={cypherSchema}
        engine={engine}
        connections={pickerConnections}
        connectionId={connectionId}
        onConnectionChange={handleConnectionChange}
      />
      {showLimitWarning && (
        <LimitWarningBanner
          onRunAnyway={handleRunAnyway}
          onAddLimit={handleAddLimit}
          onDismiss={() => setShowLimitWarning(false)}
        />
      )}
    </>
  )
}

export default memo(EditorPane)
