import { Settings, Sparkles } from 'lucide-react'
import { useUpdateStore } from '../../store/updateStore'

interface TitleBarActionsProps {
  onOpenSettings: () => void
  onToggleChat?: () => void
  chatOpen?: boolean
}

export default function TitleBarActions({ onOpenSettings, onToggleChat, chatOpen }: TitleBarActionsProps) {
  const updateAvailable = useUpdateStore((s) => s.status?.updateAvailable ?? false)

  return (
    <>
      <button
        type="button"
        onClick={onToggleChat}
        aria-label="Toggle AI assistant"
        aria-pressed={chatOpen}
        style={{ WebkitAppRegion: 'no-drag' } as React.CSSProperties}
        className={`p-1.5 rounded-md transition-colors ${
          chatOpen ? 'text-app-accent-text bg-app-accent-subtle' : 'text-app-text-3 hover:text-app-text hover:bg-app-elevated'
        }`}
      >
        <Sparkles size={15} />
      </button>

      <button
        onClick={onOpenSettings}
        title={updateAvailable ? 'Settings — update available' : 'Settings'}
        style={{ WebkitAppRegion: 'no-drag' } as React.CSSProperties}
        className="relative p-1.5 rounded-md text-app-text-2 hover:text-app-text hover:bg-app-elevated transition-colors"
      >
        <Settings size={14} />
        {updateAvailable && (
          <span
            className="absolute top-0.5 right-0.5 w-2 h-2 rounded-full bg-app-accent ring-2 ring-app-bg"
            aria-label="Update available"
          />
        )}
      </button>
    </>
  )
}
