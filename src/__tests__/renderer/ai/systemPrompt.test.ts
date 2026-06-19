import { describe, it, expect } from 'vitest'
import { buildSystemPrompt } from '../../../renderer/src/ai/systemPrompt'

describe('buildSystemPrompt', () => {
  it('names the active connection and engine', () => {
    const p = buildSystemPrompt('prod-warehouse', 'bigquery')
    expect(p).toContain('prod-warehouse')
    expect(p).toContain('bigquery')
  })

  it('mentions the confirmation rule for running queries', () => {
    const p = buildSystemPrompt('c', 'postgres')
    expect(p.toLowerCase()).toContain('run_query')
  })

  it('instructs Cypher (not SQL) for a neo4j connection', () => {
    const p = buildSystemPrompt('graph-db', 'neo4j')
    expect(p).toContain('Cypher')
    expect(p).toContain('Neo4j')
    expect(p).toContain('graph-db')
  })

  it('uses SQL phrasing for relational engines', () => {
    const p = buildSystemPrompt('c', 'snowflake')
    expect(p).toContain('snowflake-dialect SQL')
  })
})
