import { describe, it, expect } from 'vitest'
import { buildTableQuery } from '../../../renderer/src/lib/buildTableQuery'

describe('buildTableQuery', () => {
  it('delegates to buildSelectQuery for BigQuery', () => {
    expect(buildTableQuery('bigquery', 'proj', 'ds', 'tbl')).toBe(
      'SELECT * FROM `proj.ds.tbl` LIMIT 100',
    )
  })

  it('delegates to buildSelectQuery for Snowflake', () => {
    expect(buildTableQuery('snowflake', 'acct', 'DB.PUBLIC', 'ORDERS')).toBe(
      'SELECT * FROM "DB"."PUBLIC"."ORDERS" LIMIT 100',
    )
  })

  it('delegates to buildSelectQuery for Postgres', () => {
    expect(buildTableQuery('postgres', 'proj', 'public', 'users')).toBe(
      'SELECT * FROM "public"."users" LIMIT 100',
    )
  })

  it('builds a label query for a Neo4j LABEL', () => {
    expect(buildTableQuery('neo4j', '', '', 'Person', 'LABEL')).toBe(
      'MATCH (n:`Person`) RETURN n LIMIT 100',
    )
  })

  it('builds a relationship query for a Neo4j RELATIONSHIP_TYPE', () => {
    expect(buildTableQuery('neo4j', '', '', 'KNOWS', 'RELATIONSHIP_TYPE')).toBe(
      'MATCH ()-[r:`KNOWS`]->() RETURN r LIMIT 100',
    )
  })

  it('defaults a Neo4j table without a type to a label query', () => {
    expect(buildTableQuery('neo4j', '', '', 'Person')).toBe(
      'MATCH (n:`Person`) RETURN n LIMIT 100',
    )
  })
})
