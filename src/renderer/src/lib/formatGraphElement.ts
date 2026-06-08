import type { Neo4jGraphValue, Neo4jNode } from '@shared/types'

/** True when a cell value is a serialized Neo4j Node / Relationship / Path. */
export function isGraphElement(value: unknown): value is Neo4jGraphValue {
  return (
    typeof value === 'object' &&
    value !== null &&
    '__neo4jType' in value &&
    ['Node', 'Relationship', 'Path'].includes((value as { __neo4jType: string }).__neo4jType)
  )
}

/** Compact Cypher-style string for a graph value, e.g. `(:Person {name: "Alice", …})`. */
export function formatGraphElement(value: Neo4jGraphValue): string {
  if (value.__neo4jType === 'Node') return formatNode(value)
  if (value.__neo4jType === 'Relationship') return `[:${value.type}${formatProps(value.properties)}]`
  // Path
  if (value.segments.length === 0) return '()'
  let out = formatNode(value.segments[0].start)
  for (const seg of value.segments) {
    out += `-[:${seg.relationship.type}]->${formatNode(seg.end)}`
  }
  return out
}

function formatNode(node: Neo4jNode): string {
  const labels = node.labels.length ? ':' + node.labels.join(':') : ''
  return `(${labels}${formatProps(node.properties)})`
}

function formatProps(props: Record<string, unknown>, max = 2): string {
  const entries = Object.entries(props)
  if (entries.length === 0) return ''
  const shown = entries.slice(0, max).map(([k, v]) => `${k}: ${formatScalar(v)}`)
  const suffix = entries.length > max ? ', …' : ''
  return ` {${shown.join(', ')}${suffix}}`
}

function formatScalar(v: unknown): string {
  if (typeof v === 'string') return `"${v}"`
  return String(v)
}
