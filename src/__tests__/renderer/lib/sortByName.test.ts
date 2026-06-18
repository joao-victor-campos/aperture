import { describe, it, expect } from 'vitest'
import { byName } from '../../../renderer/src/lib/sortByName'

describe('byName', () => {
  it('sorts case-insensitively', () => {
    const out = [{ name: 'cherry' }, { name: 'Banana' }, { name: 'apple' }].sort(byName)
    expect(out.map((x) => x.name)).toEqual(['apple', 'Banana', 'cherry'])
  })

  it('sorts numbers naturally (t2 before t10)', () => {
    const out = [{ name: 't10' }, { name: 't2' }, { name: 't1' }].sort(byName)
    expect(out.map((x) => x.name)).toEqual(['t1', 't2', 't10'])
  })

  it('returns 0 for equal names', () => {
    expect(byName({ name: 'X' }, { name: 'x' })).toBe(0)
  })

  it('handles empty names without throwing', () => {
    const out = [{ name: 'b' }, { name: '' }, { name: 'a' }].sort(byName)
    expect(out.map((x) => x.name)).toEqual(['', 'a', 'b'])
  })

  it('works over a Table-shaped array (extra fields ignored)', () => {
    const out = [
      { id: '1', name: 'Zeta', type: 'LABEL' },
      { id: '2', name: 'alpha', type: 'LABEL' },
    ].sort(byName)
    expect(out.map((x) => x.name)).toEqual(['alpha', 'Zeta'])
  })
})
