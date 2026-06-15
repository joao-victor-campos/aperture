import { describe, it, expect } from 'vitest'
import { buildTableLookup } from '../../../renderer/src/lib/buildTableLookup'
import type { Table } from '../../../shared/types'

const t = (over: Partial<Table>): Table => ({
  id: 'users', datasetId: 'analytics', projectId: 'proj', name: 'users', type: 'TABLE', ...over,
})

describe('buildTableLookup', () => {
  it('maps bare and qualified names (case-insensitive) to ids', () => {
    const tablesByDataset = {
      'conn1:analytics': [t({})],
    }
    const lookup = buildTableLookup('conn1', tablesByDataset)
    expect(lookup.get('users')).toEqual({ projectId: 'proj', datasetId: 'analytics', tableId: 'users' })
    expect(lookup.get('analytics.users')).toEqual({ projectId: 'proj', datasetId: 'analytics', tableId: 'users' })
    expect(lookup.get('USERS')).toBeUndefined() // keys are lowercased; caller lowercases lookups
  })

  it('only includes tables for the given connection', () => {
    const tablesByDataset = {
      'conn1:analytics': [t({})],
      'conn2:other': [t({ datasetId: 'other', name: 'ghost', id: 'ghost' })],
    }
    const lookup = buildTableLookup('conn1', tablesByDataset)
    expect(lookup.get('ghost')).toBeUndefined()
    expect([...lookup.keys()]).toContain('users')
  })

  it('returns an empty map when nothing is loaded', () => {
    expect(buildTableLookup('conn1', {}).size).toBe(0)
  })
})
