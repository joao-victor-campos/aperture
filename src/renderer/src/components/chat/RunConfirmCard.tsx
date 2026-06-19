import { Play, X } from 'lucide-react'

interface Props {
  sql: string
  bytesProcessed: number
  onApprove: () => void
  onReject: () => void
}

function formatBytes(n: number): string {
  if (!n) return 'unknown'
  const units = ['B', 'KB', 'MB', 'GB', 'TB']
  let v = n, i = 0
  while (v >= 1024 && i < units.length - 1) { v /= 1024; i++ }
  return `${v.toFixed(1)} ${units[i]}`
}

export default function RunConfirmCard({ sql, bytesProcessed, onApprove, onReject }: Props) {
  return (
    <div className="border border-app-accent rounded-lg p-3 bg-app-accent-subtle/40 flex flex-col gap-2">
      <div className="app-section-label">Run this query?</div>
      <pre className="text-ui-xs text-app-text-2 whitespace-pre-wrap bg-app-surface rounded-md p-2 border border-app-border max-h-40 overflow-y-auto">
        {sql}
      </pre>
      <div className="flex items-center justify-between">
        <span className="text-ui-xs text-app-text-3 font-tabular">Est. {formatBytes(bytesProcessed)} scanned</span>
        <div className="flex items-center gap-2">
          <button
            type="button"
            onClick={onReject}
            className="flex items-center gap-1 px-2 py-1 rounded-md text-ui text-app-text-2 hover:bg-app-elevated"
          >
            <X size={12} /> Reject
          </button>
          <button
            type="button"
            onClick={onApprove}
            className="flex items-center gap-1 px-2.5 py-1 rounded-md text-ui font-medium bg-app-accent hover:bg-app-accent-hover text-white"
          >
            <Play size={12} /> Approve & run
          </button>
        </div>
      </div>
    </div>
  )
}
