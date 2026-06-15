import { memo, useCallback, useMemo } from 'react'
import { useShallow } from 'zustand/react/shallow'
import { useQueryStore } from '../../store/queryStore'
import ResultsTable from './ResultsTable'
import ExplainPanel from './ExplainPanel'
import GraphView from './GraphView'
import GraphShapedBanner from './GraphShapedBanner'
import { detectGraphShape } from '../../lib/detectGraphShape'
import { buildGraphFromRecords } from '../../lib/buildGraphFromRecords'

/**
 * The results area of a query tab: explain plan > graph view > banner + table.
 * Subscribes only to the active tab's result-relevant fields, so editor typing
 * (which mutates `sql`) never re-renders this subtree, and a streaming log tick
 * never re-renders the editor.
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
      }
    }),
  )
  const fetchPage = useQueryStore((s) => s.fetchPage)
  const openResultTab = useQueryStore((s) => s.openResultTab)
  const toggleGraphView = useQueryStore((s) => s.toggleGraphView)
  const clearExplain = useQueryStore((s) => s.clearExplain)

  // Stable callbacks so ResultsTable's React.memo actually skips re-renders.
  const handleFetchPage = useCallback(() => fetchPage(tabId), [fetchPage, tabId])
  const handlePin = useCallback(() => openResultTab(tabId), [openResultTab, tabId])

  const graphShape = useMemo(() => {
    const rows = tab.result?.rows
    if (!rows || rows.length === 0) return { isGraph: false, truncated: false, nodeCount: 0 }
    if (!detectGraphShape(rows)) return { isGraph: false, truncated: false, nodeCount: 0 }
    const built = buildGraphFromRecords(rows)
    if (built.truncated) return { isGraph: true, truncated: true, nodeCount: built.nodeCount }
    return { isGraph: true, truncated: false, nodeCount: built.nodes.length }
  }, [tab.result?.rows])

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

  return (
    <>
      {graphShape.isGraph && (
        <GraphShapedBanner
          truncated={graphShape.truncated}
          nodeCount={graphShape.nodeCount}
          onViewAsGraph={() => toggleGraphView(tabId)}
        />
      )}
      <ResultsTable
        result={tab.result}
        error={tab.error}
        isRunning={tab.isRunning}
        cancelled={tab.cancelled}
        logs={tab.logs}
        onFetchPage={handleFetchPage}
        onPin={handlePin}
      />
    </>
  )
}

export default memo(ResultsRegion)
