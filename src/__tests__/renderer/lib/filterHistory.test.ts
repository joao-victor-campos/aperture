import { describe, it, expect } from 'vitest'
import { filterHistory } from '../../../renderer/src/lib/filterHistory'
import type { HistoryEntry } from '@shared/types'

const entry = (over: Partial<HistoryEntry>): HistoryEntry => ({
  id: 'x',
  sql: 'SELECT 1',
  connectionId: 'c1',
  connectionName: 'prod-bq',
  executedAt: '2026-07-11T00:00:00.000Z',
  durationMs: 10,
  rowCount: 1,
  ...over,
})

describe('filterHistory', () => {
  const entries = [
    entry({ id: 'a', sql: 'SELECT * FROM users', connectionName: 'prod-bq' }),
    entry({ id: 'b', sql: 'SELECT count(*) FROM orders', connectionName: 'staging-pg' }),
  ]

  it('returns all entries for an empty query', () => {
    expect(filterHistory(entries, '')).toEqual(entries)
  })

  it('returns all entries for a whitespace query', () => {
    expect(filterHistory(entries, '   ')).toEqual(entries)
  })

  it('matches the SQL body (case-insensitive)', () => {
    const out = filterHistory(entries, 'ORDERS')
    expect(out.map((e) => e.id)).toEqual(['b'])
  })

  it('matches the connection name', () => {
    const out = filterHistory(entries, 'staging')
    expect(out.map((e) => e.id)).toEqual(['b'])
  })

  it('returns an empty array when nothing matches', () => {
    expect(filterHistory(entries, 'zzz')).toEqual([])
  })
})
