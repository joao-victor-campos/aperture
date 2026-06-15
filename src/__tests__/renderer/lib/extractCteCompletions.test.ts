import { describe, it, expect } from 'vitest'
import { extractCteCompletions, cteCompletionOptions } from '../../../renderer/src/lib/extractCteCompletions'

describe('extractCteCompletions', () => {
  it('parses a single CTE with simple columns', () => {
    const sql = 'WITH t AS (SELECT a, b FROM x) SELECT * FROM t'
    expect(extractCteCompletions(sql)).toEqual([{ name: 't', columns: ['a', 'b'] }])
  })

  it('uses AS aliases and trailing identifiers for column names', () => {
    const sql = 'WITH t AS (SELECT count(*) AS total, u.name FROM users u) SELECT * FROM t'
    expect(extractCteCompletions(sql)).toEqual([{ name: 't', columns: ['total', 'name'] }])
  })

  it('parses multiple CTEs', () => {
    const sql = 'WITH a AS (SELECT x FROM p), b AS (SELECT y FROM q) SELECT * FROM a'
    expect(extractCteCompletions(sql)).toEqual([
      { name: 'a', columns: ['x'] },
      { name: 'b', columns: ['y'] },
    ])
  })

  it('returns name with no columns for SELECT *', () => {
    const sql = 'WITH t AS (SELECT * FROM x) SELECT * FROM t'
    expect(extractCteCompletions(sql)).toEqual([{ name: 't', columns: [] }])
  })

  it('does not choke on nested parentheses in the body', () => {
    const sql = 'WITH t AS (SELECT coalesce(a, (b + 1)) AS c FROM x) SELECT * FROM t'
    expect(extractCteCompletions(sql)).toEqual([{ name: 't', columns: ['c'] }])
  })

  it('returns [] for SQL without a WITH clause', () => {
    expect(extractCteCompletions('SELECT * FROM users')).toEqual([])
    expect(extractCteCompletions('')).toEqual([])
  })
})

describe('cteCompletionOptions', () => {
  const sql = 'WITH t AS (SELECT a, b FROM x) SELECT  FROM t'

  it('offers a CTE column when completing after "cte."', () => {
    const opts = cteCompletionOptions(sql, 't.')
    expect(opts.map((o) => o.label).sort()).toEqual(['a', 'b'])
  })

  it('offers CTE names in a general position', () => {
    const opts = cteCompletionOptions(sql, 'FROM ')
    expect(opts.map((o) => o.label)).toContain('t')
  })

  it('returns [] when after an unknown alias dot', () => {
    expect(cteCompletionOptions(sql, 'zzz.')).toEqual([])
  })
})
