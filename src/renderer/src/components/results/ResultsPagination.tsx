import { ChevronLeft, ChevronRight, Loader2 } from 'lucide-react'

const PAGE_SIZES = [50, 100, 250, 500]

interface ResultsPaginationProps {
  filteredCount: number
  startRow: number
  endRow: number
  displayTotalStr: string
  activeFilterCount: number
  hasMore?: boolean
  serverTotal?: number
  page: number
  totalPages: number
  pageSize: number
  loadingMore: boolean
  onPrev: () => void
  onNext: () => void
  onPageSizeChange: (size: number) => void
  onLastFetchedPage: boolean
  canLoadMore: boolean | undefined
}

export default function ResultsPagination({
  filteredCount, startRow, endRow, displayTotalStr, activeFilterCount, hasMore, serverTotal,
  page, totalPages, pageSize, loadingMore, onPrev, onNext, onPageSizeChange,
  onLastFetchedPage, canLoadMore,
}: ResultsPaginationProps) {
  return (
    <div className="flex items-center justify-between px-3 py-1.5 border-t border-app-border bg-app-surface shrink-0">
      <span className="text-xs text-app-text-3 font-tabular">
        {filteredCount === 0
          ? 'No rows'
          : `${startRow.toLocaleString()}–${endRow.toLocaleString()} of ${activeFilterCount > 0 ? `${filteredCount.toLocaleString()} filtered` : displayTotalStr}`}
        {!activeFilterCount && hasMore && serverTotal == null && '+'}
      </span>

      <div className="flex items-center gap-3">
        <div className="flex items-center gap-1.5">
          <span className="text-xs text-app-text-3">Rows per page</span>
          <select
            value={pageSize}
            onChange={(e) => onPageSizeChange(Number(e.target.value))}
            className="bg-app-elevated text-app-text text-xs rounded px-1.5 py-0.5 border border-app-border focus:outline-none focus:border-app-accent cursor-pointer"
          >
            {PAGE_SIZES.map((s) => (
              <option key={s} value={s}>{s}</option>
            ))}
          </select>
        </div>

        <div className="flex items-center gap-1">
          <button
            onClick={onPrev}
            disabled={page === 0}
            className="p-0.5 rounded text-app-text-2 hover:text-app-text hover:bg-app-elevated disabled:opacity-30 disabled:cursor-not-allowed transition-colors"
          >
            <ChevronLeft size={14} />
          </button>
          <span className="text-xs text-app-text-2 min-w-[60px] text-center font-tabular">
            {loadingMore ? (
              <Loader2 size={12} className="inline animate-spin" />
            ) : (
              `${page + 1} / ${totalPages}${hasMore ? '+' : ''}`
            )}
          </span>
          <button
            onClick={onNext}
            disabled={onLastFetchedPage && !canLoadMore}
            className="p-0.5 rounded text-app-text-2 hover:text-app-text hover:bg-app-elevated disabled:opacity-30 disabled:cursor-not-allowed transition-colors"
          >
            <ChevronRight size={14} />
          </button>
        </div>
      </div>
    </div>
  )
}
