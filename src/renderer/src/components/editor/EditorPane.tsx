import { memo, useCallback, useMemo, useState } from 'react'
import { validateParams } from '../../lib/validateParams'
import { useShallow } from 'zustand/react/shallow'
import { useQueryStore } from '../../store/queryStore'
import { useConnectionStore } from '../../store/connectionStore'
import { usePreferencesStore } from '../../store/preferencesStore'
import { detectMissingLimit } from '../../lib/detectMissingLimit'
import QueryEditor from './QueryEditor'
import LimitWarningBanner from './LimitWarningBanner'
import ParamsPanel from './ParamsPanel'
import type { CypherSchema } from '../../lib/cypherLanguage'
import type { QueryParam } from '@shared/types'

// Stable empty-array reference for the params fallback. Returning a fresh `[]`
// from the useShallow selector below would make Object.is fail every render
// (new array each call) → infinite re-render loop. A module-level constant keeps
// the fallback referentially stable.
const EMPTY_PARAMS: QueryParam[] = []

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
  const { sql, isRunning, isExplaining, savedQueryId, connectionId, params } = useQueryStore(
    useShallow((s) => {
      const t = s.tabs.find((x) => x.id === tabId)
      return {
        sql: t?.sql ?? '',
        isRunning: t?.isRunning ?? false,
        isExplaining: t?.isExplaining,
        savedQueryId: t?.savedQueryId,
        connectionId: t?.connectionId,
        params: t?.params ?? EMPTY_PARAMS,
      }
    }),
  )
  const updateTabSql = useQueryStore((s) => s.updateTabSql)
  const runQuery = useQueryStore((s) => s.runQuery)
  const cancelQuery = useQueryStore((s) => s.cancelQuery)
  const explainQuery = useQueryStore((s) => s.explainQuery)
  const clearExplain = useQueryStore((s) => s.clearExplain)
  const setTabConnection = useQueryStore((s) => s.setTabConnection)
  const setTabParams = useQueryStore((s) => s.setTabParams)

  const connections = useConnectionStore((s) => s.connections)
  const pickerConnections = useMemo(
    () => connections.map((c) => ({ id: c.id, name: c.name, engine: c.engine })),
    [connections],
  )
  const engine = useMemo(
    () => connections.find((c) => c.id === connectionId)?.engine,
    [connections, connectionId],
  )
  const limitGuardEnabled = usePreferencesStore((s) => s.limitGuardEnabled)

  const [showLimitWarning, setShowLimitWarning] = useState(false)
  const [showParamErrors, setShowParamErrors] = useState(false)

  const handleChange = useCallback((next: string) => updateTabSql(tabId, next), [updateTabSql, tabId])
  const handleConnectionChange = useCallback((id: string) => setTabConnection(tabId, id), [setTabConnection, tabId])

  const focusFirstParamError = useCallback(() => {
    // Defer to next frame so ParamsPanel has rendered the error rows.
    requestAnimationFrame(() => {
      const el = document.querySelector<HTMLElement>('[data-error="true"]')
      el?.focus()
    })
  }, [])

  const handleRun = useCallback(() => {
    const current = useQueryStore.getState().tabs.find((t) => t.id === tabId)
    const paramErrors = validateParams(current?.params ?? [])
    if (paramErrors.length > 0) {
      setShowParamErrors(true)
      focusFirstParamError()
      return
    }
    setShowParamErrors(false)
    clearExplain(tabId)
    if (limitGuardEnabled && detectMissingLimit(current?.sql ?? '')) setShowLimitWarning(true)
    else runQuery(tabId)
  }, [clearExplain, runQuery, tabId, focusFirstParamError, limitGuardEnabled])

  const handleCancel = useCallback(() => cancelQuery(tabId), [cancelQuery, tabId])
  const handleExplain = useCallback(() => {
    const current = useQueryStore.getState().tabs.find((t) => t.id === tabId)
    const paramErrors = validateParams(current?.params ?? [])
    if (paramErrors.length > 0) {
      setShowParamErrors(true)
      focusFirstParamError()
      return
    }
    setShowParamErrors(false)
    explainQuery(tabId)
  }, [explainQuery, tabId, focusFirstParamError])

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

  const paramErrorMap = useMemo(
    () =>
      showParamErrors
        ? Object.fromEntries(validateParams(params).map((e) => [e.name, e.message]))
        : {},
    [showParamErrors, params],
  )

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
      {params.length > 0 && (
        <ParamsPanel params={params} errors={paramErrorMap} onChange={(next) => setTabParams(tabId, next)} />
      )}
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
