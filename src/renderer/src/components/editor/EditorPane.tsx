import { memo, useCallback, useState } from 'react'
import { useShallow } from 'zustand/react/shallow'
import { useQueryStore } from '../../store/queryStore'
import { detectMissingLimit } from '../../lib/detectMissingLimit'
import QueryEditor from './QueryEditor'
import LimitWarningBanner from './LimitWarningBanner'
import type { ConnectionEngine } from '@shared/types'
import type { CypherSchema } from '../../lib/cypherLanguage'

interface EditorPaneProps {
  tabId: string
  engine?: ConnectionEngine
  sqlSchema?: Record<string, string[]>
  cypherSchema?: CypherSchema
  isSplit: boolean
  onSplit: () => void
  onSave: () => void
}

/**
 * The editor half of a query tab: CodeMirror + toolbar + auto-limit banner.
 * Subscribes only to the active tab's editing fields so a keystroke re-renders
 * this pane and nothing else. Run/cancel/explain dispatch store actions; save
 * and split are delegated to the parent (they touch Editor-level modal state).
 */
function EditorPane({ tabId, engine, sqlSchema, cypherSchema, isSplit, onSplit, onSave }: EditorPaneProps) {
  const { sql, isRunning, isExplaining, savedQueryId } = useQueryStore(
    useShallow((s) => {
      const t = s.tabs.find((x) => x.id === tabId)
      return {
        sql: t?.sql ?? '',
        isRunning: t?.isRunning ?? false,
        isExplaining: t?.isExplaining,
        savedQueryId: t?.savedQueryId,
      }
    }),
  )
  const updateTabSql = useQueryStore((s) => s.updateTabSql)
  const runQuery = useQueryStore((s) => s.runQuery)
  const cancelQuery = useQueryStore((s) => s.cancelQuery)
  const explainQuery = useQueryStore((s) => s.explainQuery)
  const clearExplain = useQueryStore((s) => s.clearExplain)

  const [showLimitWarning, setShowLimitWarning] = useState(false)

  const handleChange = useCallback((next: string) => updateTabSql(tabId, next), [updateTabSql, tabId])

  const handleRun = useCallback(() => {
    clearExplain(tabId) // drop any stale explain panel (no-op if none)
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
