import { describe, it, expect } from 'vitest'
import { substituteParams } from '@renderer/lib/substituteParams'
import type { QueryParam } from '@shared/types'

const p = (name: string, type: QueryParam['type'], value: string): QueryParam => ({ name, type, value })

describe('substituteParams', () => {
  it('quotes and escapes text values', () => {
    const r = substituteParams('WHERE name = {{n}}', [p('n', 'text', "O'Brien")])
    expect(r).toEqual({ sql: "WHERE name = 'O''Brien'" })
  })

  it('inserts numbers verbatim', () => {
    expect(substituteParams('LIMIT {{lim}}', [p('lim', 'number', '100')])).toEqual({ sql: 'LIMIT 100' })
  })

  it('errors on a non-numeric number value', () => {
    expect(substituteParams('LIMIT {{lim}}', [p('lim', 'number', 'abc')])).toEqual({
      error: '{{lim}} is not a valid number.',
    })
  })

  it('renders booleans lowercase and unquoted', () => {
    expect(substituteParams('WHERE active = {{a}}', [p('a', 'boolean', 'TRUE')])).toEqual({
      sql: 'WHERE active = true',
    })
  })

  it('errors on a non-boolean boolean value', () => {
    expect(substituteParams('WHERE a = {{a}}', [p('a', 'boolean', 'yes')])).toEqual({
      error: '{{a}} must be true or false.',
    })
  })

  it('inserts raw values verbatim (no quoting)', () => {
    const r = substituteParams('WHERE id IN ({{ids}})', [p('ids', 'raw', '1, 2, 3')])
    expect(r).toEqual({ sql: 'WHERE id IN (1, 2, 3)' })
  })

  it('allows an empty raw value (inserts nothing)', () => {
    expect(substituteParams('SELECT 1 {{tail}}', [p('tail', 'raw', '')])).toEqual({ sql: 'SELECT 1 ' })
  })

  it('errors on an empty text value', () => {
    expect(substituteParams('WHERE a = {{a}}', [p('a', 'text', '')])).toEqual({
      error: 'Fill in {{a}} before running.',
    })
  })

  it('tolerates whitespace inside the braces', () => {
    expect(substituteParams('WHERE a = {{ a }}', [p('a', 'number', '5')])).toEqual({ sql: 'WHERE a = 5' })
  })

  it('leaves unknown tokens verbatim', () => {
    expect(substituteParams('SELECT {{x}}', [])).toEqual({ sql: 'SELECT {{x}}' })
  })

  it('substitutes multiple params in one query', () => {
    const r = substituteParams('WHERE a = {{a}} AND b = {{b}}', [p('a', 'text', 'x'), p('b', 'number', '2')])
    expect(r).toEqual({ sql: "WHERE a = 'x' AND b = 2" })
  })
})
