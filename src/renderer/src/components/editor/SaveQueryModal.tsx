import { useState, useEffect, useRef } from 'react'
import { X, BookMarked } from 'lucide-react'
import { useQueryStore } from '../../store/queryStore'
import { useSavedQueryStore } from '../../store/savedQueryStore'

interface SaveQueryModalProps {
  tabId: string
  onClose: () => void
}

export default function SaveQueryModal({ tabId, onClose }: SaveQueryModalProps) {
  const tab = useQueryStore((s) => s.tabs.find((t) => t.id === tabId))
  const { queries, folders, saveQuery } = useSavedQueryStore()
  const [name, setName] = useState(tab?.title ?? 'Untitled')
  const [folderId, setFolderId] = useState<string | null>(null)
  const [saving, setSaving] = useState(false)
  const inputRef = useRef<HTMLInputElement>(null)

  useEffect(() => {
    inputRef.current?.focus()
    inputRef.current?.select()
  }, [])

  if (!tab) return null

  const handleSave = async () => {
    if (!name.trim()) return
    setSaving(true)
    try {
      const saved = await saveQuery({
        title: name.trim(),
        sql: tab.sql,
        connectionId: tab.connectionId,
        folderId,
      })
      // Update the tab with the saved query info
      useQueryStore.setState((s) => ({
        tabs: s.tabs.map((t) =>
          t.id === tabId ? { ...t, title: saved.title, savedQueryId: saved.id } : t
        ),
      }))
      onClose()
    } finally {
      setSaving(false)
    }
  }

  const handleKeyDown = (e: React.KeyboardEvent) => {
    if (e.key === 'Enter' && !saving) handleSave()
    if (e.key === 'Escape') onClose()
  }

  // Check for duplicate name warning
  const isDuplicate = queries.some(
    (q) => q.title.toLowerCase() === name.trim().toLowerCase()
  )

  return (
    <div
      className="fixed inset-0 z-50 flex items-center justify-center bg-black/50"
      onClick={(e) => { if (e.target === e.currentTarget) onClose() }}
    >
      <div
        className="bg-app-surface border border-app-border rounded-lg shadow-2xl w-[400px] p-5"
        onKeyDown={handleKeyDown}
      >
        <div className="flex items-center justify-between mb-4">
          <div className="flex items-center gap-2 text-app-text">
            <BookMarked size={15} className="text-app-accent" />
            <span className="text-sm font-medium">Save Query</span>
          </div>
          <button
            onClick={onClose}
            className="text-app-text-3 hover:text-app-text transition-colors"
          >
            <X size={15} />
          </button>
        </div>

        <div className="space-y-3">
          <div>
            <label className="block text-[11px] uppercase tracking-wide text-app-text-3 mb-1.5">
              Name
            </label>
            <input
              ref={inputRef}
              type="text"
              value={name}
              onChange={(e) => setName(e.target.value)}
              placeholder="Query name…"
              className="w-full px-3 py-2 text-sm bg-app-bg border border-app-border rounded text-app-text placeholder-app-text-3 focus:outline-none focus:border-app-accent transition-colors"
            />
            {isDuplicate && (
              <p className="mt-1 text-[11px] text-yellow-400">
                A saved query with this name already exists.
              </p>
            )}
          </div>

          <div>
            <label className="block text-[11px] uppercase tracking-wide text-app-text-3 mb-1.5">
              Folder <span className="normal-case text-app-text-3">(optional)</span>
            </label>
            <select
              value={folderId ?? ''}
              onChange={(e) => setFolderId(e.target.value || null)}
              className="w-full px-3 py-2 text-sm bg-app-bg border border-app-border rounded text-app-text focus:outline-none focus:border-app-accent transition-colors"
            >
              <option value="">No folder</option>
              {folders.map((f) => (
                <option key={f.id} value={f.id}>{f.name}</option>
              ))}
            </select>
          </div>
        </div>

        <div className="flex justify-end gap-2 mt-5">
          <button
            onClick={onClose}
            className="px-4 py-1.5 text-xs text-app-text-2 hover:text-app-text hover:bg-app-elevated rounded transition-colors"
          >
            Cancel
          </button>
          <button
            onClick={handleSave}
            disabled={!name.trim() || saving}
            className="px-4 py-1.5 text-xs bg-app-accent hover:bg-app-accent-hover disabled:opacity-40 text-white rounded transition-colors font-medium"
          >
            {saving ? 'Saving…' : 'Save'}
          </button>
        </div>
      </div>
    </div>
  )
}
