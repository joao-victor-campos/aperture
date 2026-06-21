import { memo, useCallback, useMemo } from 'react'
import { BarChart3 } from 'lucide-react'
import { useShallow } from 'zustand/react/shallow'
import { useQueryStore } from '../../store/queryStore'
import { useChatStore } from '../../store/chatStore'
import ResultsTable from './ResultsTable'
import ChartView from './ChartView'
import ExplainPanel from './ExplainPanel'
import GraphView from './GraphView'
import GraphShapedBanner from './GraphShapedBanner'
import { detectGraphShape } from '../../lib/detectGraphShape'
import { buildGraphFromRecords } from '../../lib/buildGraphFromRecords'
import type { ChartConfig } from '@shared/types'

/**
 * The results area of a query tab: explain plan > graph view > (table | chart).
 * Subscribes only to the active tab's result-relevant fields.
 */
function ResultsRegion({ tabId }: { tabId: string }) {
  const tab = useQueryStore(
    useShallow((s) => {
      const t = s.tabs.find((x) => x.id === tabId)
      return {
        result: t?.result,
        error: t?.error,
        isRunning: t?.isRunning ?? false,
        cancelled: t?.cancelled,
        logs: t?.logs,
        explainResult: t?.explainResult,
        isExplaining: t?.isExplaining,
        viewAsGraph: t?.viewAsGraph,
        resultView: t?.resultView ?? 'table',
        chartConfig: t?.chartConfig,
      }
    }),
  )
  const fetchPage = useQueryStore((s) => s.fetchPage)
  const openResultTab = useQueryStore((s) => s.openResultTab)
  const toggleGraphView = useQueryStore((s) => s.toggleGraphView)
  const clearExplain = useQueryStore((s) => s.clearExplain)
  const setResultView = useQueryStore((s) => s.setResultView)
  const setChartConfig = useQueryStore((s) => s.setChartConfig)
  const requestFix = useChatStore((s) => s.requestFix)

  const handleFetchPage = useCallback(() => fetchPage(tabId), [fetchPage, tabId])
  const handlePin = useCallback(() => openResultTab(tabId), [openResultTab, tabId])
  const handleFixWithAI = useCallback(() => {
    const t = useQueryStore.getState().tabs.find((x) => x.id === tabId)
    if (!t?.error) return
    requestFix(t.sql, t.error)
  }, [requestFix, tabId])

  const graphShape = useMemo(() => {
    const rows = tab.result?.rows
    if (!rows || rows.length === 0) return { isGraph: false, truncated: false, nodeCount: 0 }
    if (!detectGraphShape(rows)) return { isGraph: false, truncated: false, nodeCount: 0 }
    const built = buildGraphFromRecords(rows)
    if (built.truncated) return { isGraph: true, truncated: true, nodeCount: built.nodeCount }
    return { isGraph: true, truncated: false, nodeCount: built.nodes.length }
  }, [tab.result?.rows])

  // Default chart config: first column as X, first column as Y, no aggregation.
  const defaultConfig = useCallback((): ChartConfig => {
    const cols = tab.result?.columns ?? []
    return { type: 'bar', xCol: cols[0] ?? '', yCol: cols[1] ?? cols[0] ?? '', aggregate: 'none' }
  }, [tab.result?.columns])

  const handleShowChart = useCallback(() => {
    if (!useQueryStore.getState().tabs.find((t) => t.id === tabId)?.chartConfig) {
      setChartConfig(tabId, defaultConfig())
    }
    setResultView(tabId, 'chart')
  }, [tabId, setChartConfig, setResultView, defaultConfig])

  const handleConfigChange = useCallback((partial: Partial<ChartConfig>) => {
    const current = useQueryStore.getState().tabs.find((t) => t.id === tabId)?.chartConfig
    setChartConfig(tabId, { ...defaultConfig(), ...current, ...partial })
  }, [tabId, setChartConfig, defaultConfig])

  if (tab.explainResult || tab.isExplaining) {
    return (
      <ExplainPanel
        result={tab.explainResult ?? { bytesProcessed: 0 }}
        isLoading={tab.isExplaining}
        onClose={() => clearExplain(tabId)}
      />
    )
  }

  if (tab.viewAsGraph && tab.result && graphShape.isGraph && !graphShape.truncated) {
    return <GraphView result={tab.result} onBack={() => toggleGraphView(tabId)} />
  }

  // Chart view — only meaningful with a result and not on graph-shaped (Neo4j) data.
  if (tab.resultView === 'chart' && tab.result && !graphShape.isGraph) {
    return (
      <ChartView
        result={tab.result}
        config={tab.chartConfig ?? defaultConfig()}
        onConfigChange={handleConfigChange}
        onShowTable={() => setResultView(tabId, 'table')}
      />
    )
  }

  return (
    <>
      {graphShape.isGraph && (
        <GraphShapedBanner
          truncated={graphShape.truncated}
          nodeCount={graphShape.nodeCount}
          onViewAsGraph={() => toggleGraphView(tabId)}
        />
      )}
      {/* Chart toggle — shown when there is a non-graph result to plot */}
      {tab.result && !graphShape.isGraph && tab.result.rows.length > 0 && (
        <div className="flex items-center justify-end px-3 py-1 border-b border-app-border bg-app-surface shrink-0">
          <button
            onClick={handleShowChart}
            title="Visualize as chart"
            className="flex items-center gap-1 text-xs px-2 py-0.5 rounded text-app-text-2 hover:text-app-text hover:bg-app-elevated transition-colors border border-app-border"
          >
            <BarChart3 size={11} /> Chart
          </button>
        </div>
      )}
      <ResultsTable
        result={tab.result}
        error={tab.error}
        isRunning={tab.isRunning}
        cancelled={tab.cancelled}
        logs={tab.logs}
        onFetchPage={handleFetchPage}
        onPin={handlePin}
        onFixWithAI={handleFixWithAI}
      />
    </>
  )
}

export default memo(ResultsRegion)
