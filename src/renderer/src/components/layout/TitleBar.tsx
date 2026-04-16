import { useEffect, useRef, useState } from 'react'
import { Sun, Moon, Plus, ChevronDown, Trash2 } from 'lucide-react'
import { useConnectionStore } from '../../store/connectionStore'
import ApertureIcon from '../ApertureIcon'
import type { BigQueryConnection, Connection, PostgresConnection, SnowflakeConnection } from '@shared/types'

interface TitleBarProps {
  onAddConnection: () => void
  isDark: boolean
  onToggleTheme: () => void
}

function connectionLabel(c: Connection): string {
  const engine = c.engine ?? 'bigquery'
  if (engine === 'bigquery') return (c as BigQueryConnection).projectId
  if (engine === 'snowflake') return (c as SnowflakeConnection).account
  return (c as PostgresConnection).database ?? (c as PostgresConnection).host
}

export default function TitleBar({ onAddConnection, isDark, onToggleTheme }: TitleBarProps) {
  const { connections, activeConnectionId, setActive, remove } = useConnectionStore()
  const [open, setOpen] = useState(false)
  const [deletingId, setDeletingId] = useState<string | null>(null)
  const dropdownRef = useRef<HTMLDivElement>(null)

  const activeConn = connections.find((c) => c.id === activeConnectionId)

  // Close dropdown on outside click
  useEffect(() => {
    if (!open) return
    const handler = (e: MouseEvent) => {
      if (dropdownRef.current && !dropdownRef.current.contains(e.target as Node)) {
        setOpen(false)
      }
    }
    document.addEventListener('mousedown', handler)
    return () => document.removeEventListener('mousedown', handler)
  }, [open])

  const handleDelete = async (e: React.MouseEvent, id: string) => {
    e.stopPropagation()
    setDeletingId(id)
    await remove(id)
    setDeletingId(null)
  }

  return (
    <div
      className="h-12 flex items-center px-4 gap-4 border-b border-app-border bg-app-surface shrink-0"
      style={{ WebkitAppRegion: 'drag' } as React.CSSProperties}
    >
      {/* Space for macOS traffic lights */}
      <div className="w-20 shrink-0" />

      <div className="flex items-center gap-2 shrink-0">
        <ApertureIcon size={18} />
        <span className="text-xs font-semibold text-app-text tracking-widest uppercase">
          Aperture
        </span>
      </div>

      <div
        className="flex items-center gap-2 ml-2 flex-1"
        style={{ WebkitAppRegion: 'no-drag' } as React.CSSProperties}
      >
        {/* Connection picker */}
        {connections.length > 0 && (
          <div ref={dropdownRef} className="relative">
            <button
              onClick={() => setOpen((v) => !v)}
              className="flex items-center gap-1.5 text-xs px-2.5 py-1 rounded-md bg-app-elevated border border-app-border text-app-text hover:bg-app-elevated/80 transition-colors max-w-56"
            >
              <span className="truncate">
                {activeConn ? `${activeConn.name}` : 'Select connection'}
              </span>
              <ChevronDown size={11} className="shrink-0 text-app-text-3" />
            </button>

            {open && (
              <div className="absolute top-full left-0 mt-1 z-50 bg-app-surface border border-app-border rounded-lg shadow-xl py-1 min-w-64" style={{ WebkitAppRegion: 'no-drag' } as React.CSSProperties}>
                {connections.map((c) => (
                  <div
                    key={c.id}
                    className={`group flex items-center gap-1 px-2 py-1.5 cursor-pointer transition-colors ${
                      c.id === activeConnectionId
                        ? 'bg-app-accent-subtle'
                        : 'hover:bg-app-elevated'
                    }`}
                    onClick={() => { setActive(c.id); setOpen(false) }}
                  >
                    <div className="flex-1 min-w-0 px-1">
                      <div className="text-xs font-medium text-app-text truncate">{c.name}</div>
                      <div className="text-[10px] text-app-text-3 truncate">
                        {c.engine ?? 'bigquery'} · {connectionLabel(c)}
                      </div>
                    </div>
                    <button
                      onClick={(e) => handleDelete(e, c.id)}
                      disabled={deletingId === c.id}
                      title="Delete connection"
                      className="opacity-0 group-hover:opacity-100 hover:opacity-100 p-1.5 rounded text-app-text-3 hover:text-red-400 hover:bg-red-500/10 transition-all disabled:opacity-40 shrink-0"
                    >
                      <Trash2 size={12} />
                    </button>
                  </div>
                ))}
              </div>
            )}
          </div>
        )}

        <button
          onClick={onAddConnection}
          className="flex items-center gap-1 text-xs px-2.5 py-1 rounded-md bg-app-elevated hover:bg-app-elevated/80 text-app-text border border-app-border transition-colors"
        >
          <Plus size={12} />
          Connection
        </button>

        {/* Spacer */}
        <div className="flex-1" />

        {/* Theme toggle */}
        <button
          onClick={onToggleTheme}
          title={isDark ? 'Switch to light theme' : 'Switch to dark theme'}
          className="p-1.5 rounded-md text-app-text-2 hover:text-app-text hover:bg-app-elevated transition-colors"
        >
          {isDark ? <Sun size={14} /> : <Moon size={14} />}
        </button>
      </div>
    </div>
  )
}
