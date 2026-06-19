import { describe, it, expect } from 'vitest'
import { buildInlinePrompt } from '../../../main/ai/buildInlinePrompt'

describe('buildInlinePrompt', () => {
  it('frames fill-in-the-middle with a cursor marker', () => {
    const { user } = buildInlinePrompt({ prefix: 'SELECT * FROM ', suffix: ' WHERE 1', engine: 'bigquery', schema: '' })
    expect(user).toContain('SELECT * FROM <CURSOR> WHERE 1')
  })

  it('names the SQL dialect and includes schema when present', () => {
    const { system, user } = buildInlinePrompt({
      prefix: 'SELECT ', suffix: '', engine: 'postgres', schema: 'orders(id, total)',
    })
    expect(system.toLowerCase()).toContain('autocomplete')
    expect(user).toContain('postgres SQL')
    expect(user).toContain('orders(id, total)')
  })

  it('uses Cypher for neo4j', () => {
    const { user } = buildInlinePrompt({ prefix: 'MATCH ', suffix: '', engine: 'neo4j', schema: '' })
    expect(user).toContain('Cypher')
  })

  it('omits the schema section when schema is empty', () => {
    const { user } = buildInlinePrompt({ prefix: 'SELECT 1', suffix: '', engine: 'bigquery', schema: '' })
    expect(user).not.toContain('Schema:')
  })
})
