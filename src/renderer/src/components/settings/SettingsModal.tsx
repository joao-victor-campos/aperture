import { useEffect, useRef, useState } from 'react'
import { createPortal } from 'react-dom'
import { X, Plus, Trash2, Palette } from 'lucide-react'
import { useThemeStore } from '../../store/themeStore'

interface SettingsModalProps {
  open: boolean
  onClose: () => void
}

export default function SettingsModal({ open, onClose }: SettingsModalProps) {
  const { themes, activeThemeId, importFromFile, remove, setActive } = useThemeStore()
  const [importError, setImportError] = useState<string | null>(null)
  const [isImporting, setIsImporting] = useState(false)
  const [confirmDeleteId, setConfirmDeleteId] = useState<string | null>(null)
  const confirmTimeoutRef = useRef<ReturnType<typeof setTimeout> | null>(null)

  // Close on Escape
  useEffect(() => {
    if (!open) return
    const onKey = (e: KeyboardEvent) => {
      if (e.key === 'Escape') onClose()
    }
    window.addEventListener('keydown', onKey)
    return () => window.removeEventListener('keydown', onKey)
  }, [open, onClose])

  // Clean up confirm timeout on unmount
  useEffect(() => () => {
    if (confirmTimeoutRef.current) clearTimeout(confirmTimeoutRef.current)
  }, [])

  // Reset transient state when the modal closes (component stays mounted).
  useEffect(() => {
    if (!open) {
      setImportError(null)
      setConfirmDeleteId(null)
      if (confirmTimeoutRef.current) {
        clearTimeout(confirmTimeoutRef.current)
        confirmTimeoutRef.current = null
      }
    }
  }, [open])

  if (!open) return null

  const handleImport = async () => {
    setIsImporting(true)
    setImportError(null)
    const result = await importFromFile()
    setIsImporting(false)
    if (result && 'error' in result) {
      setImportError(result.error)
    }
  }

  const requestDelete = (id: string) => {
    if (confirmTimeoutRef.current) clearTimeout(confirmTimeoutRef.current)
    setConfirmDeleteId(id)
    confirmTimeoutRef.current = setTimeout(() => setConfirmDeleteId(null), 3000)
  }

  const confirmDelete = async (id: string) => {
    if (confirmTimeoutRef.current) clearTimeout(confirmTimeoutRef.current)
    setConfirmDeleteId(null)
    await remove(id)
  }

  return createPortal(
    <div
      className="fixed inset-0 bg-black/40 z-[9999] flex items-center justify-center"
      onClick={onClose}
    >
      <div
        onClick={(e) => e.stopPropagation()}
        role="dialog"
        aria-modal="true"
        aria-labelledby="settings-modal-title"
        className="bg-app-surface border border-app-border rounded-xl shadow-app-card w-[640px] max-h-[80vh] flex overflow-hidden"
      >
        {/* Left nav */}
        <div className="w-[140px] bg-app-sidebar border-r border-app-border p-3 shrink-0">
          <div className="app-section-label mb-3">Settings</div>
          <button className="w-full flex items-center gap-2 px-2 py-1.5 rounded-md text-ui bg-app-elevated text-app-accent-text font-semibold">
            <Palette size={13} />
            Themes
          </button>
        </div>

        {/* Content */}
        <div className="flex-1 flex flex-col min-w-0">
          <div className="flex items-center justify-between px-4 py-3 border-b border-app-border">
            <div id="settings-modal-title" className="text-ui-md font-semibold text-app-text">Theme Library</div>
            <div className="flex items-center gap-2">
              <button
                onClick={handleImport}
                disabled={isImporting}
                className="flex items-center gap-1.5 px-2.5 py-1 bg-app-accent hover:bg-app-accent-hover disabled:opacity-50 text-white rounded-md text-ui font-medium transition-colors"
              >
                <Plus size={12} />
                {isImporting ? 'Importing…' : 'Import…'}
              </button>
              <button
                onClick={onClose}
                aria-label="Close settings"
                className="p-1.5 rounded-md text-app-text-3 hover:text-app-text hover:bg-app-elevated transition-colors"
              >
                <X size={14} />
              </button>
            </div>
          </div>

          {importError && (
            <div className="mx-4 mt-3 px-3 py-2 bg-app-err-subtle text-app-err rounded-md text-ui">
              {importError}
            </div>
          )}

          <div className="p-4 overflow-y-auto grid grid-cols-3 gap-3">
            {/* Built-in default — always first, not deletable */}
            <ThemeCard
              builtin
              active={activeThemeId === null}
              swatchColors={['#FAF7F1', '#C8633B', '#2E8B6A', '#2E6FB8']}
              name="Aperture Default"
              author="built-in"
              onClick={() => setActive(null)}
            />

            {themes.map((theme) => (
              <ThemeCard
                key={theme.id}
                active={activeThemeId === theme.id}
                swatchColors={[
                  `#${theme.base.base00}`,
                  `#${theme.base.base09}`,
                  `#${theme.base.base0b}`,
                  `#${theme.base.base0d}`,
                ]}
                name={theme.name}
                author={theme.author ?? 'imported'}
                onClick={() => setActive(theme.id)}
                onDelete={() => requestDelete(theme.id)}
                confirmingDelete={confirmDeleteId === theme.id}
                onConfirmDelete={() => confirmDelete(theme.id)}
                onCancelDelete={() => setConfirmDeleteId(null)}
              />
            ))}

            {/* Dashed-border import placeholder */}
            <button
              onClick={handleImport}
              disabled={isImporting}
              className="border border-dashed border-app-border rounded-lg p-3 flex flex-col items-center justify-center gap-1.5 text-app-text-3 hover:text-app-text hover:border-app-border-2 transition-colors disabled:opacity-50"
            >
              <Plus size={18} />
              <span className="text-ui">Import theme</span>
            </button>
          </div>
        </div>
      </div>
    </div>,
    document.body
  )
}

interface ThemeCardProps {
  active: boolean
  builtin?: boolean
  swatchColors: string[]
  name: string
  author: string
  onClick: () => void
  onDelete?: () => void
  confirmingDelete?: boolean
  onConfirmDelete?: () => void
  onCancelDelete?: () => void
}

function ThemeCard({
  active,
  builtin,
  swatchColors,
  name,
  author,
  onClick,
  onDelete,
  confirmingDelete,
  onConfirmDelete,
  onCancelDelete,
}: ThemeCardProps) {
  return (
    <div className="relative group">
      <button
        type="button"
        onClick={onClick}
        aria-pressed={active}
        className={`group relative cursor-pointer rounded-lg p-3 transition-colors text-left w-full ${
          active
            ? 'bg-app-accent-subtle border-2 border-app-accent'
            : 'bg-app-elevated border border-app-border hover:border-app-border-2'
        }`}
      >
        <div className="flex gap-1 mb-2">
          {swatchColors.map((c, i) => (
            <div
              key={i}
              className="w-5 h-5 rounded"
              style={{ backgroundColor: c, border: '1px solid rgba(0,0,0,0.05)' }}
            />
          ))}
        </div>
        <div className="text-ui font-semibold text-app-text truncate">{name}</div>
        <div className="text-ui-xs text-app-text-3 truncate">{author}</div>

        {active && (
          <div className="absolute top-2 right-2 app-dot" style={{ backgroundColor: 'rgb(var(--c-accent))' }} />
        )}
      </button>

      {!builtin && onDelete && (
        <>
          {confirmingDelete ? (
            <div className="absolute top-2 right-2 flex items-center gap-1 bg-app-surface rounded px-1 py-0.5 shadow-app-card">
              <button
                type="button"
                onClick={onCancelDelete}
                className="text-ui-xs px-1.5 py-0.5 text-app-text-2 hover:text-app-text"
              >
                No
              </button>
              <button
                type="button"
                onClick={onConfirmDelete}
                className="text-ui-xs px-1.5 py-0.5 rounded bg-app-err-subtle text-app-err"
              >
                Yes
              </button>
            </div>
          ) : (
            <button
              type="button"
              onClick={onDelete}
              className="absolute top-2 right-2 opacity-0 group-hover:opacity-100 p-1 rounded text-app-text-3 hover:text-app-err hover:bg-app-err-subtle/60 transition-all focus:opacity-100"
              title="Delete theme"
              aria-label={`Delete ${name}`}
            >
              <Trash2 size={11} />
            </button>
          )}
        </>
      )}
    </div>
  )
}
