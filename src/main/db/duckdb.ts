/**
 * DuckDB local in-memory engine.
 *
 * Used for local SQL processing and future BigQuery extension integration.
 * BigQuery queries currently go through the @google-cloud/bigquery client.
 * This module is prepared for when DuckDB's community BigQuery extension
 * matures enough to replace the direct client.
 */
import Database from 'duckdb'
import type { QueryResult } from '../../shared/types'

let db: Database.Database | null = null

function getDB(): Database.Database {
  if (!db) {
    db = new Database.Database(':memory:')
  }
  return db
}

export function executeLocal(sql: string): Promise<QueryResult> {
  return new Promise((resolve, reject) => {
    const start = Date.now()
    const conn = getDB().connect()
    conn.all(sql, (err, rows) => {
      conn.close()
      if (err) {
        reject(err)
        return
      }
      const columns = rows.length > 0 ? Object.keys(rows[0]) : []
      resolve({
        columns,
        rows: rows as Record<string, unknown>[],
        rowCount: rows.length,
        executionTimeMs: Date.now() - start
      })
    })
  })
}

export function closeDB(): void {
  if (db) {
    db.close(() => {})
    db = null
  }
}
