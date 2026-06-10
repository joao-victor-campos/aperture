import type { GraphData } from '@shared/types'
import { paletteColor } from '../../lib/graphPalette'

/**
 * Top-left legend: colored chip + label/type name. Computed from the graph's
 * distinct primary labels and relationship types so the legend only ever
 * shows what's actually on screen.
 */
export default function GraphLegend({ data }: { data: GraphData }) {
  const nodeLabels = Array.from(new Set(data.nodes.map((n) => n.primaryLabel))).sort()
  const linkTypes = Array.from(new Set(data.links.map((l) => l.type))).sort()

  if (nodeLabels.length === 0 && linkTypes.length === 0) return null

  return (
    <div className="absolute top-2 left-2 z-10 flex flex-col gap-1 p-2 rounded-lg bg-app-surface/90 backdrop-blur border border-app-border max-w-[200px]">
      {nodeLabels.length > 0 && (
        <div className="flex flex-col gap-0.5">
          <span className="app-section-label">Nodes</span>
          {nodeLabels.map((label) => (
            <div key={label} className="flex items-center gap-1.5">
              <span className="w-2.5 h-2.5 rounded-full shrink-0" style={{ backgroundColor: paletteColor(label) }} />
              <span className="text-[11px] text-app-text truncate">{label}</span>
            </div>
          ))}
        </div>
      )}
      {linkTypes.length > 0 && (
        <div className="flex flex-col gap-0.5 mt-1">
          <span className="app-section-label">Relationships</span>
          {linkTypes.map((type) => (
            <div key={type} className="flex items-center gap-1.5">
              <span className="w-2.5 h-2.5 rounded shrink-0" style={{ backgroundColor: paletteColor(type) }} />
              <span className="text-[11px] text-app-text truncate">{type}</span>
            </div>
          ))}
        </div>
      )}
    </div>
  )
}
