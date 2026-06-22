import { X } from 'lucide-react'

const DEFAULT_COL_WIDTH = 160

interface FilterSortBarProps {
  columns: string[]
  colWidths: Record<string, number>
  colFilters: Record<string, string>
  activeFilterCount: number
  onFilterChange: (col: string, value: string) => void
  onClear: () => void
}

export default function FilterSortBar({
  columns, colWidths, colFilters, activeFilterCount, onFilterChange, onClear,
}: FilterSortBarProps) {
  return (
    <div className="flex items-center gap-1 px-2 py-1.5 border-b border-app-border bg-app-elevated/40 shrink-0 overflow-x-auto">
      {columns.map((col) => (
        <div key={col} className="flex items-center shrink-0" style={{ width: colWidths[col] ?? DEFAULT_COL_WIDTH }}>
          <input
            type="text"
            value={colFilters[col] ?? ''}
            onChange={(e) => onFilterChange(col, e.target.value)}
            placeholder={col}
            className="w-full bg-app-surface border border-app-border rounded px-2 py-0.5 text-[11px] text-app-text placeholder-app-text-3 focus:outline-none focus:border-app-accent transition-colors"
          />
        </div>
      ))}
      {activeFilterCount > 0 && (
        <button
          onClick={onClear}
          className="shrink-0 flex items-center gap-1 text-[11px] px-2 py-0.5 rounded text-app-text-2 hover:text-app-text hover:bg-app-elevated transition-colors border border-app-border"
        >
          <X size={10} />
          Clear
        </button>
      )}
    </div>
  )
}
