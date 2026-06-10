import { describe, it, expect } from 'vitest'
import { detectGraphShape } from '../../../renderer/src/lib/detectGraphShape'
import type { Neo4jNode } from '../../../shared/types'

const alice: Neo4jNode = {
  __neo4jType: 'Node', identity: '1', labels: ['Person'], properties: {},
}

describe('detectGraphShape', () => {
  it('is true when any cell of any row is a graph element', () => {
    expect(detectGraphShape([{ a: 'scalar', b: alice }])).toBe(true)
  })

  it('is false for scalar-only rows', () => {
    expect(detectGraphShape([{ a: 'x', b: 42, c: true, d: null }])).toBe(false)
  })

  it('is false for empty row arrays', () => {
    expect(detectGraphShape([])).toBe(false)
  })

  it('short-circuits on the first match — does not scan all rows', () => {
    // Both correctness and a soft perf check: building this synthetic giant
    // array with one early Node and 999,999 scalars should still return true
    // fast (no full walk). Smoke test — no timing assertion, just no hang.
    const rows: Record<string, unknown>[] = [{ n: alice }]
    for (let i = 0; i < 999_999; i++) rows.push({ n: i })
    expect(detectGraphShape(rows)).toBe(true)
  })
})
