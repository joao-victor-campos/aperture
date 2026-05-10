import { useEffect, useLayoutEffect, useRef, useState } from 'react'
import { createPortal } from 'react-dom'
import { Sun, Moon, Plus, ChevronDown, Trash2, Pencil } from 'lucide-react'
import { useConnectionStore } from '../../store/connectionStore'
import type { ConnectionStatus } from '../../store/connectionStore'
import ApertureIcon from '../ApertureIcon'
import type { BigQueryConnection, Connection, PostgresConnection, SnowflakeConnection } from '@shared/types'

interface TitleBarProps {
  onAddConnection: () => void
  onEditConnection: (conn: Connection) => void
  isDark: boolean
  onToggleTheme: () => void
}

function connectionLabel(c: Connection): string {
  const engine = c.engine ?? 'bigquery'
  if (engine === 'bigquery') return (c as BigQueryConnection).projectId
  if (engine === 'snowflake') return (c as SnowflakeConnection).account
  return (c as PostgresConnection).database ?? (c as PostgresConnection).host
}

export default function TitleBar({ onAddConnection, onEditConnection, isDark, onToggleTheme }: TitleBarProps) {
  const { connections, activeConnectionId, setActive, remove, statuses } = useConnectionStore()
  const [open, setOpen] = useState(false)
  const [deletingId, setDeletingId] = useState<string | null>(null)
  const [confirmDeleteId, setConfirmDeleteId] = useState<string | null>(null)
  const confirmTimeoutRef = useRef<ReturnType<typeof setTimeout> | null>(null)
  const triggerRef = useRef<HTMLButtonElement>(null)
  const menuRef = useRef<HTMLDivElement>(null)

  // Position of the portal dropdown, computed when opened
  const [menuStyle, setMenuStyle] = useState<{ top: number; left: number }>({ top: 0, left: 0 })

  const activeConn = connections.find((c) => c.id === activeConnectionId)

  // Compute dropdown position whenever it opens
  useLayoutEffect(() => {
    if (open && triggerRef.current) {
      const r = triggerRef.current.getBoundingClientRect()
      setMenuStyle({ top: r.bottom + 4, left: r.left })
    }
  }, [open])

  // Close on outside click
  useEffect(() => {
    if (!open) return
    const handler = (e: MouseEvent) => {
      const target = e.target as Node
      if (
        triggerRef.current && !triggerRef.current.contains(target) &&
        menuRef.current && !menuRef.current.contains(target)
      ) {
        setOpen(false)
        clearPendingConfirm()
      }
    }
    document.addEventListener('mousedown', handler)
    return () => document.removeEventListener('mousedown', handler)
  }, [open])

  // Clean up confirm timeout on unmount
  useEffect(() => () => { if (confirmTimeoutRef.current) clearTimeout(confirmTimeoutRef.current) }, [])

  const clearPendingConfirm = () => {
    if (confirmTimeoutRef.current) clearTimeout(confirmTimeoutRef.current)
    setConfirmDeleteId(null)
  }

  const requestDelete = (e: React.MouseEvent, id: string) => {
    e.stopPropagation()
    if (confirmTimeoutRef.current) clearTimeout(confirmTimeoutRef.current)
    setConfirmDeleteId(id)
    confirmTimeoutRef.current = setTimeout(() => setConfirmDeleteId(null), 3000)
  }

  const cancelDelete = (e: React.MouseEvent) => {
    e.stopPropagation()
    clearPendingConfirm()
  }

  const confirmDelete = async (e: React.MouseEvent, id: string) => {
    e.stopPropagation()
    clearPendingConfirm()
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

      <div className="flex items-center gap-2 ml-2 flex-1">
        {/* Connection picker trigger */}
        {connections.length > 0 && (
          <button
            ref={triggerRef}
            onClick={() => setOpen((v) => !v)}
            style={{ WebkitAppRegion: 'no-drag' } as React.CSSProperties}
            className="flex items-center gap-1.5 text-xs px-2.5 py-1 rounded-md bg-app-elevated border border-app-border text-app-text hover:bg-app-elevated/80 transition-colors max-w-56"
          >
            {activeConn && <StatusDot status={statuses[activeConn.id] ?? 'unknown'} />}
            <span className="truncate">
              {activeConn ? activeConn.name : 'Select connection'}
            </span>
            <ChevronDown size={11} className="shrink-0 text-app-text-3" />
          </button>
        )}

        <button
          onClick={onAddConnection}
          style={{ WebkitAppRegion: 'no-drag' } as React.CSSProperties}
          className="flex items-center gap-1 text-xs px-2.5 py-1 rounded-md bg-app-elevated hover:bg-app-elevated/80 text-app-text border border-app-border transition-colors"
        >
          <Plus size={12} />
          Connection
        </button>

        {/* Spacer — inherits drag from parent, acts as the main drag handle */}
        <div className="flex-1" />

        {/* Theme toggle */}
        <button
          onClick={onToggleTheme}
          title={isDark ? 'Switch to light theme' : 'Switch to dark theme'}
          style={{ WebkitAppRegion: 'no-drag' } as React.CSSProperties}
          className="p-1.5 rounded-md text-app-text-2 hover:text-app-text hover:bg-app-elevated transition-colors"
        >
          {isDark ? <Sun size={14} /> : <Moon size={14} />}
        </button>
      </div>

      {/* Dropdown rendered via portal so it sits outside the drag region entirely */}
      {open && createPortal(
        <div
          ref={menuRef}
          className="fixed z-[9999] bg-app-surface border border-app-border rounded-lg shadow-xl py-1 min-w-64"
          style={{
            top: menuStyle.top,
            left: menuStyle.left,
            WebkitAppRegion: 'no-drag',
          } as React.CSSProperties}
        >
          {connections.map((c) => (
            <div
              key={c.id}
              className={`group flex items-center gap-1 px-2 py-1.5 cursor-pointer transition-colors ${
                c.id === activeConnectionId ? 'bg-app-accent-subtle' : 'hover:bg-app-elevated'
              }`}
              style={{ WebkitAppRegion: 'no-drag' } as React.CSSProperties}
              onClick={() => {
                if (confirmDeleteId !== c.id) {
                  setActive(c.id)
                  setOpen(false)
                }
              }}
            >
              {/* Health badge dot */}
              <StatusDot status={statuses[c.id] ?? 'unknown'} />

              <div className="flex-1 min-w-0 px-1">
                <div className="text-xs font-medium text-app-text truncate">{c.name}</div>
                <div className="text-[10px] text-app-text-3 truncate">
                  {c.engine ?? 'bigquery'} · {connectionLabel(c)}
                </div>
              </div>

              {confirmDeleteId === c.id ? (
                /* Inline delete confirmation */
                <div
                  className="flex items-center gap-1 shrink-0"
                  onClick={(e) => e.stopPropagation()}
                >
                  <span className="text-[10px] text-app-text-3 mr-0.5">Delete?</span>
                  <button
                    onClick={cancelDelete}
                    className="text-[10px] px-1.5 py-0.5 rounded text-app-text-2 hover:text-app-text transition-colors"
                  >
                    No
                  </button>
                  <button
                    onClick={(e) => confirmDelete(e, c.id)}
                    disabled={deletingId === c.id}
                    className="text-[10px] px-1.5 py-0.5 rounded bg-red-500/20 text-red-400 hover:bg-red-500/30 transition-colors disabled:opacity-40"
                  >
                    Yes
                  </button>
                </div>
              ) : (
                /* Edit + delete action buttons */
                <div className="opacity-0 group-hover:opacity-100 flex items-center gap-0.5 shrink-0 transition-opacity">
                  <button
                    onClick={(e) => {
                      e.stopPropagation()
                      setOpen(false)
                      onEditConnection(c)
                    }}
                    title="Edit connection"
                    className="p-1.5 rounded text-app-text-3 hover:text-app-text hover:bg-app-elevated/60 transition-all"
                  >
                    <Pencil size={11} />
                  </button>
                  <button
                    onClick={(e) => requestDelete(e, c.id)}
                    title="Delete connection"
                    className="p-1.5 rounded text-app-text-3 hover:text-red-400 hover:bg-red-500/10 transition-all"
                  >
                    <Trash2 size={12} />
                  </button>
                </div>
              )}
            </div>
          ))}
        </div>,
        document.body
      )}
    </div>
  )
}

function StatusDot({ status }: { status: ConnectionStatus }) {
  const color =
    status === 'ok'
      ? 'bg-emerald-500'
      : status === 'error'
      ? 'bg-red-500'
      : 'bg-app-text-3'
  return <div className={`w-1.5 h-1.5 rounded-full shrink-0 ${color}`} />
}
