import { describe, it, expect } from 'vitest'
import { formatCell } from '../../../renderer/src/lib/formatCell'

describe('formatCell', () => {
  it('renders null/undefined as NULL', () => {
    expect(formatCell(null)).toBe('NULL')
    expect(formatCell(undefined)).toBe('NULL')
  })
  it('unwraps BigQuery { value } wrappers', () => {
    expect(formatCell({ value: '2024-01-01' })).toBe('2024-01-01')
  })
  it('JSON-stringifies other objects', () => {
    expect(formatCell({ a: 1 })).toBe('{"a":1}')
  })
  it('stringifies primitives', () => {
    expect(formatCell(42)).toBe('42')
    expect(formatCell(true)).toBe('true')
  })
})
