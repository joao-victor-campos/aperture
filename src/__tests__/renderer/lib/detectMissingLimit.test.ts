import { detectMissingLimit } from '../../../renderer/src/lib/detectMissingLimit'

describe('detectMissingLimit', () => {
  it('returns true for a SELECT without LIMIT', () => {
    expect(detectMissingLimit('SELECT * FROM users')).toBe(true)
  })

  it('returns false for a SELECT with LIMIT', () => {
    expect(detectMissingLimit('SELECT * FROM users LIMIT 10')).toBe(false)
  })

  it('returns false for case-insensitive LIMIT', () => {
    expect(detectMissingLimit('select * from users limit 50')).toBe(false)
  })

  it('returns true when LIMIT only appears in a subquery', () => {
    expect(detectMissingLimit('SELECT * FROM (SELECT * FROM t LIMIT 5)')).toBe(true)
  })

  it('returns false when outer query has LIMIT (subquery also has LIMIT)', () => {
    expect(detectMissingLimit('SELECT * FROM (SELECT * FROM t LIMIT 5) LIMIT 10')).toBe(false)
  })

  it('returns false for INSERT statements', () => {
    expect(detectMissingLimit('INSERT INTO t SELECT * FROM t2')).toBe(false)
  })

  it('returns false for CREATE TABLE statements', () => {
    expect(detectMissingLimit('CREATE TABLE t AS SELECT * FROM t2')).toBe(false)
  })

  it('returns false for UPDATE statements', () => {
    expect(detectMissingLimit('UPDATE users SET name = \'x\' WHERE id = 1')).toBe(false)
  })

  it('returns true for WITH...SELECT without LIMIT', () => {
    expect(detectMissingLimit('WITH cte AS (SELECT 1) SELECT * FROM cte')).toBe(true)
  })

  it('returns false for WITH...SELECT with LIMIT', () => {
    expect(detectMissingLimit('WITH cte AS (SELECT 1) SELECT * FROM cte LIMIT 100')).toBe(false)
  })

  it('ignores LIMIT in line comments', () => {
    expect(detectMissingLimit('-- LIMIT 10\nSELECT * FROM t')).toBe(true)
  })

  it('ignores LIMIT in block comments', () => {
    expect(detectMissingLimit('SELECT * FROM t /* LIMIT 10 */')).toBe(true)
  })

  it('ignores LIMIT inside string literals', () => {
    expect(detectMissingLimit("SELECT 'LIMIT 100' FROM t")).toBe(true)
  })

  it('returns false for empty input', () => {
    expect(detectMissingLimit('')).toBe(false)
  })

  it('returns false for whitespace-only input', () => {
    expect(detectMissingLimit('   ')).toBe(false)
  })

  it('handles multiline SELECT with LIMIT at end', () => {
    const sql = `
      SELECT
        id,
        name
      FROM users
      WHERE active = true
      LIMIT 1000
    `
    expect(detectMissingLimit(sql)).toBe(false)
  })

  it('handles multiline SELECT without LIMIT', () => {
    const sql = `
      SELECT
        id,
        name
      FROM users
      WHERE active = true
      ORDER BY name
    `
    expect(detectMissingLimit(sql)).toBe(true)
  })

  it('flags a MATCH … RETURN with no LIMIT', () => {
    expect(detectMissingLimit('MATCH (n:Person) RETURN n')).toBe(true)
  })

  it('does not flag a MATCH … RETURN that has a LIMIT', () => {
    expect(detectMissingLimit('MATCH (n:Person) RETURN n LIMIT 100')).toBe(false)
  })

  it('flags an OPTIONAL MATCH read query', () => {
    expect(detectMissingLimit('OPTIONAL MATCH (n) RETURN n')).toBe(true)
  })

  it('does not flag a Cypher write statement (CREATE)', () => {
    expect(detectMissingLimit('CREATE (n:Person {name: "Alice"}) RETURN n')).toBe(false)
  })
})
