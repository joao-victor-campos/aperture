import { describe, it, expect } from 'vitest'
import { isGraphElement, formatGraphElement } from '../../../renderer/src/lib/formatGraphElement'
import type { Neo4jNode, Neo4jRelationship, Neo4jPath } from '../../../shared/types'

const alice: Neo4jNode = {
  __neo4jType: 'Node', identity: '1', labels: ['Person'],
  properties: { name: 'Alice', age: 30, city: 'NYC' },
}
const knows: Neo4jRelationship = {
  __neo4jType: 'Relationship', identity: 'r1', start: '1', end: '2',
  type: 'KNOWS', properties: { since: 2020 },
}

describe('isGraphElement', () => {
  it('detects tagged graph values', () => {
    expect(isGraphElement(alice)).toBe(true)
    expect(isGraphElement(knows)).toBe(true)
  })
  it('rejects scalars and plain objects', () => {
    expect(isGraphElement('hi')).toBe(false)
    expect(isGraphElement(42)).toBe(false)
    expect(isGraphElement(null)).toBe(false)
    expect(isGraphElement({ value: 'x' })).toBe(false)
  })
})

describe('formatGraphElement', () => {
  it('formats a node with labels + truncated properties', () => {
    expect(formatGraphElement(alice)).toBe('(:Person {name: "Alice", age: 30, …})')
  })
  it('formats a relationship', () => {
    expect(formatGraphElement(knows)).toBe('[:KNOWS {since: 2020}]')
  })
  it('formats a path as nodes joined by directed relationships', () => {
    const bob: Neo4jNode = { __neo4jType: 'Node', identity: '2', labels: ['Person'], properties: { name: 'Bob' } }
    const path: Neo4jPath = {
      __neo4jType: 'Path',
      segments: [{ start: alice, relationship: knows, end: bob }],
    }
    expect(formatGraphElement(path)).toBe('(:Person {name: "Alice", age: 30, …})-[:KNOWS]->(:Person {name: "Bob"})')
  })
})
