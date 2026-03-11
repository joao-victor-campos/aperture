import { useEffect, useRef } from 'react'
import type { QueryResult } from '@shared/types'

interface ResultsTableProps {
  result?: QueryResult
  error?: string
  isRunning?: boolean
  cancelled?: boolean
  logs?: string[]
}

export default function ResultsTable({
  result, error, isRunning, cancelled, logs = [],
}: ResultsTableProps) {
  const logEndRef = useRef<HTMLDivElement>(null)

  useEffect(() => {
    logEndRef.current?.scrollIntoView({ behavior: 'smooth' })
  }, [logs])

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

  const { columns, rows, rowCount, executionTimeMs, bytesProcessed } = result

  return (
    <div className="flex flex-col h-full">
      <div className="flex items-center gap-4 px-3 py-1.5 border-b border-app-border bg-app-surface shrink-0">
        <span className="text-xs text-app-text-2">
          {rowCount.toLocaleString()} {rowCount === 1 ? 'row' : 'rows'}
        </span>
        <span className="text-xs text-app-text-3">{executionTimeMs}ms</span>
        {bytesProcessed !== undefined && (
          <span className="text-xs text-app-text-3">{formatBytes(bytesProcessed)} processed</span>
        )}
      </div>

      <div className="flex-1 overflow-auto selectable">
        <table className="w-full text-xs border-collapse">
          <thead className="sticky top-0 bg-app-bg z-10">
            <tr>
              {columns.map((col) => (
                <th
                  key={col}
                  className="px-3 py-2 text-left text-app-text-2 font-medium border-b border-app-border whitespace-nowrap"
                >
                  {col}
                </th>
              ))}
            </tr>
          </thead>
          <tbody>
            {rows.map((row, i) => (
              <tr
                key={i}
                className={`hover:bg-app-elevated/40 transition-colors ${i % 2 === 0 ? '' : 'bg-app-surface/30'}`}
              >
                {columns.map((col) => (
                  <td
                    key={col}
                    className="px-3 py-1.5 text-app-text font-mono border-b border-app-border/40 whitespace-nowrap max-w-xs truncate"
                  >
                    {formatCell(row[col])}
                  </td>
                ))}
              </tr>
            ))}
          </tbody>
        </table>
      </div>
    </div>
  )
}

function formatCell(value: unknown): string {
  if (value === null || value === undefined) return 'NULL'
  if (typeof value === 'object') return JSON.stringify(value)
  return String(value)
}

function formatBytes(bytes: number): string {
  if (bytes < 1e6) return `${(bytes / 1e3).toFixed(1)} KB`
  if (bytes < 1e9) return `${(bytes / 1e6).toFixed(1)} MB`
  return `${(bytes / 1e9).toFixed(2)} GB`
}
