import { describe, it, expect } from 'vitest'
import { capResult } from '../../../renderer/src/ai/capResult'
import type { QueryResult } from '../../../shared/types'

function make(rowCount: number): QueryResult {
  return {
    columns: ['id', 'name'],
    rows: Array.from({ length: rowCount }, (_, i) => ({ id: i, name: `n${i}` })),
    rowCount,
    executionTimeMs: 10,
  }
}

describe('capResult', () => {
  it('includes all rows when under the cap', () => {
    const out = capResult(make(3), 50)
    expect(out).toContain('"columns"')
    const parsed = JSON.parse(out)
    expect(parsed.rows).toHaveLength(3)
    expect(parsed.truncated).toBe(false)
  })

  it('caps rows and flags truncation when over the cap', () => {
    const out = capResult(make(120), 50)
    const parsed = JSON.parse(out)
    expect(parsed.rows).toHaveLength(50)
    expect(parsed.truncated).toBe(true)
    expect(parsed.totalRows).toBe(120)
  })

  it('reports columns and zero rows for empty results', () => {
    const out = capResult(make(0), 50)
    const parsed = JSON.parse(out)
    expect(parsed.rows).toHaveLength(0)
    expect(parsed.columns).toEqual(['id', 'name'])
  })
})
