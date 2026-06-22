import { useEffect, useLayoutEffect, useRef, useState } from 'react'
import { useVirtualizer } from '@tanstack/react-virtual'
import { ChevronUp, ChevronDown as ChevronDownIcon } from 'lucide-react'
import type { Neo4jGraphValue } from '@shared/types'
import { formatCell } from '../../lib/formatCell'
import { isGraphElement } from '../../lib/formatGraphElement'
import GraphElementChip from './GraphElementChip'

const MIN_COL_WIDTH = 60
const MAX_COL_WIDTH = 1200
const DEFAULT_COL_WIDTH = 160
const ROW_HEIGHT = 29 // px — fixed; cells are single-line (truncate)

interface ResultsGridProps {
  columns: string[]
  pageRows: Record<string, unknown>[]
  page: number
  /** identity changes when the filtered/sorted window changes — triggers scroll reset */
  resetKey: unknown
  colWidths: Record<string, number>
  setColWidths: React.Dispatch<React.SetStateAction<Record<string, number>>>
  sortCol: string | null
  sortDir: 'asc' | 'desc'
  onToggleSort: (col: string) => void
}

export default function ResultsGrid({
  columns, pageRows, page, resetKey, colWidths, setColWidths, sortCol, sortDir, onToggleSort,
}: ResultsGridProps) {
  const resizingCol = useRef<{ col: string; startX: number; startWidth: number } | null>(null)
  const [copiedCol, setCopiedCol] = useState<string | null>(null)
  const copyTimeoutRef = useRef<ReturnType<typeof setTimeout> | null>(null)
  const scrollRef = useRef<HTMLDivElement>(null)
  const tbodyRef = useRef<HTMLTableSectionElement>(null)
  const [scrollMargin, setScrollMargin] = useState(0)

  useEffect(() => () => {
    if (copyTimeoutRef.current) clearTimeout(copyTimeoutRef.current)
    resizingCol.current = null
  }, [])

  const handleCopyColName = (col: string) => {
    navigator.clipboard.writeText(col)
    if (copyTimeoutRef.current) clearTimeout(copyTimeoutRef.current)
    setCopiedCol(col)
    copyTimeoutRef.current = setTimeout(() => setCopiedCol(null), 1500)
  }

  const handleResizeMouseDown = (e: React.MouseEvent, col: string) => {
    e.preventDefault()
    e.stopPropagation()
    const currentWidth = colWidths[col] ?? DEFAULT_COL_WIDTH
    resizingCol.current = { col, startX: e.clientX, startWidth: currentWidth }
    const onMove = (ev: MouseEvent) => {
      if (!resizingCol.current) return
      const delta = ev.clientX - resizingCol.current.startX
      const newWidth = Math.min(MAX_COL_WIDTH, Math.max(MIN_COL_WIDTH, resizingCol.current.startWidth + delta))
      const c = resizingCol.current.col
      setColWidths((prev) => ({ ...prev, [c]: newWidth }))
    }
    const onUp = () => {
      resizingCol.current = null
      window.removeEventListener('mousemove', onMove)
      window.removeEventListener('mouseup', onUp)
    }
    window.addEventListener('mousemove', onMove)
    window.addEventListener('mouseup', onUp)
  }

  useLayoutEffect(() => {
    const top = tbodyRef.current?.offsetTop ?? 0
    setScrollMargin((prev) => (prev !== top ? top : prev))
  })

  const rowVirtualizer = useVirtualizer({
    count: pageRows.length,
    getScrollElement: () => scrollRef.current,
    estimateSize: () => ROW_HEIGHT,
    overscan: 12,
    scrollMargin,
  })

  useEffect(() => {
    if (scrollRef.current) scrollRef.current.scrollTop = 0
  }, [page, resetKey])

  return (
    <div ref={scrollRef} className="flex-1 overflow-auto selectable results-area">
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
                <div className="flex items-center gap-1 pr-2">
                  <span
                    onClick={() => handleCopyColName(col)}
                    title={`Click to copy "${col}"`}
                    className="block truncate cursor-pointer hover:text-app-text transition-colors flex-1 min-w-0"
                  >
                    {copiedCol === col ? '✓ Copied' : col}
                  </span>
                  <button
                    onClick={() => onToggleSort(col)}
                    className={`shrink-0 transition-opacity ${sortCol === col ? 'opacity-100' : 'opacity-0 group-hover:opacity-60'}`}
                    title={sortCol === col ? (sortDir === 'asc' ? 'Sort descending' : 'Remove sort') : `Sort by ${col}`}
                  >
                    {sortCol === col
                      ? (sortDir === 'asc' ? <ChevronUp size={10} className="text-app-accent" /> : <ChevronDownIcon size={10} className="text-app-accent" />)
                      : <ChevronUp size={10} className="text-app-text-3" />
                    }
                  </button>
                </div>
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
        <tbody ref={tbodyRef}>
          {(() => {
            const virtualItems = rowVirtualizer.getVirtualItems()
            const totalSize = rowVirtualizer.getTotalSize()
            const paddingTop = virtualItems.length > 0 ? virtualItems[0].start - scrollMargin : 0
            const paddingBottom =
              virtualItems.length > 0
                ? totalSize - (virtualItems[virtualItems.length - 1].end - scrollMargin)
                : 0
            return (
              <>
                {paddingTop > 0 && (
                  <tr aria-hidden="true">
                    <td colSpan={columns.length} style={{ height: paddingTop, padding: 0, border: 0 }} />
                  </tr>
                )}
                {virtualItems.map((vi) => {
                  const row = pageRows[vi.index]
                  return (
                    <tr
                      key={`${page}-${vi.index}`}
                      style={{ height: ROW_HEIGHT }}
                      className={`hover:bg-app-elevated/40 transition-colors ${vi.index % 2 === 0 ? '' : 'bg-app-surface/30'}`}
                    >
                      {columns.map((col) => {
                        const cell = row[col]
                        return (
                          <td
                            key={col}
                            className="px-3 py-1.5 text-app-text font-mono border-b border-app-border/40 overflow-hidden"
                            style={{ width: colWidths[col] ?? DEFAULT_COL_WIDTH, maxWidth: colWidths[col] ?? DEFAULT_COL_WIDTH }}
                            title={isGraphElement(cell) ? undefined : formatCell(cell)}
                          >
                            {isGraphElement(cell) ? (
                              <GraphElementChip value={cell as Neo4jGraphValue} />
                            ) : (
                              <span className="block truncate">{formatCell(cell)}</span>
                            )}
                          </td>
                        )
                      })}
                    </tr>
                  )
                })}
                {paddingBottom > 0 && (
                  <tr aria-hidden="true">
                    <td colSpan={columns.length} style={{ height: paddingBottom, padding: 0, border: 0 }} />
                  </tr>
                )}
              </>
            )
          })()}
        </tbody>
      </table>
    </div>
  )
}
