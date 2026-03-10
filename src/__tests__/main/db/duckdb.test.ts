/**
 * duckdb.test.ts
 * Integration tests for the local DuckDB engine (src/main/db/duckdb.ts).
 * Uses the real native module — no mocking needed.
 */
import { describe, it, expect, afterAll } from 'vitest'
import { executeLocal, closeDB } from '../../../main/db/duckdb'

describe('DuckDB local engine', () => {
  // Close the database after all tests to free the native resource
  afterAll(() => closeDB())

  describe('executeLocal', () => {
    it('executes a simple SELECT and returns correct columns and rows', async () => {
      // Arrange / Act
      const result = await executeLocal('SELECT 42 AS answer, true AS flag')

      // Assert
      expect(result.columns).toEqual(['answer', 'flag'])
      expect(result.rowCount).toBe(1)
      expect(result.rows[0]).toMatchObject({ answer: 42, flag: true })
      expect(result.executionTimeMs).toBeGreaterThanOrEqual(0)
    })

    it('returns multiple rows', async () => {
      // Arrange / Act
      const result = await executeLocal(
        "SELECT 1 AS n UNION ALL SELECT 2 UNION ALL SELECT 3 ORDER BY n"
      )

      // Assert
      expect(result.rowCount).toBe(3)
      expect(result.columns).toContain('n')
      expect(result.rows.map((r) => r.n)).toEqual([1, 2, 3])
    })

    it('returns empty columns and rows when the result set is empty', async () => {
      // Arrange / Act
      const result = await executeLocal('SELECT 1 AS x WHERE false')

      // Assert — no rows means columns array is also empty (see implementation)
      expect(result.rowCount).toBe(0)
      expect(result.rows).toEqual([])
      expect(result.columns).toEqual([])
    })

    it('rejects on invalid SQL', async () => {
      // Arrange / Act / Assert
      await expect(executeLocal('THIS IS NOT VALID SQL')).rejects.toThrow()
    })

    it('correctly records execution time', async () => {
      // Act
      const result = await executeLocal('SELECT 1')

      // Assert — execution time is a non-negative number
      expect(typeof result.executionTimeMs).toBe('number')
      expect(result.executionTimeMs).toBeGreaterThanOrEqual(0)
    })
  })

  describe('closeDB', () => {
    it('can be called multiple times without throwing', () => {
      // Act / Assert
      expect(() => {
        closeDB()
        closeDB()
      }).not.toThrow()
    })
  })
})
