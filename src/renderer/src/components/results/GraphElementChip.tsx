import type { Neo4jGraphValue } from '@shared/types'
import { formatGraphElement } from '../../lib/formatGraphElement'

/**
 * Renders a serialized Node / Relationship / Path as a compact Cypher-style chip.
 * Color hints by kind: nodes teal, relationships purple, paths blue.
 */
export default function GraphElementChip({ value }: { value: Neo4jGraphValue }) {
  const text = formatGraphElement(value)
  const color =
    value.__neo4jType === 'Relationship'
      ? 'text-app-cat-purple'
      : value.__neo4jType === 'Path'
      ? 'text-app-cat-blue'
      : 'text-app-cat-teal'
  return (
    <span
      className={`inline-block max-w-full truncate rounded px-1.5 py-0.5 bg-app-elevated border border-app-border font-mono text-[11px] ${color}`}
      title={text}
    >
      {text}
    </span>
  )
}
