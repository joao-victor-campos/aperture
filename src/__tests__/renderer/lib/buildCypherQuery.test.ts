import { describe, it, expect } from 'vitest'
import { buildLabelQuery, buildRelationshipTypeQuery, quoteCypherIdent } from '../../../renderer/src/lib/buildCypherQuery'

describe('buildCypherQuery', () => {
  it('builds a node MATCH for a label', () => {
    expect(buildLabelQuery('Person')).toBe('MATCH (n:`Person`) RETURN n LIMIT 100')
  })

  it('builds a relationship MATCH for a relationship type', () => {
    expect(buildRelationshipTypeQuery('KNOWS')).toBe('MATCH ()-[r:`KNOWS`]->() RETURN r LIMIT 100')
  })

  it('escapes backticks in identifiers', () => {
    expect(quoteCypherIdent('we`ird')).toBe('`we``ird`')
  })
})
