import { useEffect } from 'react'
import { createPortal } from 'react-dom'
import { X } from 'lucide-react'

interface ShortcutCheatsheetProps {
  open: boolean
  onClose: () => void
}

interface ShortcutRow {
  description: string
  keys: string[][]  // each inner array is one chord, e.g. [['⌘', '↵']]
}

interface ShortcutSection {
  title: string
  shortcuts: ShortcutRow[]
}

const isMac = typeof navigator !== 'undefined' && /Mac|iPhone|iPad/.test(navigator.platform)
const mod = isMac ? '⌘' : 'Ctrl'
const alt = isMac ? '⌥' : 'Alt'

const SECTIONS: ShortcutSection[] = [
  {
    title: 'Editor',
    shortcuts: [
      { description: 'Run / Cancel query', keys: [[mod, '↵']] },
      { description: 'Explain plan', keys: [[mod, 'E']] },
      { description: 'Save query', keys: [[mod, 'S']] },
      { description: 'Format SQL', keys: [[alt, mod, 'F']] },
    ],
  },
  {
    title: 'Navigation',
    shortcuts: [
      { description: 'Command palette', keys: [[mod, 'K']] },
      { description: 'Keyboard shortcuts', keys: [[mod, '?']] },
    ],
  },
  {
    title: 'Command Palette',
    shortcuts: [
      { description: 'Navigate', keys: [['↑'], ['↓']] },
      { description: 'Execute', keys: [['⏎']] },
      { description: 'Close', keys: [['Esc']] },
    ],
  },
]

export default function ShortcutCheatsheet({ open, onClose }: ShortcutCheatsheetProps) {
  // Close on Escape
  useEffect(() => {
    if (!open) return
    const handler = (e: KeyboardEvent) => {
      if (e.key === 'Escape') {
        e.preventDefault()
        onClose()
      }
    }
    window.addEventListener('keydown', handler)
    return () => window.removeEventListener('keydown', handler)
  }, [open, onClose])

  if (!open) return null

  return createPortal(
    <div
      className="fixed inset-0 z-[9999] flex items-center justify-center"
      onClick={(e) => {
        // Close on backdrop click
        if (e.target === e.currentTarget) onClose()
      }}
    >
      {/* Backdrop */}
      <div className="absolute inset-0 bg-black/40" />

      {/* Card */}
      <div className="relative max-w-[440px] w-full mx-4 bg-app-surface border border-app-border rounded-xl shadow-app-card overflow-hidden animate-modal-in">
        {/* Header */}
        <div className="flex items-center justify-between px-5 pt-5 pb-3">
          <h2 className="text-sm font-semibold text-app-text">Keyboard Shortcuts</h2>
          <button
            onClick={onClose}
            className="p-1.5 rounded-md text-app-text-3 hover:text-app-text hover:bg-app-elevated transition-colors"
          >
            <X size={14} />
          </button>
        </div>

        {/* Sections */}
        <div className="px-5 pb-5 space-y-4">
          {SECTIONS.map((section) => (
            <div key={section.title}>
              <div className="app-section-label mb-2">{section.title}</div>
              <div className="space-y-1.5">
                {section.shortcuts.map((shortcut) => (
                  <div
                    key={shortcut.description}
                    className="flex items-center justify-between py-1"
                  >
                    <span className="text-xs text-app-text">{shortcut.description}</span>
                    <div className="flex items-center gap-1.5">
                      {shortcut.keys.map((chord, ci) => (
                        <span key={ci} className="flex items-center gap-0.5">
                          {ci > 0 && <span className="text-app-text-3 text-[10px] mx-0.5">/</span>}
                          {chord.map((key, ki) => (
                            <kbd key={ki} className="app-kbd">{key}</kbd>
                          ))}
                        </span>
                      ))}
                    </div>
                  </div>
                ))}
              </div>
            </div>
          ))}
        </div>
      </div>
    </div>,
    document.body
  )
}
