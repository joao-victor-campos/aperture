import { useEffect, useRef, useState } from 'react'
import { Download, Copy, Check, Pin, SlidersHorizontal } from 'lucide-react'
import { formatBytes } from '../../lib/formatBytes'

interface ResultsToolbarProps {
  displayTotal: number
  displayTotalStr: string
  hasMore?: boolean
  serverTotal?: number
  executionTimeMs: number
  bytesProcessed?: number
  fetchedRows: number
  activeFilterCount: number
  builderOpen: boolean
  onToggleBuilder: () => void
  onPin?: () => void
  pinned?: boolean
  copied: boolean
  onCopy: () => void
  exporting: boolean
  onExport: (format: 'csv' | 'json' | 'tsv') => void
}

export default function ResultsToolbar({
  displayTotal, displayTotalStr, hasMore, serverTotal, executionTimeMs, bytesProcessed,
  fetchedRows, activeFilterCount, builderOpen, onToggleBuilder, onPin, pinned,
  copied, onCopy, exporting, onExport,
}: ResultsToolbarProps) {
  const [exportOpen, setExportOpen] = useState(false)
  const exportRef = useRef<HTMLDivElement>(null)

  useEffect(() => {
    if (!exportOpen) return
    const handler = (e: MouseEvent) => {
      if (exportRef.current && !exportRef.current.contains(e.target as Node)) setExportOpen(false)
    }
    document.addEventListener('mousedown', handler)
    return () => document.removeEventListener('mousedown', handler)
  }, [exportOpen])

  return (
    <div className="flex items-center gap-4 px-3 py-1.5 border-b border-app-border bg-app-surface shrink-0">
      <span className="text-xs text-app-text-2 font-tabular">
        {displayTotal === 1 ? '1 row' : `${displayTotalStr} rows`}
        {hasMore && serverTotal == null && '+'}
      </span>
      <span className="text-xs text-app-text-3 font-tabular">{executionTimeMs}ms</span>
      {bytesProcessed !== undefined && (
        <span className="text-xs text-app-text-3 font-tabular">{formatBytes(bytesProcessed)} processed</span>
      )}
      {fetchedRows < (serverTotal ?? fetchedRows) && (
        <span className="text-xs text-app-text-3 font-tabular">
          ({fetchedRows.toLocaleString()} fetched)
        </span>
      )}
      <div className="flex-1" />
      <button
        onClick={onToggleBuilder}
        title={builderOpen ? 'Hide filter bar' : 'Filter & sort'}
        className={`relative flex items-center gap-1 text-xs px-2 py-0.5 rounded transition-colors border border-app-border ${
          builderOpen || activeFilterCount > 0
            ? 'text-app-accent border-app-accent/50 hover:bg-app-elevated'
            : 'text-app-text-2 hover:text-app-text hover:bg-app-elevated'
        }`}
      >
        <SlidersHorizontal size={11} />
        <span>Filter</span>
        {activeFilterCount > 0 && (
          <span className="absolute -top-1 -right-1 bg-app-accent text-white text-[9px] rounded-full w-3.5 h-3.5 flex items-center justify-center font-bold">
            {activeFilterCount}
          </span>
        )}
      </button>
      {onPin && (
        <button
          onClick={onPin}
          disabled={pinned || fetchedRows === 0}
          title={pinned ? 'Result pinned' : 'Pin result as snapshot tab'}
          className="flex items-center gap-1 text-xs px-2 py-0.5 rounded text-app-text-2 hover:text-app-text hover:bg-app-elevated disabled:opacity-40 disabled:cursor-not-allowed transition-colors border border-app-border"
        >
          <Pin size={11} className={pinned ? 'text-app-accent' : ''} />
          <span>{pinned ? 'Pinned' : 'Pin'}</span>
        </button>
      )}
      <button
        onClick={onCopy}
        disabled={fetchedRows === 0}
        title="Copy results to clipboard (TSV)"
        className="flex items-center gap-1 text-xs px-2 py-0.5 rounded text-app-text-2 hover:text-app-text hover:bg-app-elevated disabled:opacity-40 disabled:cursor-not-allowed transition-colors border border-app-border"
      >
        {copied ? <Check size={11} className="text-app-ok" /> : <Copy size={11} />}
        <span>{copied ? 'Copied' : 'Copy'}</span>
      </button>
      <div ref={exportRef} className="relative">
        <button
          onClick={() => setExportOpen((v) => !v)}
          disabled={exporting || fetchedRows === 0}
          title="Export results"
          className="flex items-center gap-1 text-xs px-2 py-0.5 rounded text-app-text-2 hover:text-app-text hover:bg-app-elevated disabled:opacity-40 disabled:cursor-not-allowed transition-colors border border-app-border"
        >
          <Download size={11} />
          <span>{exporting ? 'Saving…' : 'Export'}</span>
        </button>
        {exportOpen && (
          <div className="absolute top-full right-0 mt-1 bg-app-surface border border-app-border rounded-lg shadow-xl py-1 z-50 min-w-[100px]">
            {(['csv', 'tsv', 'json'] as const).map((fmt) => (
              <button
                key={fmt}
                onClick={() => { setExportOpen(false); onExport(fmt) }}
                className="w-full text-left px-3 py-1.5 text-xs text-app-text hover:bg-app-elevated transition-colors uppercase"
              >
                {fmt}
              </button>
            ))}
          </div>
        )}
      </div>
    </div>
  )
}
