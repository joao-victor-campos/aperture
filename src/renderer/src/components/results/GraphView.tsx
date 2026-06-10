import { useCallback, useEffect, useMemo, useRef, useState } from 'react'
import ForceGraph2D from 'react-force-graph-2d'
import { ArrowLeft, Maximize2 } from 'lucide-react'
import type { GraphData, GraphLink, GraphNode, QueryResult } from '@shared/types'
import { buildGraphFromRecords } from '../../lib/buildGraphFromRecords'
import { paletteColor } from '../../lib/graphPalette'
import GraphInspector from './GraphInspector'
import GraphLegend from './GraphLegend'

interface GraphViewProps {
  result: QueryResult
  /** Returns to the results-table view */
  onBack: () => void
}

type Selected =
  | { kind: 'node'; data: GraphNode }
  | { kind: 'link'; data: GraphLink }
  | null

/**
 * Canvas 2D contexts can't resolve CSS custom properties — `rgb(var(--c-x))`
 * silently paints black. Resolve the var against :root once per token.
 * DOM components (inspector/legend) keep using the raw token strings, where
 * CSS variables work natively.
 */
function resolveCanvasColor(token: string, cache: Map<string, string>): string {
  const cached = cache.get(token)
  if (cached) return cached
  const match = token.match(/var\((--[^)]+)\)/)
  let resolved = token
  if (match) {
    const value = getComputedStyle(document.documentElement).getPropertyValue(match[1]).trim()
    resolved = value ? `rgb(${value})` : '#888888'
  }
  cache.set(token, resolved)
  return resolved
}

/**
 * After force-graph runs its layout, link.source/link.target are replaced
 * with node object references. Normalize back to the plain GraphLink shape
 * (string ids) before handing to the inspector.
 */
function normalizeLink(link: GraphLink): GraphLink {
  const src = link.source as unknown
  const tgt = link.target as unknown
  return {
    ...link,
    source: typeof src === 'object' && src !== null ? (src as GraphNode).id : (src as string),
    target: typeof tgt === 'object' && tgt !== null ? (tgt as GraphNode).id : (tgt as string),
  }
}

/**
 * Force-directed graph view. Layout: left canvas (flex-1) + right inspector
 * (fixed 280px), per the spec's "never floating" constraint. The data is
 * built from the result rows by buildGraphFromRecords — if the cap was hit,
 * the caller (Editor.tsx) renders the banner truncation message instead and
 * never reaches this component.
 */
export default function GraphView({ result, onBack }: GraphViewProps) {
  const built = useMemo(() => buildGraphFromRecords(result.rows), [result.rows])
  // force-graph mutates node objects in place (x/y/vx/vy) — give it its own copy
  const data: GraphData = useMemo(() => {
    if (built.truncated) return { nodes: [], links: [] }
    return {
      nodes: built.nodes.map((n) => ({ ...n })),
      links: built.links.map((l) => ({ ...l })),
    }
  }, [built])

  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const fgRef = useRef<any>(null)
  const containerRef = useRef<HTMLDivElement>(null)
  const [size, setSize] = useState({ width: 0, height: 0 })
  const [selected, setSelected] = useState<Selected>(null)
  const colorCache = useRef(new Map<string, string>())

  // Size the canvas to its container (force-graph defaults to window size,
  // which would bleed under the inspector column).
  useEffect(() => {
    const el = containerRef.current
    if (!el) return
    const observer = new ResizeObserver((entries) => {
      const rect = entries[0]?.contentRect
      if (rect) setSize({ width: rect.width, height: rect.height })
    })
    observer.observe(el)
    return () => observer.disconnect()
  }, [])

  const fitToView = useCallback(() => {
    fgRef.current?.zoomToFit(400, 40)
  }, [])

  if (built.truncated) {
    // Defensive — the banner should have prevented us from getting here.
    return (
      <div className="flex-1 flex items-center justify-center text-xs text-app-text-3 p-4">
        Graph too large to render ({built.nodeCount.toLocaleString()} nodes).
      </div>
    )
  }

  return (
    <div className="flex-1 flex overflow-hidden min-h-0">
      {/* Canvas column */}
      <div ref={containerRef} className="flex-1 relative bg-app-bg overflow-hidden min-w-0">
        {/* Top-left legend */}
        <GraphLegend data={built} />

        {/* Top-right controls */}
        <div className="absolute top-2 right-2 z-10 flex gap-1">
          <button
            onClick={onBack}
            title="Back to table"
            className="flex items-center gap-1 text-[11px] px-2 py-1 rounded-md bg-app-surface/90 backdrop-blur border border-app-border text-app-text-2 hover:text-app-text hover:bg-app-surface transition-colors"
          >
            <ArrowLeft size={12} />
            <span>Back to table</span>
          </button>
          <button
            onClick={fitToView}
            title="Fit to view"
            className="p-1 rounded-md bg-app-surface/90 backdrop-blur border border-app-border text-app-text-2 hover:text-app-text hover:bg-app-surface transition-colors"
          >
            <Maximize2 size={12} />
          </button>
        </div>

        {size.width > 0 && size.height > 0 && (
          <ForceGraph2D
            ref={fgRef}
            width={size.width}
            height={size.height}
            graphData={data}
            backgroundColor="rgba(0,0,0,0)"
            nodeLabel={() => ''}
            linkLabel={(l) => (l as GraphLink).type}
            linkColor={() => resolveCanvasColor('rgb(var(--c-border-2))', colorCache.current)}
            linkDirectionalArrowLength={4}
            linkDirectionalArrowRelPos={1}
            nodeCanvasObject={(node, ctx, scale) => {
              const n = node as GraphNode & { x?: number; y?: number }
              if (n.x == null || n.y == null) return
              const r = 6
              ctx.fillStyle = resolveCanvasColor(paletteColor(n.primaryLabel), colorCache.current)
              ctx.beginPath()
              ctx.arc(n.x, n.y, r, 0, 2 * Math.PI)
              ctx.fill()
              // Selection ring — accent glow matching the existing selection treatment
              if (selected?.kind === 'node' && selected.data.id === n.id) {
                ctx.strokeStyle = resolveCanvasColor('rgb(var(--c-accent))', colorCache.current)
                ctx.lineWidth = 2 / scale
                ctx.stroke()
              }
              // Label text below the node, only when zoomed in enough to read
              if (scale > 1.4) {
                ctx.fillStyle = resolveCanvasColor('rgb(var(--c-text-2))', colorCache.current)
                ctx.font = `${10 / scale}px sans-serif`
                ctx.textAlign = 'center'
                ctx.fillText(n.primaryLabel, n.x, n.y + r + 8 / scale)
              }
            }}
            nodePointerAreaPaint={(node, color, ctx) => {
              const n = node as GraphNode & { x?: number; y?: number }
              if (n.x == null || n.y == null) return
              ctx.fillStyle = color
              ctx.beginPath()
              ctx.arc(n.x, n.y, 8, 0, 2 * Math.PI)
              ctx.fill()
            }}
            onNodeClick={(node) => setSelected({ kind: 'node', data: node as GraphNode })}
            onLinkClick={(link) => setSelected({ kind: 'link', data: normalizeLink(link as GraphLink) })}
            onBackgroundClick={() => setSelected(null)}
          />
        )}
      </div>

      {/* Inspector column */}
      <GraphInspector selected={selected} />
    </div>
  )
}
