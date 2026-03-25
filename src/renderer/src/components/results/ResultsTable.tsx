import { useEffect, useRef, useState } from 'react'
import { ChevronLeft, ChevronRight, Loader2 } from 'lucide-react'
import type { QueryResult } from '@shared/types'

interface ResultsTableProps {
  result?: QueryResult
  error?: string
  isRunning?: boolean
  cancelled?: boolean
  logs?: string[]
  onFetchPage?: () => Promise<void>
}

const PAGE_SIZES = [50, 100, 250, 500]
const MIN_COL_WIDTH = 60
const MAX_COL_WIDTH = 1200
const DEFAULT_COL_WIDTH = 160

export default function ResultsTable({
  result, error, isRunning, cancelled, logs = [], onFetchPage,
}: ResultsTableProps) {
  const logEndRef = useRef<HTMLDivElement>(null)
  const [page, setPage] = useState(0)
  const [pageSize, setPageSize] = useState(100)
  const [loadingMore, setLoadingMore] = useState(false)
  // colWidths: column name → px width (only set when user has dragged)
  const [colWidths, setColWidths] = useState<Record<string, number>>({})
  const resizingCol = useRef<{ col: string; startX: number; startWidth: number } | null>(null)

  useEffect(() => {
    logEndRef.current?.scrollIntoView({ behavior: 'smooth' })
  }, [logs])

  // Reset to first page + col widths whenever a new result set arrives
  const resultColumnsRef = useRef<string[]>([])
  useEffect(() => {
    if (!result) return
    const cols = result.columns.join(',')
    if (cols !== resultColumnsRef.current.join(',')) {
      setPage(0)
      setColWidths({})
      resultColumnsRef.current = result.columns
    }
  }, [result])

  // ── Column resize handlers ───────────────────────────────────────────────
  const handleResizeMouseDown = (e: React.MouseEvent, col: string) => {
    e.preventDefault()
    e.stopPropagation()
    const currentWidth = colWidths[col] ?? DEFAULT_COL_WIDTH
    resizingCol.current = { col, startX: e.clientX, startWidth: currentWidth }

    const onMove = (ev: MouseEvent) => {
      if (!resizingCol.current) return
      const delta = ev.clientX - resizingCol.current.startX
      const newWidth = Math.min(MAX_COL_WIDTH, Math.max(MIN_COL_WIDTH, resizingCol.current.startWidth + delta))
      const col = resizingCol.current.col
      setColWidths((prev) => ({ ...prev, [col]: newWidth }))
    }
    const onUp = () => {
      resizingCol.current = null
      window.removeEventListener('mousemove', onMove)
      window.removeEventListener('mouseup', onUp)
    }
    window.addEventListener('mousemove', onMove)
    window.addEventListener('mouseup', onUp)
  }

  if (isRunning) {
    return (
      <div className="flex flex-col h-full">
        <div className="flex items-center gap-2 px-3 py-1.5 border-b border-app-border bg-app-surface shrink-0">
          <span className="w-1.5 h-1.5 rounded-full bg-app-accent animate-pulse" />
          <span className="text-xs text-app-text-2">Running…</span>
        </div>
        <div className="flex-1 overflow-y-auto p-4 font-mono text-xs space-y-0.5 selectable">
          {logs.length === 0 && (
            <span className="text-app-text-3 animate-pulse">Connecting to BigQuery…</span>
          )}
          {logs.map((line, i) => (
            <div key={i} className={i === logs.length - 1 ? 'text-app-text' : 'text-app-text-3'}>
              {line}
            </div>
          ))}
          <div ref={logEndRef} />
        </div>
      </div>
    )
  }

  if (cancelled) {
    return (
      <div className="flex flex-col h-full">
        {logs.length > 0 && (
          <div className="flex-1 overflow-y-auto p-4 font-mono text-xs space-y-0.5 selectable">
            {logs.map((line, i) => (
              <div key={i} className="text-app-text-3">{line}</div>
            ))}
          </div>
        )}
        <div className="flex items-center justify-center py-6 text-app-text-3 text-xs border-t border-app-border">
          Query cancelled
        </div>
      </div>
    )
  }

  if (error) {
    return (
      <div className="flex flex-col h-full">
        {logs.length > 0 && (
          <div className="overflow-y-auto max-h-24 p-3 font-mono text-xs space-y-0.5 border-b border-app-border selectable">
            {logs.map((line, i) => (
              <div key={i} className="text-app-text-3">{line}</div>
            ))}
          </div>
        )}
        <div className="p-4">
          <div className="bg-red-950/60 border border-red-900/60 rounded-lg p-3">
            <p className="text-xs font-mono text-red-400 whitespace-pre-wrap selectable">{error}</p>
          </div>
        </div>
      </div>
    )
  }

  if (!result) {
    return (
      <div className="h-full flex items-center justify-center text-app-text-3 text-sm">
        Run a query to see results
      </div>
    )
  }

  const { columns, rows, executionTimeMs, bytesProcessed, totalRows: serverTotal, hasMore } = result
  const fetchedRows = rows.length
  const totalPages = Math.max(1, Math.ceil(fetchedRows / pageSize))
  const pageRows = rows.slice(page * pageSize, (page + 1) * pageSize)
  const startRow = fetchedRows === 0 ? 0 : page * pageSize + 1
  const endRow = Math.min((page + 1) * pageSize, fetchedRows)

  const onLastFetchedPage = page >= totalPages - 1
  const canLoadMore = hasMore && onFetchPage

  const handleNextPage = async () => {
    if (page < totalPages - 1) {
      setPage((p) => p + 1)
    } else if (canLoadMore) {
      setLoadingMore(true)
      try {
        await onFetchPage()
        setPage((p) => p + 1)
      } finally {
        setLoadingMore(false)
      }
    }
  }

  const displayTotal = serverTotal != null ? serverTotal : fetchedRows
  const displayTotalStr = serverTotal != null
    ? `${serverTotal.toLocaleString()}`
    : `${fetchedRows.toLocaleString()}`

  return (
    <div className="flex flex-col h-full">
      {/* Status bar */}
      <div className="flex items-center gap-4 px-3 py-1.5 border-b border-app-border bg-app-surface shrink-0">
        <span className="text-xs text-app-text-2">
          {displayTotal === 1 ? '1 row' : `${displayTotalStr} rows`}
          {hasMore && serverTotal == null && '+'}
        </span>
        <span className="text-xs text-app-text-3">{executionTimeMs}ms</span>
        {bytesProcessed !== undefined && (
          <span className="text-xs text-app-text-3">{formatBytes(bytesProcessed)} processed</span>
        )}
        {fetchedRows < (serverTotal ?? fetchedRows) && (
          <span className="text-xs text-app-text-3">
            ({fetchedRows.toLocaleString()} fetched)
          </span>
        )}
      </div>

      {/* Table */}
      <div className="flex-1 overflow-auto selectable results-area">
        <table className="text-xs border-collapse" style={{ tableLayout: 'fixed', width: 'max-content', minWidth: '100%' }}>
          <colgroup>
            {columns.map((col) => (
              <col key={col} style={{ width: colWidths[col] ?? DEFAULT_COL_WIDTH }} />
            ))}
          </colgroup>
          <thead className="sticky top-0 bg-app-bg z-10">
            <tr>
              {columns.map((col) => (
                <th
                  key={col}
                  className="relative px-3 py-2 text-left text-app-text-2 font-medium border-b border-app-border whitespace-nowrap select-none"
                  style={{ width: colWidths[col] ?? DEFAULT_COL_WIDTH }}
                >
                  <span className="block truncate pr-2">{col}</span>
                  {/* Resize handle */}
                  <div
                    onMouseDown={(e) => handleResizeMouseDown(e, col)}
                    className="absolute right-0 top-0 h-full w-3 flex items-center justify-center cursor-col-resize group z-20"
                  >
                    <div className="w-px h-4 bg-app-border group-hover:bg-app-accent transition-colors" />
                  </div>
                </th>
              ))}
            </tr>
          </thead>
          <tbody>
            {pageRows.map((row, i) => (
              <tr
                key={i}
                className={`hover:bg-app-elevated/40 transition-colors ${i % 2 === 0 ? '' : 'bg-app-surface/30'}`}
              >
                {columns.map((col) => (
                  <td
                    key={col}
                    className="px-3 py-1.5 text-app-text font-mono border-b border-app-border/40 overflow-hidden"
                    style={{ width: colWidths[col] ?? DEFAULT_COL_WIDTH, maxWidth: colWidths[col] ?? DEFAULT_COL_WIDTH }}
                    title={formatCell(row[col])}
                  >
                    <span className="block truncate">{formatCell(row[col])}</span>
                  </td>
                ))}
              </tr>
            ))}
          </tbody>
        </table>
      </div>

      {/* Pagination bar */}
      <div className="flex items-center justify-between px-3 py-1.5 border-t border-app-border bg-app-surface shrink-0">
        <span className="text-xs text-app-text-3">
          {fetchedRows === 0
            ? 'No rows'
            : `${startRow.toLocaleString()}–${endRow.toLocaleString()} of ${displayTotalStr}`}
          {hasMore && serverTotal == null && '+'}
        </span>

        <div className="flex items-center gap-3">
          <div className="flex items-center gap-1.5">
            <span className="text-xs text-app-text-3">Rows per page</span>
            <select
              value={pageSize}
              onChange={(e) => { setPageSize(Number(e.target.value)); setPage(0) }}
              className="bg-app-elevated text-app-text text-xs rounded px-1.5 py-0.5 border border-app-border focus:outline-none focus:border-app-accent cursor-pointer"
            >
              {PAGE_SIZES.map((s) => (
                <option key={s} value={s}>{s}</option>
              ))}
            </select>
          </div>

          <div className="flex items-center gap-1">
            <button
              onClick={() => setPage((p) => p - 1)}
              disabled={page === 0}
              className="p-0.5 rounded text-app-text-2 hover:text-app-text hover:bg-app-elevated disabled:opacity-30 disabled:cursor-not-allowed transition-colors"
            >
              <ChevronLeft size={14} />
            </button>
            <span className="text-xs text-app-text-2 min-w-[60px] text-center">
              {loadingMore ? (
                <Loader2 size={12} className="inline animate-spin" />
              ) : (
                `${page + 1} / ${totalPages}${hasMore ? '+' : ''}`
              )}
            </span>
            <button
              onClick={handleNextPage}
              disabled={onLastFetchedPage && !canLoadMore}
              className="p-0.5 rounded text-app-text-2 hover:text-app-text hover:bg-app-elevated disabled:opacity-30 disabled:cursor-not-allowed transition-colors"
            >
              <ChevronRight size={14} />
            </button>
          </div>
        </div>
      </div>
    </div>
  )
}

// ── Cell formatter ───────────────────────────────────────────────────────────
function formatCell(value: unknown): string {
  if (value === null || value === undefined) return 'NULL'
  if (typeof value === 'object') {
    // BigQuery wraps DATE / DATETIME / TIMESTAMP / NUMERIC as { value: "..." }
    const v = value as Record<string, unknown>
    if ('value' in v && typeof v.value === 'string') return v.value
    return JSON.stringify(value)
  }
  return String(value)
}

function formatBytes(bytes: number): string {
  if (bytes < 1e6) return `${(bytes / 1e3).toFixed(1)} KB`
  if (bytes < 1e9) return `${(bytes / 1e6).toFixed(1)} MB`
  return `${(bytes / 1e9).toFixed(2)} GB`
}
