import { describe, it, expect } from 'vitest'
import { buildSelectQuery } from '../../../renderer/src/lib/buildSelectQuery'

describe('buildSelectQuery', () => {
  describe('BigQuery', () => {
    it('produces a backtick-quoted project.dataset.table reference', () => {
      const sql = buildSelectQuery('bigquery', 'my-project', 'my_dataset', 'my_table')
      expect(sql).toBe('SELECT * FROM `my-project.my_dataset.my_table` LIMIT 100')
    })

    it('includes the project id in the reference', () => {
      const sql = buildSelectQuery('bigquery', 'acme-prod', 'analytics', 'events')
      expect(sql).toContain('acme-prod.analytics.events')
    })
  })

  describe('Snowflake', () => {
    it('splits datasetId on "." and double-quotes each part', () => {
      const sql = buildSelectQuery('snowflake', 'myaccount', 'MYDB.PUBLIC', 'ORDERS')
      expect(sql).toBe('SELECT * FROM "MYDB"."PUBLIC"."ORDERS" LIMIT 100')
    })

    it('handles a dataset without a dot (single-part schema)', () => {
      const sql = buildSelectQuery('snowflake', 'myaccount', 'SCHEMA_ONLY', 'USERS')
      expect(sql).toBe('SELECT * FROM "SCHEMA_ONLY"."USERS" LIMIT 100')
    })

    it('escapes embedded double-quotes in identifiers', () => {
      const sql = buildSelectQuery('snowflake', 'acct', 'DB."weird"', 'TABLE')
      expect(sql).toContain('"DB"')
      expect(sql).toContain('""weird""')
    })
  })

  describe('Postgres', () => {
    it('double-quotes schema and table', () => {
      const sql = buildSelectQuery('postgres', '', 'public', 'users')
      expect(sql).toBe('SELECT * FROM "public"."users" LIMIT 100')
    })

    it('escapes double-quotes in identifiers', () => {
      const sql = buildSelectQuery('postgres', '', 'my"schema', 'my"table')
      expect(sql).toBe('SELECT * FROM "my""schema"."my""table" LIMIT 100')
    })

    it('always appends LIMIT 100', () => {
      const sql = buildSelectQuery('postgres', '', 'public', 'orders')
      expect(sql).toMatch(/LIMIT 100$/)
    })
  })
})
