import { type RefObject } from 'react'
import { Settings, Sparkles } from 'lucide-react'
import { useUpdateStore } from '../../store/updateStore'
import ApertureIcon from '../ApertureIcon'
import CommandPalette, { type CommandPaletteHandle } from '../command/CommandPalette'
import ConnectionMenu from './ConnectionMenu'
import type { Connection } from '@shared/types'

interface TitleBarProps {
  onAddConnection: () => void
  onEditConnection: (conn: Connection) => void
  onOpenSettings: () => void
  onShowShortcuts?: () => void
  onToggleChat?: () => void
  chatOpen?: boolean
  /** Receives the palette's imperative `focus()` so a global ⌘K can target it. */
  paletteRef?: RefObject<CommandPaletteHandle>
}

export default function TitleBar({ onAddConnection, onEditConnection, onOpenSettings, onShowShortcuts, onToggleChat, chatOpen, paletteRef }: TitleBarProps) {
  const updateAvailable = useUpdateStore((s) => s.status?.updateAvailable ?? false)

  return (
    <div
      className="h-[46px] flex items-center px-4 gap-3 border-b border-app-border bg-app-bg shrink-0"
      style={{ WebkitAppRegion: 'drag' } as React.CSSProperties}
    >
      {/* Space for macOS traffic lights (smaller on Linux/Windows where there are none) */}
      <div className={`${window.platform === 'darwin' ? 'w-16' : 'w-4'} shrink-0`} />

      {/* Brand: terracotta blades + small-caps wordmark */}
      <div className="flex items-center gap-2 shrink-0">
        <ApertureIcon size={16} />
        <span className="text-app-text font-semibold uppercase tracking-caps text-[12px]">
          Aperture
        </span>
      </div>

      <div className="flex items-center gap-2 ml-3 flex-1">
        <ConnectionMenu onAddConnection={onAddConnection} onEditConnection={onEditConnection} />

        {/* Left spacer — inherits drag from parent */}
        <div className="flex-1" />

        {/* ⌘K hero — centered palette input */}
        <CommandPalette
          ref={paletteRef}
          onAddConnection={onAddConnection}
          onOpenSettings={onOpenSettings}
          onShowShortcuts={onShowShortcuts}
        />

        {/* Right spacer — inherits drag from parent */}
        <div className="flex-1" />

        {/* AI chat toggle */}
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

        {/* Settings */}
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
      </div>
    </div>
  )
}
