import { describe, expect, it } from 'vitest'
import { computeFlipDeltas, type FlipRect } from '@renderer/lib/flipDeltas'

const rects = (entries: Array<[string, number]>): Map<string, FlipRect> =>
  new Map(entries.map(([id, left]) => [id, { left }]))

describe('computeFlipDeltas', () => {
  it('returns an empty map when nothing moved', () => {
    const prev = rects([['a', 0], ['b', 100]])
    const next = rects([['a', 0], ['b', 100]])
    expect(computeFlipDeltas(prev, next).size).toBe(0)
  })

  it('returns signed deltas for swapped ids', () => {
    const prev = rects([['a', 0], ['b', 100]])
    const next = rects([['a', 100], ['b', 0]])
    const deltas = computeFlipDeltas(prev, next)
    // a is now at 100 but was at 0 → invert by -100 (play left-to-right)
    expect(deltas.get('a')).toBe(-100)
    expect(deltas.get('b')).toBe(100)
    expect(deltas.size).toBe(2)
  })

  it('ignores ids that entered between snapshots', () => {
    const deltas = computeFlipDeltas(rects([['a', 0]]), rects([['a', 0], ['new', 50]]))
    expect(deltas.size).toBe(0)
  })

  it('ignores ids that left between snapshots', () => {
    const deltas = computeFlipDeltas(rects([['a', 0], ['gone', 50]]), rects([['a', 0]]))
    expect(deltas.size).toBe(0)
  })

  it('handles empty snapshots', () => {
    expect(computeFlipDeltas(new Map(), new Map()).size).toBe(0)
    expect(computeFlipDeltas(new Map(), rects([['a', 10]])).size).toBe(0)
  })
})
