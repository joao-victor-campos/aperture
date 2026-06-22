import { useEffect, useLayoutEffect, useRef, useState } from 'react'
import { createPortal } from 'react-dom'
import { Plus, ChevronDown, Trash2, Pencil } from 'lucide-react'
import { useConnectionStore } from '../../store/connectionStore'
import { useQueryStore } from '../../store/queryStore'
import type { Connection } from '@shared/types'
import StatusDot from './StatusDot'
import { connectionLabel, engineAccent, engineColor } from '../../lib/connectionMeta'

interface ConnectionMenuProps {
  onAddConnection: () => void
  onEditConnection: (conn: Connection) => void
}

export default function ConnectionMenu({ onAddConnection, onEditConnection }: ConnectionMenuProps) {
  const { connections, activeConnectionId, setActive, remove, statuses } = useConnectionStore()
  const [open, setOpen] = useState(false)
  const [deletingId, setDeletingId] = useState<string | null>(null)
  const [confirmDeleteId, setConfirmDeleteId] = useState<string | null>(null)
  const confirmTimeoutRef = useRef<ReturnType<typeof setTimeout> | null>(null)
  const triggerRef = useRef<HTMLButtonElement>(null)
  const menuRef = useRef<HTMLDivElement>(null)
  const [menuStyle, setMenuStyle] = useState<{ top: number; left: number }>({ top: 0, left: 0 })

  const activeConn = connections.find((c) => c.id === activeConnectionId)

  useLayoutEffect(() => {
    if (open && triggerRef.current) {
      const r = triggerRef.current.getBoundingClientRect()
      setMenuStyle({ top: r.bottom + 4, left: r.left })
    }
  }, [open])

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

  const engineLabel = activeConn ? (activeConn.engine ?? 'bigquery') : null
  const engineColorClass = engineLabel ? engineColor(engineLabel) : 'text-app-text'

  return (
    <>
      {connections.length > 0 && (
        <button
          ref={triggerRef}
          onClick={() => setOpen((v) => !v)}
          style={{ WebkitAppRegion: 'no-drag' } as React.CSSProperties}
          className="flex items-center gap-1.5 px-2 py-1 rounded-md text-ui hover:bg-app-elevated transition-colors max-w-72"
        >
          {activeConn && <StatusDot status={statuses[activeConn.id] ?? 'unknown'} />}
          {activeConn ? (
            <>
              <span className={`font-semibold truncate ${engineColorClass}`}>{engineLabel}</span>
              <span className="text-app-text-3">/</span>
              <span className="text-app-text truncate">{activeConn.name}</span>
            </>
          ) : (
            <span className="text-app-text-2">Select connection</span>
          )}
          <ChevronDown size={11} className="shrink-0 text-app-text-3" />
        </button>
      )}

      <button
        onClick={onAddConnection}
        title="Add connection"
        style={{ WebkitAppRegion: 'no-drag' } as React.CSSProperties}
        className="flex items-center justify-center w-6 h-6 rounded-md text-app-text-3 hover:text-app-text hover:bg-app-elevated transition-colors"
      >
        <Plus size={13} />
      </button>

      {open && createPortal(
        <div
          ref={menuRef}
          className="fixed z-[9999] bg-app-surface border border-app-border rounded-lg shadow-xl py-1 min-w-64"
          style={{ top: menuStyle.top, left: menuStyle.left, WebkitAppRegion: 'no-drag' } as React.CSSProperties}
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
                  const qs = useQueryStore.getState()
                  const focusedTabId = qs.activeByGroup[qs.focusedGroup]
                  if (focusedTabId) qs.setTabConnection(focusedTabId, c.id)
                  setActive(c.id)
                  setOpen(false)
                }
              }}
            >
              <StatusDot status={statuses[c.id] ?? 'unknown'} />
              <div className="flex-1 min-w-0 px-1">
                <div className="text-xs font-medium text-app-text truncate">{c.name}</div>
                <div className="text-[10px] text-app-text-3 truncate font-tabular">
                  <span className={engineAccent(c.engine ?? 'bigquery')}>{c.engine ?? 'bigquery'}</span>
                  {' · '}{connectionLabel(c)}
                </div>
              </div>
              {confirmDeleteId === c.id ? (
                <div className="flex items-center gap-1 shrink-0" onClick={(e) => e.stopPropagation()}>
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
                    className="text-[10px] px-1.5 py-0.5 rounded bg-app-err-subtle text-app-err hover:bg-app-err-subtle/80 transition-colors disabled:opacity-40"
                  >
                    Yes
                  </button>
                </div>
              ) : (
                <div className="opacity-0 group-hover:opacity-100 flex items-center gap-0.5 shrink-0 transition-opacity">
                  <button
                    onClick={(e) => { e.stopPropagation(); setOpen(false); onEditConnection(c) }}
                    title="Edit connection"
                    className="p-1.5 rounded text-app-text-3 hover:text-app-text hover:bg-app-elevated/60 transition-all"
                  >
                    <Pencil size={11} />
                  </button>
                  <button
                    onClick={(e) => requestDelete(e, c.id)}
                    title="Delete connection"
                    className="p-1.5 rounded text-app-text-3 hover:text-app-err hover:bg-app-err-subtle/60 transition-all"
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
    </>
  )
}
