import { describe, it, expect } from 'vitest'
import { connectionLabel, engineAccent, engineColor } from '../../../renderer/src/lib/connectionMeta'
import type { Connection } from '../../../shared/types'

const base = { id: '1', name: 'c', createdAt: '2024-01-01T00:00:00.000Z' }

describe('connectionLabel', () => {
  it('BigQuery → projectId', () => {
    expect(connectionLabel({ ...base, engine: 'bigquery', projectId: 'proj-x' } as Connection)).toBe('proj-x')
  })
  it('Snowflake → account', () => {
    expect(connectionLabel({ ...base, engine: 'snowflake', account: 'acct-1' } as Connection)).toBe('acct-1')
  })
  it('Neo4j → database, falling back to uri', () => {
    expect(connectionLabel({ ...base, engine: 'neo4j', database: 'graph', uri: 'neo4j://h' } as Connection)).toBe('graph')
    expect(connectionLabel({ ...base, engine: 'neo4j', database: '', uri: 'neo4j://h' } as Connection)).toBe('neo4j://h')
  })
  it('Postgres → database, falling back to host', () => {
    expect(connectionLabel({ ...base, engine: 'postgres', database: 'db', host: 'h' } as Connection)).toBe('db')
  })
})

describe('engineAccent / engineColor', () => {
  it('map known engines', () => {
    expect(engineAccent('bigquery')).toBe('text-app-cat-blue')
    expect(engineAccent('snowflake')).toBe('text-app-accent-text')
    expect(engineAccent('postgres')).toBe('text-app-cat-purple')
    expect(engineAccent('neo4j')).toBe('text-app-cat-teal')
    expect(engineColor('bigquery')).toBe('text-app-cat-blue')
  })
  it('use distinct fallbacks for unknown engines', () => {
    expect(engineAccent('???')).toBe('text-app-text-3')
    expect(engineColor('???')).toBe('text-app-text')
  })
})
