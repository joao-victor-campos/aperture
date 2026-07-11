import { useEffect, useState, useMemo } from 'react'
import { Trash2, Clock, Search, X } from 'lucide-react'
import type { HistoryEntry } from '@shared/types'
import { useQueryStore } from '../../store/queryStore'
import { useConnectionStore } from '../../store/connectionStore'
import { useHistoryStore } from '../../store/historyStore'
import { filterHistory } from '../../lib/filterHistory'

export default function HistoryPanel() {
  const { entries, loaded, reload, clearAll } = useHistoryStore()
  const [clearing, setClearing] = useState(false)
  const [search, setSearch] = useState('')
  const visible = useMemo(() => filterHistory(entries, search), [entries, search])
  const { openTab } = useQueryStore()
  const { activeConnectionId } = useConnectionStore()

  useEffect(() => {
    // Always pull fresh when the panel mounts (covers post-query-run cases)
    reload()
  }, [reload])

  const handleClear = async () => {
    setClearing(true)
    await clearAll()
    setClearing(false)
  }

  const handleOpen = (entry: HistoryEntry) => {
    openTab({
      sql: entry.sql,
      connectionId: entry.connectionId ?? activeConnectionId ?? undefined,
      title: truncate(entry.sql, 30),
    })
  }

  if (!loaded) {
    return <div className="p-4 text-xs text-app-text-3 animate-pulse">Loading history…</div>
  }

  return (
    <div className="flex flex-col h-full">
      {/* Header */}
      <div className="flex items-center justify-between px-3 py-2 border-b border-app-border shrink-0">
        <span className="app-section-label">
          {entries.length === 0
            ? 'No history yet'
            : search.trim()
              ? `${visible.length} / ${entries.length} queries`
              : `${entries.length} queries`}
        </span>
        {entries.length > 0 && (
          <button
            onClick={handleClear}
            disabled={clearing}
            title="Clear all history"
            className="p-1 rounded text-app-text-3 hover:text-app-err hover:bg-app-err-subtle/40 transition-all disabled:opacity-40"
          >
            <Trash2 size={12} />
          </button>
        )}
      </div>

      {/* Search */}
      {entries.length > 0 && (
        <div className="flex items-center gap-2 px-3 py-2 border-b border-app-border shrink-0">
          <Search size={12} className="text-app-text-3 shrink-0" />
          <input
            value={search}
            onChange={(e) => setSearch(e.target.value)}
            placeholder="Search history…"
            className="flex-1 bg-transparent text-xs text-app-text placeholder-app-text-3 focus:outline-none"
          />
          {search && (
            <button
              onClick={() => setSearch('')}
              className="text-app-text-3 hover:text-app-text transition-colors"
            >
              <X size={12} />
            </button>
          )}
        </div>
      )}

      {/* Entry list */}
      <div className="flex-1 overflow-y-auto">
        {entries.length === 0 ? (
          <div className="p-4 text-xs text-app-text-3 text-center">
            Queries you run will appear here
          </div>
        ) : visible.length === 0 ? (
          <div className="p-4 text-xs text-app-text-3 text-center">
            No queries match.
          </div>
        ) : (
          visible.map((entry) => (
            <button
              key={entry.id}
              onClick={() => handleOpen(entry)}
              className="w-full text-left px-3 py-2.5 border-b border-app-border/40 hover:bg-app-elevated/40 transition-colors group"
            >
              {/* Meta row */}
              <div className="flex items-center gap-2 mb-1">
                <Clock size={10} className="text-app-text-3 shrink-0" />
                <span className="text-[10px] text-app-text-3">{timeAgo(entry.executedAt)}</span>
                <span className="text-[10px] text-app-text-3">·</span>
                <span className="text-[10px] text-app-text-3 truncate">{entry.connectionName}</span>
                <span className="ml-auto text-[10px] text-app-text-3 shrink-0">
                  {entry.rowCount.toLocaleString()} rows · {entry.durationMs}ms
                </span>
              </div>
              {/* SQL preview */}
              <p className="text-xs text-app-text font-mono truncate leading-snug">
                {entry.sql.replace(/\s+/g, ' ').trim()}
              </p>
            </button>
          ))
        )}
      </div>
    </div>
  )
}

function timeAgo(iso: string): string {
  const ms = Date.now() - new Date(iso).getTime()
  const s = Math.floor(ms / 1000)
  if (s < 60) return 'just now'
  const m = Math.floor(s / 60)
  if (m < 60) return `${m}m ago`
  const h = Math.floor(m / 60)
  if (h < 24) return `${h}h ago`
  const d = Math.floor(h / 24)
  return `${d}d ago`
}

function truncate(s: string, max: number): string {
  const clean = s.replace(/\s+/g, ' ').trim()
  return clean.length <= max ? clean : clean.slice(0, max) + '…'
}
