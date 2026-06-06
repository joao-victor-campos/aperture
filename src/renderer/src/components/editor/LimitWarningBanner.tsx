import { AlertTriangle, X } from 'lucide-react'

interface LimitWarningBannerProps {
  onRunAnyway: () => void
  onAddLimit: () => void
  onDismiss: () => void
}

export default function LimitWarningBanner({ onRunAnyway, onAddLimit, onDismiss }: LimitWarningBannerProps) {
  return (
    <div className="flex items-center gap-3 px-3 py-2 bg-app-warn-subtle/40 border-b border-app-warn/30 shrink-0">
      <AlertTriangle size={14} className="text-app-warn shrink-0" />
      <span className="text-xs text-app-warn font-medium">
        This query has no LIMIT clause.
      </span>
      <div className="flex-1" />
      <button
        onClick={onAddLimit}
        className="text-xs px-2.5 py-1 rounded bg-app-accent hover:bg-app-accent-hover text-white font-medium transition-colors"
      >
        Add LIMIT 1000
      </button>
      <button
        onClick={onRunAnyway}
        className="text-xs px-2.5 py-1 rounded border border-app-border text-app-text-2 hover:text-app-text hover:bg-app-elevated transition-colors"
      >
        Run anyway
      </button>
      <button
        onClick={onDismiss}
        className="p-1 rounded text-app-text-3 hover:text-app-text hover:bg-app-elevated transition-colors"
        title="Dismiss"
      >
        <X size={12} />
      </button>
    </div>
  )
}
