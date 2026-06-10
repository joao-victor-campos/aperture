import type { GraphLink, GraphNode } from '@shared/types'
import { paletteColor } from '../../lib/graphPalette'

interface GraphInspectorProps {
  selected: { kind: 'node'; data: GraphNode } | { kind: 'link'; data: GraphLink } | null
}

/**
 * Right-column inspector. Empty state: "Select a node or relationship…".
 * Populated state: label/type heading + ID + property table (one row per
 * key, styled like the existing schema table rows).
 */
export default function GraphInspector({ selected }: GraphInspectorProps) {
  return (
    <div className="w-[280px] shrink-0 flex flex-col h-full border-l border-app-border bg-app-surface overflow-hidden">
      <div className="px-3 py-2 border-b border-app-border shrink-0">
        <span className="app-section-label">Inspector</span>
      </div>

      <div className="flex-1 overflow-y-auto">
        {selected == null ? (
          <div className="p-4 text-xs text-app-text-3">
            Select a node or relationship to inspect it.
          </div>
        ) : selected.kind === 'node' ? (
          <NodeDetails node={selected.data} />
        ) : (
          <LinkDetails link={selected.data} />
        )}
      </div>
    </div>
  )
}

function NodeDetails({ node }: { node: GraphNode }) {
  return (
    <div className="flex flex-col">
      <div className="px-3 py-2 border-b border-app-border">
        <div className="flex items-center gap-2">
          <span
            className="inline-block w-2.5 h-2.5 rounded-full shrink-0"
            style={{ backgroundColor: paletteColor(node.primaryLabel) }}
          />
          <span className="text-app-text font-semibold text-xs">{node.labels.join(':') || '(unknown)'}</span>
        </div>
        <div className="text-[10px] text-app-text-3 font-mono mt-0.5 truncate" title={node.id}>
          ID: {node.id}
        </div>
      </div>
      <PropertyTable properties={node.properties} />
    </div>
  )
}

function LinkDetails({ link }: { link: GraphLink }) {
  return (
    <div className="flex flex-col">
      <div className="px-3 py-2 border-b border-app-border">
        <div className="flex items-center gap-2">
          <span
            className="inline-block w-2.5 h-2.5 rounded shrink-0"
            style={{ backgroundColor: paletteColor(link.type) }}
          />
          <span className="text-app-text font-semibold text-xs">:{link.type}</span>
        </div>
        <div className="text-[10px] text-app-text-3 font-mono mt-0.5 truncate" title={`${link.source} → ${link.target}`}>
          {link.source} → {link.target}
        </div>
      </div>
      <PropertyTable properties={link.properties} />
    </div>
  )
}

function PropertyTable({ properties }: { properties: Record<string, unknown> }) {
  const entries = Object.entries(properties)
  if (entries.length === 0) {
    return <div className="px-3 py-2 text-[11px] text-app-text-3">No properties.</div>
  }
  return (
    <table className="w-full text-[11px] border-collapse">
      <tbody>
        {entries.map(([key, value]) => (
          <tr key={key} className="border-b border-app-border/40">
            <td className="px-3 py-1.5 align-top text-app-text-2 font-mono w-1/3 truncate" title={key}>{key}</td>
            <td className="px-3 py-1.5 align-top text-app-text font-mono break-words">{formatPropValue(value)}</td>
          </tr>
        ))}
      </tbody>
    </table>
  )
}

function formatPropValue(value: unknown): string {
  if (value === null || value === undefined) return 'NULL'
  if (typeof value === 'string') return value
  return JSON.stringify(value)
}
