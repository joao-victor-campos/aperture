import { describe, it, expect } from 'vitest'
import { flattenFields, type FlatField } from '../../../renderer/src/lib/flattenFields'
import type { TableField } from '@shared/types'

const f = (name: string, fields?: TableField[]): TableField => ({
  name,
  type: fields ? 'RECORD' : 'STRING',
  mode: 'NULLABLE',
  ...(fields ? { fields } : {}),
})

describe('flattenFields', () => {
  it('returns an empty array for empty input', () => {
    expect(flattenFields([])).toEqual([])
  })

  it('flattens a flat schema at depth 0 preserving order', () => {
    const rows = flattenFields([f('a'), f('b'), f('c')])
    expect(rows.map((r: FlatField) => [r.field.name, r.depth])).toEqual([
      ['a', 0],
      ['b', 0],
      ['c', 0],
    ])
  })

  it('emits nested RECORD children at depth+1 immediately after their parent (depth-first)', () => {
    const rows = flattenFields([f('parent', [f('child1'), f('child2')]), f('sibling')])
    expect(rows.map((r) => [r.field.name, r.depth])).toEqual([
      ['parent', 0],
      ['child1', 1],
      ['child2', 1],
      ['sibling', 0],
    ])
  })

  it('recurses through multiple levels of nesting', () => {
    const rows = flattenFields([f('lvl0', [f('lvl1', [f('lvl2')])])])
    expect(rows.map((r) => [r.field.name, r.depth])).toEqual([
      ['lvl0', 0],
      ['lvl1', 1],
      ['lvl2', 2],
    ])
  })

  it('treats an empty fields array as a leaf (no recursion)', () => {
    const leaf: TableField = { name: 'x', type: 'RECORD', mode: 'NULLABLE', fields: [] }
    expect(flattenFields([leaf])).toEqual([{ field: leaf, depth: 0 }])
  })
})
