import { useState, useEffect, useRef } from 'react'
import TitleBar from './components/layout/TitleBar'
import Sidebar from './components/layout/Sidebar'
import Editor from './pages/Editor'
import ConnectionModal from './components/connections/ConnectionModal'
import ShortcutCheatsheet from './components/command/ShortcutCheatsheet'
import SettingsModal from './components/settings/SettingsModal'
import { useConnectionStore } from './store/connectionStore'
import { useSavedQueryStore } from './store/savedQueryStore'
import { useHistoryStore } from './store/historyStore'
import { useThemeStore } from './store/themeStore'
import type { Connection } from '@shared/types'
import type { CommandPaletteHandle } from './components/command/CommandPalette'

type ModalState = null | { mode: 'add' } | { mode: 'edit'; connection: Connection }

export default function App() {
  const [modal, setModal] = useState<ModalState>(null)
  const { connections, load } = useConnectionStore()
  const loadSavedQueries = useSavedQueryStore((s) => s.load)
  const loadHistory = useHistoryStore((s) => s.load)
  const loadThemes = useThemeStore((s) => s.load)
  const paletteRef = useRef<CommandPaletteHandle>(null)
  const [cheatsheetOpen, setCheatsheetOpen] = useState(false)
  const [settingsOpen, setSettingsOpen] = useState(false)

  useEffect(() => {
    // Eager-load every persistent store the ⌘K palette searches over,
    // plus the theme library so the active theme is applied before first paint.
    load()
    loadSavedQueries()
    loadHistory()
    loadThemes()
  }, [load, loadSavedQueries, loadHistory, loadThemes])

  // Global ⌘K — focuses the palette input
  // Global ⌘/ — toggles shortcut cheatsheet
  useEffect(() => {
    const handler = (e: KeyboardEvent) => {
      if ((e.metaKey || e.ctrlKey) && (e.key === 'k' || e.key === 'K')) {
        e.preventDefault()
        paletteRef.current?.focus()
        return
      }
      if ((e.metaKey || e.ctrlKey) && e.key === '/') {
        e.preventDefault()
        setCheatsheetOpen((v) => !v)
      }
    }
    window.addEventListener('keydown', handler)
    return () => window.removeEventListener('keydown', handler)
  }, [])

  return (
    <div className="flex flex-col h-screen bg-app-bg text-app-text">
      <TitleBar
        onAddConnection={() => setModal({ mode: 'add' })}
        onEditConnection={(conn) => setModal({ mode: 'edit', connection: conn })}
        onOpenSettings={() => setSettingsOpen(true)}
        onShowShortcuts={() => setCheatsheetOpen(true)}
        paletteRef={paletteRef}
      />
      <div className="flex flex-1 overflow-hidden">
        <Sidebar onAddConnection={() => setModal({ mode: 'add' })} />
        <main className="flex-1 overflow-hidden">
          {connections.length === 0 ? (
            <EmptyState onAddConnection={() => setModal({ mode: 'add' })} />
          ) : (
            <Editor />
          )}
        </main>
      </div>
      {modal && (
        <ConnectionModal
          onClose={() => setModal(null)}
          initialConnection={modal.mode === 'edit' ? modal.connection : undefined}
        />
      )}
      <ShortcutCheatsheet open={cheatsheetOpen} onClose={() => setCheatsheetOpen(false)} />
      <SettingsModal open={settingsOpen} onClose={() => setSettingsOpen(false)} />
    </div>
  )
}

function EmptyState({ onAddConnection }: { onAddConnection: () => void }) {
  return (
    <div className="h-full flex flex-col items-center justify-center gap-5 text-app-text-2">
      <div className="flex flex-col items-center gap-2">
        <div className="w-12 h-12 rounded-2xl bg-app-accent-subtle flex items-center justify-center">
          <svg
            width="24" height="24" viewBox="0 0 24 24"
            fill="none" stroke="currentColor" strokeWidth="1.5"
            className="text-app-accent-text"
          >
            <ellipse cx="12" cy="5" rx="9" ry="3" />
            <path d="M21 12c0 1.66-4 3-9 3s-9-1.34-9-3" />
            <path d="M3 5v14c0 1.66 4 3 9 3s9-1.34 9-3V5" />
          </svg>
        </div>
        <p className="text-sm font-medium text-app-text">No connections yet</p>
        <p className="text-xs text-app-text-3">Connect to BigQuery, Postgres, or Snowflake to get started</p>
      </div>
      <button
        onClick={onAddConnection}
        className="px-4 py-2 bg-app-accent text-white rounded-lg hover:bg-app-accent-hover transition-colors text-sm font-medium"
      >
        Add Connection
      </button>
    </div>
  )
}
