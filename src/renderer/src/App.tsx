import { useState, useEffect } from 'react'
import TitleBar from './components/layout/TitleBar'
import Sidebar from './components/layout/Sidebar'
import Editor from './pages/Editor'
import ConnectionModal from './components/connections/ConnectionModal'
import PostgresConnectionModal from './components/connections/PostgresConnectionModal'
import SnowflakeConnectionModal from './components/connections/SnowflakeConnectionModal'
import { useConnectionStore } from './store/connectionStore'

export default function App() {
  const [connectionModal, setConnectionModal] = useState<null | 'chooser' | 'bigquery' | 'postgres' | 'snowflake'>(null)
  const { connections, load } = useConnectionStore()

  // Theme — persisted in localStorage; dark is the default
  const [isDark, setIsDark] = useState(() => localStorage.getItem('theme') !== 'light')

  useEffect(() => {
    load()
  }, [load])

  useEffect(() => {
    const html = document.documentElement
    if (isDark) {
      html.classList.add('dark')
    } else {
      html.classList.remove('dark')
    }
    localStorage.setItem('theme', isDark ? 'dark' : 'light')
  }, [isDark])

  return (
    <div className="flex flex-col h-screen bg-app-bg text-app-text">
      <TitleBar
        onAddConnection={() => setConnectionModal('chooser')}
        isDark={isDark}
        onToggleTheme={() => setIsDark((d) => !d)}
      />
      <div className="flex flex-1 overflow-hidden">
        <Sidebar onAddConnection={() => setConnectionModal('chooser')} />
        <main className="flex-1 overflow-hidden">
          {connections.length === 0 ? (
            <EmptyState onAddConnection={() => setConnectionModal('chooser')} />
          ) : (
            <Editor />
          )}
        </main>
      </div>
      {connectionModal === 'chooser' && (
        <ConnectionTypeChooserModal
          onClose={() => setConnectionModal(null)}
          onChoose={(engine) => setConnectionModal(engine)}
        />
      )}
      {connectionModal === 'bigquery' && (
        <ConnectionModal onClose={() => setConnectionModal(null)} />
      )}
      {connectionModal === 'postgres' && (
        <PostgresConnectionModal onClose={() => setConnectionModal(null)} />
      )}
      {connectionModal === 'snowflake' && (
        <SnowflakeConnectionModal onClose={() => setConnectionModal(null)} />
      )}
    </div>
  )
}

function ConnectionTypeChooserModal({
  onClose,
  onChoose
}: {
  onClose: () => void
  onChoose: (engine: 'bigquery' | 'postgres' | 'snowflake') => void
}) {
  return (
    <div className="fixed inset-0 bg-black/70 flex items-center justify-center z-50">
      <div className="bg-app-surface rounded-xl shadow-2xl w-[420px] border border-app-border">
        <div className="flex items-center justify-between px-5 py-4 border-b border-app-border">
          <h2 className="text-sm font-semibold text-app-text">Add Connection</h2>
          <button
            onClick={onClose}
            className="text-app-text-2 hover:text-app-text transition-colors"
            aria-label="Close"
          >
            ×
          </button>
        </div>

        <div className="p-5 flex flex-col gap-3">
          <button
            onClick={() => onChoose('bigquery')}
            className="text-left text-xs px-4 py-3 rounded-lg border border-app-border hover:bg-app-elevated/40 transition-colors"
          >
            <div className="font-medium text-app-text">BigQuery</div>
            <div className="text-[10px] text-app-text-3 mt-1">Projects, datasets, tables</div>
          </button>

          <button
            onClick={() => onChoose('snowflake')}
            className="text-left text-xs px-4 py-3 rounded-lg border border-app-border hover:bg-app-elevated/40 transition-colors"
          >
            <div className="font-medium text-app-text">Snowflake</div>
            <div className="text-[10px] text-app-text-3 mt-1">Account, warehouse, schemas</div>
          </button>

          <button
            onClick={() => onChoose('postgres')}
            className="text-left text-xs px-4 py-3 rounded-lg border border-app-border hover:bg-app-elevated/40 transition-colors"
          >
            <div className="font-medium text-app-text">Postgres</div>
            <div className="text-[10px] text-app-text-3 mt-1">Host, database, schemas</div>
          </button>
        </div>

        <div className="flex justify-end gap-2 px-5 py-4 border-t border-app-border">
          <button
            onClick={onClose}
            className="text-xs px-3 py-1.5 rounded-lg text-app-text-2 hover:text-app-text transition-colors"
          >
            Cancel
          </button>
        </div>
      </div>
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
        <p className="text-xs text-app-text-3">Connect to a BigQuery project to get started</p>
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
