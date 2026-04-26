import { useEffect, useState } from 'react'
import { Trash2, Clock } from 'lucide-react'
import { CHANNELS } from '@shared/ipc'
import type { HistoryEntry } from '@shared/types'
import { useQueryStore } from '../../store/queryStore'
import { useConnectionStore } from '../../store/connectionStore'

export default function HistoryPanel() {
  const [entries, setEntries] = useState<HistoryEntry[]>([])
  const [loading, setLoading] = useState(true)
  const [clearing, setClearing] = useState(false)
  const { openTab } = useQueryStore()
  const { activeConnectionId } = useConnectionStore()

  useEffect(() => {
    loadHistory()
  }, [])

  const loadHistory = async () => {
    setLoading(true)
    try {
      const data = await window.api.invoke(CHANNELS.HISTORY_LIST)
      setEntries(data)
    } finally {
      setLoading(false)
    }
  }

  const handleClear = async () => {
    setClearing(true)
    await window.api.invoke(CHANNELS.HISTORY_CLEAR)
    setEntries([])
    setClearing(false)
  }

  const handleOpen = (entry: HistoryEntry) => {
    openTab({
      sql: entry.sql,
      connectionId: entry.connectionId ?? activeConnectionId ?? undefined,
      title: truncate(entry.sql, 30),
    })
  }

  if (loading) {
    return <div className="p-4 text-xs text-app-text-3 animate-pulse">Loading history…</div>
  }

  return (
    <div className="flex flex-col h-full">
      {/* Header */}
      <div className="flex items-center justify-between px-3 py-2 border-b border-app-border shrink-0">
        <span className="text-[10px] uppercase tracking-widest text-app-text-3 font-medium">
          {entries.length > 0 ? `${entries.length} queries` : 'No history yet'}
        </span>
        {entries.length > 0 && (
          <button
            onClick={handleClear}
            disabled={clearing}
            title="Clear all history"
            className="p-1 rounded text-app-text-3 hover:text-red-400 hover:bg-red-500/10 transition-all disabled:opacity-40"
          >
            <Trash2 size={12} />
          </button>
        )}
      </div>

      {/* Entry list */}
      <div className="flex-1 overflow-y-auto">
        {entries.length === 0 ? (
          <div className="p-4 text-xs text-app-text-3 text-center">
            Queries you run will appear here
          </div>
        ) : (
          entries.map((entry) => (
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
