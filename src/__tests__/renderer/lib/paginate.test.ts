import { describe, it, expect } from 'vitest'
import { paginate } from '../../../renderer/src/lib/paginate'

const rows = Array.from({ length: 250 }, (_, i) => ({ id: i }))

describe('paginate', () => {
  it('returns the slice for the given page + size', () => {
    expect(paginate(rows, 0, 100).map((r) => r.id)[0]).toBe(0)
    expect(paginate(rows, 0, 100)).toHaveLength(100)
    expect(paginate(rows, 1, 100).map((r) => r.id)[0]).toBe(100)
    expect(paginate(rows, 2, 100)).toHaveLength(50)
  })

  it('returns an empty array for an out-of-range page', () => {
    expect(paginate(rows, 99, 100)).toEqual([])
  })

  it('handles an empty input', () => {
    expect(paginate([], 0, 100)).toEqual([])
  })

  it('slices the requested window', () => {
    const out = paginate(rows, 0, 2)
    expect(out).toEqual([{ id: 0 }, { id: 1 }])
  })
})
