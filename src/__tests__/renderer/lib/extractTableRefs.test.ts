import { describe, it, expect } from 'vitest'
import { extractTableRefs } from '../../../renderer/src/lib/extractTableRefs'

describe('extractTableRefs', () => {
  it('finds a bare table after FROM', () => {
    expect(extractTableRefs('SELECT * FROM users')).toEqual([{ name: 'users' }])
  })

  it('finds a qualified dataset.table', () => {
    expect(extractTableRefs('SELECT * FROM analytics.users')).toEqual([{ name: 'analytics.users' }])
  })

  it('captures a bare alias and an AS alias', () => {
    expect(extractTableRefs('SELECT * FROM users u')).toEqual([{ name: 'users', alias: 'u' }])
    expect(extractTableRefs('SELECT * FROM users AS u')).toEqual([{ name: 'users', alias: 'u' }])
  })

  it('finds tables across JOINs', () => {
    const out = extractTableRefs('SELECT * FROM a JOIN b ON a.id = b.id LEFT JOIN c ON c.x = a.x')
    expect(out).toEqual([{ name: 'a' }, { name: 'b' }, { name: 'c' }])
  })

  it('handles UPDATE and INSERT INTO', () => {
    expect(extractTableRefs('UPDATE orders SET x = 1')).toEqual([{ name: 'orders' }])
    expect(extractTableRefs('INSERT INTO logs (a) VALUES (1)')).toEqual([{ name: 'logs' }])
  })

  it('does not treat the word after FROM as alias when it is a keyword', () => {
    expect(extractTableRefs('SELECT * FROM users WHERE id = 1')).toEqual([{ name: 'users' }])
    expect(extractTableRefs('SELECT * FROM users GROUP BY id')).toEqual([{ name: 'users' }])
  })

  it('ignores table-like text inside strings and comments', () => {
    expect(extractTableRefs("SELECT 'FROM ghost' FROM users")).toEqual([{ name: 'users' }])
    expect(extractTableRefs('-- FROM ghost\nSELECT * FROM users')).toEqual([{ name: 'users' }])
  })

  it('returns empty for partial / non-FROM SQL without throwing', () => {
    expect(extractTableRefs('SELECT ')).toEqual([])
    expect(extractTableRefs('FROM ')).toEqual([])
    expect(extractTableRefs('')).toEqual([])
  })
})
