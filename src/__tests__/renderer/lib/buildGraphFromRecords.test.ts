import { describe, it, expect } from 'vitest'
import { buildGraphFromRecords } from '../../../renderer/src/lib/buildGraphFromRecords'
import type { Neo4jNode, Neo4jRelationship, Neo4jPath } from '../../../shared/types'

const alice: Neo4jNode = { __neo4jType: 'Node', identity: 'a', labels: ['Person'], properties: { name: 'Alice' } }
const bob: Neo4jNode = { __neo4jType: 'Node', identity: 'b', labels: ['Person'], properties: { name: 'Bob' } }
const company: Neo4jNode = { __neo4jType: 'Node', identity: 'c', labels: ['Company'], properties: {} }
const knows: Neo4jRelationship = {
  __neo4jType: 'Relationship', identity: 'r1', start: 'a', end: 'b', type: 'KNOWS', properties: {},
}
const worksAt: Neo4jRelationship = {
  __neo4jType: 'Relationship', identity: 'r2', start: 'a', end: 'c', type: 'WORKS_AT', properties: {},
}

describe('buildGraphFromRecords', () => {
  it('extracts nodes and links from columns', () => {
    const out = buildGraphFromRecords([{ a: alice, b: bob, r: knows }])
    expect(out.truncated).toBe(false)
    if (out.truncated) return
    expect(out.nodes).toHaveLength(2)
    expect(out.links).toHaveLength(1)
    expect(out.links[0]).toMatchObject({ source: 'a', target: 'b', type: 'KNOWS' })
  })

  it('de-duplicates nodes and relationships by identity across rows', () => {
    const out = buildGraphFromRecords([
      { a: alice, b: bob, r: knows },
      { a: alice, b: bob, r: knows },
    ])
    if (out.truncated) throw new Error('unexpected truncation')
    expect(out.nodes).toHaveLength(2)
    expect(out.links).toHaveLength(1)
  })

  it('walks Path segments — adds endpoints and the relationship', () => {
    const path: Neo4jPath = {
      __neo4jType: 'Path',
      segments: [{ start: alice, relationship: worksAt, end: company }],
    }
    const out = buildGraphFromRecords([{ p: path }])
    if (out.truncated) throw new Error('unexpected truncation')
    expect(out.nodes.map((n) => n.id).sort()).toEqual(['a', 'c'])
    expect(out.links[0].type).toBe('WORKS_AT')
  })

  it('filters orphan links (link whose endpoint is missing in nodes)', () => {
    // Relationship returned without its endpoints — its source/target aren't in the result.
    const out = buildGraphFromRecords([{ r: knows }])
    if (out.truncated) throw new Error('unexpected truncation')
    expect(out.nodes).toHaveLength(0)
    expect(out.links).toHaveLength(0)
  })

  it('returns the truncation marker past the cap', () => {
    const rows: Record<string, unknown>[] = []
    for (let i = 0; i < 600; i++) {
      const n: Neo4jNode = { __neo4jType: 'Node', identity: String(i), labels: ['X'], properties: {} }
      rows.push({ n })
    }
    const out = buildGraphFromRecords(rows, 500)
    expect(out).toEqual({ truncated: true, nodeCount: 600 })
  })

  it('preserves primaryLabel from the first label, defaults to (unknown)', () => {
    const noLabels: Neo4jNode = { __neo4jType: 'Node', identity: 'x', labels: [], properties: {} }
    const out = buildGraphFromRecords([{ a: alice, x: noLabels }])
    if (out.truncated) throw new Error('unexpected truncation')
    const a = out.nodes.find((n) => n.id === 'a')!
    const x = out.nodes.find((n) => n.id === 'x')!
    expect(a.primaryLabel).toBe('Person')
    expect(x.primaryLabel).toBe('(unknown)')
  })

  it('ignores scalar cells', () => {
    const out = buildGraphFromRecords([{ a: alice, scalar: 42, other: 'str' }])
    if (out.truncated) throw new Error('unexpected truncation')
    expect(out.nodes).toHaveLength(1)
  })
})
