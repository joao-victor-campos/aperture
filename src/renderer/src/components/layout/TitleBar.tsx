import { Database, Plus } from 'lucide-react'
import { useConnectionStore } from '../../store/connectionStore'

interface TitleBarProps {
  onAddConnection: () => void
}

export default function TitleBar({ onAddConnection }: TitleBarProps) {
  const { connections, activeConnectionId, setActive } = useConnectionStore()

  return (
    <div
      className="h-11 flex items-center px-4 gap-4 border-b border-gray-800 bg-gray-950 shrink-0"
      style={{ WebkitAppRegion: 'drag' } as React.CSSProperties}
    >
      {/* Space for macOS traffic lights (hiddenInset titleBarStyle) */}
      <div className="w-20 shrink-0" />

      <div className="flex items-center gap-2 shrink-0">
        <Database size={14} className="text-indigo-400" />
        <span className="text-xs font-semibold text-gray-300 tracking-widest uppercase">
          Aperture
        </span>
      </div>

      <div
        className="flex items-center gap-2 ml-2"
        style={{ WebkitAppRegion: 'no-drag' } as React.CSSProperties}
      >
        {connections.length > 0 && (
          <select
            value={activeConnectionId ?? ''}
            onChange={(e) => setActive(e.target.value)}
            className="bg-gray-800 text-gray-300 text-xs rounded-md px-2 py-1 border border-gray-700 focus:outline-none focus:border-indigo-500 cursor-pointer"
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
          className="flex items-center gap-1 text-xs px-2.5 py-1 rounded-md bg-gray-800 hover:bg-gray-700 text-gray-300 border border-gray-700 transition-colors"
        >
          <Plus size={12} />
          Connection
        </button>
      </div>
    </div>
  )
}
