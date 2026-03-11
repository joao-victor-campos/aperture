import { useState, useEffect } from 'react'
import TitleBar from './components/layout/TitleBar'
import Sidebar from './components/layout/Sidebar'
import Editor from './pages/Editor'
import ConnectionModal from './components/connections/ConnectionModal'
import { useConnectionStore } from './store/connectionStore'

export default function App() {
  const [showConnectionModal, setShowConnectionModal] = useState(false)
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
        onAddConnection={() => setShowConnectionModal(true)}
        isDark={isDark}
        onToggleTheme={() => setIsDark((d) => !d)}
      />
      <div className="flex flex-1 overflow-hidden">
        <Sidebar onAddConnection={() => setShowConnectionModal(true)} />
        <main className="flex-1 overflow-hidden">
          {connections.length === 0 ? (
            <EmptyState onAddConnection={() => setShowConnectionModal(true)} />
          ) : (
            <Editor />
          )}
        </main>
      </div>
      {showConnectionModal && (
        <ConnectionModal onClose={() => setShowConnectionModal(false)} />
      )}
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
