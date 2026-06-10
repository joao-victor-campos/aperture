import type {
  GraphData, GraphLink, GraphNode,
  Neo4jGraphValue, Neo4jNode, Neo4jRelationship,
} from '@shared/types'
import { isGraphElement } from './formatGraphElement'

const DEFAULT_CAP = 500

type Truncated = { truncated: true; nodeCount: number }
type BuiltGraph = { truncated: false } & GraphData

/**
 * Walk every cell of every record, extract Neo4j Node / Relationship / Path
 * values, de-duplicate by element ID, and return a force-graph-compatible
 * shape. Past the cap returns a truncation marker — the graph view is never
 * silently handed an unrenderable hairball.
 *
 * Orphan links (whose source or target node isn't also present in the result)
 * are filtered out: force-graph would render them as broken edges to nowhere.
 */
export function buildGraphFromRecords(
  rows: Record<string, unknown>[],
  cap: number = DEFAULT_CAP,
): Truncated | BuiltGraph {
  const nodes = new Map<string, GraphNode>()
  const links = new Map<string, GraphLink>()

  const addNode = (n: Neo4jNode) => {
    if (nodes.has(n.identity)) return
    nodes.set(n.identity, {
      id: n.identity,
      primaryLabel: n.labels[0] ?? '(unknown)',
      labels: n.labels,
      properties: n.properties,
    })
  }

  const addLink = (r: Neo4jRelationship) => {
    if (links.has(r.identity)) return
    links.set(r.identity, {
      id: r.identity,
      source: r.start,
      target: r.end,
      type: r.type,
      properties: r.properties,
    })
  }

  const visit = (value: Neo4jGraphValue) => {
    if (value.__neo4jType === 'Node') {
      addNode(value)
    } else if (value.__neo4jType === 'Relationship') {
      addLink(value)
    } else {
      // Path — walk every segment, adding both endpoints + the relationship
      for (const seg of value.segments) {
        addNode(seg.start)
        addNode(seg.end)
        addLink(seg.relationship)
      }
    }
  }

  for (const row of rows) {
    for (const value of Object.values(row)) {
      if (isGraphElement(value)) visit(value)
    }
  }

  if (nodes.size > cap) {
    return { truncated: true, nodeCount: nodes.size }
  }

  // Filter orphan links — both endpoints must be present in the node set.
  const filteredLinks: GraphLink[] = []
  for (const link of links.values()) {
    if (nodes.has(link.source) && nodes.has(link.target)) {
      filteredLinks.push(link)
    }
  }

  return { truncated: false, nodes: Array.from(nodes.values()), links: filteredLinks }
}
