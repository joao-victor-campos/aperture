import { isGraphElement } from './formatGraphElement'

/**
 * True if any cell in any row is a serialized Neo4j Node, Relationship, or Path.
 * Used to decide whether to surface the "View as graph" banner above the
 * results table. Short-circuits on the first match.
 */
export function detectGraphShape(rows: Record<string, unknown>[]): boolean {
  for (const row of rows) {
    for (const value of Object.values(row)) {
      if (isGraphElement(value)) return true
    }
  }
  return false
}
