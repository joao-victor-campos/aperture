import { X } from 'lucide-react'
import { formatBytes } from '@shared/formatBytes'

interface ExplainPanelProps {
  result: { bytesProcessed: number; plan?: string; planFormat?: 'text' | 'json' }
  isLoading?: boolean
  onClose: () => void
}

export default function ExplainPanel({ result, isLoading, onClose }: ExplainPanelProps) {
  if (isLoading) {
    return (
      <div className="flex flex-col h-full">
        <Header bytesProcessed={0} onClose={onClose} />
        <div className="flex-1 flex items-center justify-center text-app-text-3 text-xs animate-pulse">
          Running explain plan…
        </div>
      </div>
    )
  }

  return (
    <div className="flex flex-col h-full">
      <Header bytesProcessed={result.bytesProcessed} onClose={onClose} />
      <div className="flex-1 overflow-auto p-4 bg-app-bg">
        {result.plan ? (
          <pre className="text-xs font-mono text-app-text whitespace-pre-wrap break-words leading-relaxed selectable">
            {result.plan}
          </pre>
        ) : (
          <div className="flex flex-col items-center justify-center h-full gap-2 text-app-text-3">
            <span className="app-section-label">Dry Run OK</span>
            <span className="text-xs">
              {result.bytesProcessed > 0
                ? `${formatBytes(result.bytesProcessed)} would be scanned`
                : 'Query is valid'}
            </span>
          </div>
        )}
      </div>
    </div>
  )
}

function Header({ bytesProcessed, onClose }: { bytesProcessed: number; onClose: () => void }) {
  return (
    <div className="flex items-center gap-3 px-3 py-1.5 border-b border-app-border bg-app-surface shrink-0">
      <span className="app-section-label">Explain Plan</span>
      {bytesProcessed > 0 && (
        <span className="text-xs text-app-text-3 font-tabular">
          {formatBytes(bytesProcessed)} estimated
        </span>
      )}
      <div className="flex-1" />
      <button
        onClick={onClose}
        title="Close explain panel"
        className="p-1 rounded text-app-text-3 hover:text-app-text hover:bg-app-elevated transition-colors"
      >
        <X size={13} />
      </button>
    </div>
  )
}

