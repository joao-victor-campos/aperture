import { type RefObject } from 'react'
import ApertureIcon from '../ApertureIcon'
import CommandPalette, { type CommandPaletteHandle } from '../command/CommandPalette'
import ConnectionMenu from './ConnectionMenu'
import TitleBarActions from './TitleBarActions'
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

        <TitleBarActions onOpenSettings={onOpenSettings} onToggleChat={onToggleChat} chatOpen={chatOpen} />
      </div>
    </div>
  )
}
