import { Sparkles } from 'lucide-react'
import QueryLogView from './QueryLogView'

export type ResultsView = 'running' | 'cancelled' | 'error' | 'empty' | 'table'

export function resultsViewState(p: {
  isRunning?: boolean
  cancelled?: boolean
  error?: string
  hasResult: boolean
}): ResultsView {
  if (p.isRunning) return 'running'
  if (p.cancelled) return 'cancelled'
  if (p.error) return 'error'
  if (!p.hasResult) return 'empty'
  return 'table'
}

interface ResultsStateViewProps {
  state: Exclude<ResultsView, 'table'>
  logs: string[]
  error?: string
  onFixWithAI?: () => void
}

export default function ResultsStateView({ state, logs, error, onFixWithAI }: ResultsStateViewProps) {
  if (state === 'running') {
    return (
      <div className="flex flex-col h-full">
        <div className="flex items-center gap-2 px-3 py-1.5 border-b border-app-border bg-app-surface shrink-0">
          <span className="app-dot animate-pulse" style={{ backgroundColor: 'rgb(var(--c-accent))' }} />
          <span className="text-xs text-app-text-2 font-medium">Running…</span>
        </div>
        <div className="flex-1 overflow-y-auto p-4 font-mono text-xs selectable bg-app-bg">
          {logs.length === 0 ? (
            <span className="text-app-text-3 animate-pulse">Connecting…</span>
          ) : (
            <QueryLogView logs={logs} highlightLast />
          )}
        </div>
      </div>
    )
  }

  if (state === 'cancelled') {
    return (
      <div className="flex flex-col h-full">
        {logs.length > 0 && (
          <div className="flex-1 overflow-y-auto p-4 font-mono text-xs selectable bg-app-bg">
            <QueryLogView logs={logs} />
          </div>
        )}
        <div className="flex items-center justify-center gap-2 py-6 text-app-warn text-xs border-t border-app-border bg-app-warn-subtle/40">
          <span className="app-dot" style={{ backgroundColor: 'rgb(var(--c-state-warn))' }} />
          Query cancelled
        </div>
      </div>
    )
  }

  if (state === 'error') {
    return (
      <div className="flex flex-col h-full">
        {logs.length > 0 && (
          <div className="overflow-y-auto max-h-32 p-3 font-mono text-xs border-b border-app-border selectable bg-app-bg">
            <QueryLogView logs={logs} />
          </div>
        )}
        <div className="p-4">
          <div className="bg-app-err-subtle border border-app-err/30 rounded-lg p-3">
            <p className="text-xs font-mono text-app-err whitespace-pre-wrap selectable">{error}</p>
          </div>
          {onFixWithAI && (
            <button
              type="button"
              onClick={onFixWithAI}
              className="mt-3 inline-flex items-center gap-1.5 px-2.5 py-1 rounded-md text-ui font-medium bg-app-accent hover:bg-app-accent-hover text-white transition-colors"
            >
              <Sparkles size={13} /> Fix with AI
            </button>
          )}
        </div>
      </div>
    )
  }

  // empty
  return (
    <div className="h-full flex flex-col items-center justify-center gap-2 text-app-text-3 text-sm bg-app-bg">
      <span className="app-section-label">Empty</span>
      <span>Run a query to see results</span>
    </div>
  )
}
