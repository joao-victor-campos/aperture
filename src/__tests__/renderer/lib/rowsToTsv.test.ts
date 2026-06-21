import { describe, it, expect } from 'vitest'
import { rowsToTsv } from '../../../renderer/src/lib/rowsToTsv'

describe('rowsToTsv', () => {
  const cols = ['id', 'name']

  it('emits a header row followed by one line per row, tab-separated', () => {
    const out = rowsToTsv([{ id: 1, name: 'Alice' }, { id: 2, name: 'Bob' }], cols)
    expect(out).toBe('id\tname\n1\tAlice\n2\tBob')
  })

  it('returns just the header when there are no rows', () => {
    expect(rowsToTsv([], cols)).toBe('id\tname')
  })

  it('renders null/undefined as empty cells', () => {
    expect(rowsToTsv([{ id: null, name: undefined }], cols)).toBe('id\tname\n\t')
  })

  it('unwraps BigQuery-style { value } objects, else JSON-stringifies objects', () => {
    const out = rowsToTsv([{ id: { value: '2024-01-01' }, name: { a: 1 } }], cols)
    expect(out).toBe('id\tname\n2024-01-01\t{"a":1}')
  })

  it('replaces embedded tabs and newlines with spaces so structure survives', () => {
    const out = rowsToTsv([{ id: 'a\tb', name: 'c\nd' }], cols)
    expect(out).toBe('id\tname\na b\tc d')
  })

  it('emits cells in column order regardless of object key order', () => {
    const out = rowsToTsv([{ name: 'Alice', id: 1 }], cols)
    expect(out).toBe('id\tname\n1\tAlice')
  })
})
