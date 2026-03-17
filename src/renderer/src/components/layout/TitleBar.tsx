import { Sun, Moon, Plus } from 'lucide-react'
import { useConnectionStore } from '../../store/connectionStore'
import ApertureIcon from '../ApertureIcon'

interface TitleBarProps {
  onAddConnection: () => void
  isDark: boolean
  onToggleTheme: () => void
}

export default function TitleBar({ onAddConnection, isDark, onToggleTheme }: TitleBarProps) {
  const { connections, activeConnectionId, setActive } = useConnectionStore()

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
        {connections.length > 0 && (
          <select
            value={activeConnectionId ?? ''}
            onChange={(e) => setActive(e.target.value)}
            className="bg-app-elevated text-app-text text-xs rounded-md px-2 py-1 border border-app-border focus:outline-none focus:border-app-accent cursor-pointer"
          >
            {connections.map((c) => (
              <option key={c.id} value={c.id}>
                {c.name} — {c.projectId}
              </option>
            ))}
          </select>
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
