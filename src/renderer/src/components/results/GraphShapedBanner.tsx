import { Network } from 'lucide-react'

interface GraphShapedBannerProps {
  truncated: boolean
  /** Only set when truncated — total node count that exceeded the cap */
  nodeCount?: number
  /** Only meaningful when not truncated */
  onViewAsGraph: () => void
}

/**
 * Auto-detected banner that appears above the results table when the result
 * contains graph data. When truncated past the cap, it explains the limit
 * instead of offering a view that would hang the renderer.
 */
export default function GraphShapedBanner({ truncated, nodeCount, onViewAsGraph }: GraphShapedBannerProps) {
  if (truncated) {
    return (
      <div className="flex items-center gap-2 px-3 py-1.5 text-[11px] text-app-warn bg-app-warn-subtle/40 border-b border-app-warn/30 shrink-0">
        <Network size={12} className="shrink-0" />
        <span>
          This result has {nodeCount?.toLocaleString()} nodes — too many to visualize. Try adding a <span className="font-mono">LIMIT</span>.
        </span>
      </div>
    )
  }
  return (
    <div className="flex items-center justify-between gap-2 px-3 py-1.5 text-[11px] bg-app-cat-teal/10 border-b border-app-cat-teal/30 shrink-0">
      <div className="flex items-center gap-2 text-app-cat-teal">
        <Network size={12} className="shrink-0" />
        <span>This result contains graph data (nodes &amp; relationships).</span>
      </div>
      <button
        onClick={onViewAsGraph}
        className="text-[11px] px-2 py-0.5 rounded-md bg-app-cat-teal/20 hover:bg-app-cat-teal/30 text-app-cat-teal font-medium transition-colors shrink-0"
      >
        View as graph
      </button>
    </div>
  )
}
