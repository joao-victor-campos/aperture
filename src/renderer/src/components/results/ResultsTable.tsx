import { memo, useEffect, useMemo, useRef, useState } from 'react'
import { CHANNELS } from '@shared/ipc'
import type { QueryResult } from '@shared/types'
import { filterSortRows } from '../../lib/filterSortRows'
import { paginate } from '../../lib/paginate'
import { rowsToTsv } from '../../lib/rowsToTsv'
import ResultsStateView, { resultsViewState } from './ResultsStateView'
import ResultsToolbar from './ResultsToolbar'
import FilterSortBar from './FilterSortBar'
import ResultsGrid from './ResultsGrid'
import ResultsPagination from './ResultsPagination'

interface ResultsTableProps {
  result?: QueryResult
  error?: string
  isRunning?: boolean
  cancelled?: boolean
  logs?: string[]
  onFetchPage?: () => Promise<void>
  onPin?: () => void
  pinned?: boolean
  /** When set, the error state shows a "Fix with AI" button that hands the SQL + error to the chat. */
  onFixWithAI?: () => void
}

const EMPTY_ROWS: Record<string, unknown>[] = []

function ResultsTable({
  result, error, isRunning, cancelled, logs = [], onFetchPage, onPin, pinned, onFixWithAI,
}: ResultsTableProps) {
  const [page, setPage] = useState(0)
  const [pageSize, setPageSize] = useState(100)
  const [loadingMore, setLoadingMore] = useState(false)
  const [exporting, setExporting] = useState(false)
  const [copied, setCopied] = useState(false)
  const copiedTimeoutRef = useRef<ReturnType<typeof setTimeout> | null>(null)
  // colWidths: column name → px width (only set when user has dragged)
  const [colWidths, setColWidths] = useState<Record<string, number>>({})
  // Filter / sort state
  const [builderOpen, setBuilderOpen] = useState(false)
  const [colFilters, setColFilters] = useState<Record<string, string>>({})
  const [sortCol, setSortCol] = useState<string | null>(null)
  const [sortDir, setSortDir] = useState<'asc' | 'desc'>('asc')

  // Clean up pending timers on unmount
  useEffect(() => {
    return () => {
      if (copiedTimeoutRef.current) clearTimeout(copiedTimeoutRef.current)
    }
  }, [])

  // Reset to first page + col widths + filters whenever a new result set arrives
  const resultColumnsRef = useRef<string[]>([])
  useEffect(() => {
    if (!result) return
    const cols = result.columns.join(',')
    if (cols !== resultColumnsRef.current.join(',')) {
      setPage(0)
      setColWidths({})
      setColFilters({})
      setSortCol(null)
      resultColumnsRef.current = result.columns
    }
  }, [result])

  // Derive filtered/sorted/paged rows once — memoized so typing/resizing the
  // parent does not recompute over the full result set.
  const allRows = result?.rows ?? EMPTY_ROWS
  const filteredRows = useMemo(
    () => filterSortRows(allRows, colFilters, sortCol, sortDir),
    [allRows, colFilters, sortCol, sortDir],
  )
  const pageRows = useMemo(
    () => paginate(filteredRows, page, pageSize),
    [filteredRows, page, pageSize],
  )

  const state = resultsViewState({ isRunning, cancelled, error, hasResult: !!result })
  if (state !== 'table') {
    return <ResultsStateView state={state} logs={logs} error={error} onFixWithAI={onFixWithAI} />
  }

  const { columns, rows, executionTimeMs, bytesProcessed, totalRows: serverTotal, hasMore } = result!
  const fetchedRows = rows.length
  const activeFilterCount = Object.values(colFilters).filter((v) => v.trim() !== '').length
  const totalPages = Math.max(1, Math.ceil(filteredRows.length / pageSize))
  const startRow = filteredRows.length === 0 ? 0 : page * pageSize + 1
  const endRow = Math.min((page + 1) * pageSize, filteredRows.length)

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

  const handleExport = async (format: 'csv' | 'json' | 'tsv') => {
    setExporting(true)
    try {
      await window.api.invoke(CHANNELS.EXPORT_RESULTS, { rows, columns, format })
    } catch {
      // Export failures surface via the main-process dialog; nothing to do here.
    } finally {
      setExporting(false)
    }
  }

  const handleCopy = async () => {
    // Copy the current filtered/sorted view across all fetched rows.
    const tsv = rowsToTsv(filteredRows, columns)
    try {
      await navigator.clipboard.writeText(tsv)
      if (copiedTimeoutRef.current) clearTimeout(copiedTimeoutRef.current)
      setCopied(true)
      copiedTimeoutRef.current = setTimeout(() => setCopied(false), 1500)
    } catch {
      // Clipboard can be blocked (permissions); nothing actionable to show here.
    }
  }

  return (
    <div className="flex flex-col h-full">
      <ResultsToolbar
        displayTotal={displayTotal}
        displayTotalStr={displayTotalStr}
        hasMore={hasMore}
        serverTotal={serverTotal}
        executionTimeMs={executionTimeMs}
        bytesProcessed={bytesProcessed}
        fetchedRows={fetchedRows}
        activeFilterCount={activeFilterCount}
        builderOpen={builderOpen}
        onToggleBuilder={() => setBuilderOpen((v) => !v)}
        onPin={onPin}
        pinned={pinned}
        copied={copied}
        onCopy={handleCopy}
        exporting={exporting}
        onExport={handleExport}
      />

      {builderOpen && (
        <FilterSortBar
          columns={columns}
          colWidths={colWidths}
          colFilters={colFilters}
          activeFilterCount={activeFilterCount}
          onFilterChange={(col, value) => { setColFilters((prev) => ({ ...prev, [col]: value })); setPage(0) }}
          onClear={() => { setColFilters({}); setSortCol(null); setPage(0) }}
        />
      )}

      <ResultsGrid
        columns={columns}
        pageRows={pageRows}
        page={page}
        resetKey={filteredRows}
        colWidths={colWidths}
        setColWidths={setColWidths}
        sortCol={sortCol}
        sortDir={sortDir}
        onToggleSort={(col) => {
          if (sortCol === col) {
            if (sortDir === 'asc') setSortDir('desc')
            else { setSortCol(null); setSortDir('asc') }
          } else {
            setSortCol(col); setSortDir('asc')
          }
          setPage(0)
        }}
      />

      <ResultsPagination
        filteredCount={filteredRows.length}
        startRow={startRow}
        endRow={endRow}
        displayTotalStr={displayTotalStr}
        activeFilterCount={activeFilterCount}
        hasMore={hasMore}
        serverTotal={serverTotal}
        page={page}
        totalPages={totalPages}
        pageSize={pageSize}
        loadingMore={loadingMore}
        onPrev={() => setPage((p) => p - 1)}
        onNext={handleNextPage}
        onPageSizeChange={(size) => { setPageSize(size); setPage(0) }}
        onLastFetchedPage={onLastFetchedPage}
        canLoadMore={!!canLoadMore}
      />
    </div>
  )
}

export default memo(ResultsTable)
