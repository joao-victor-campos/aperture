import { describe, it, expect } from 'vitest'
import { EditorState } from '@codemirror/state'
import { CompletionContext, type CompletionResult, type CompletionSource } from '@codemirror/autocomplete'
import type { ConnectionEngine } from '@shared/types'
import { sqlSupport } from '../../../renderer/src/lib/sqlCompletion'

/**
 * Build an EditorState from the extension under test and collect the completion
 * results from every autocomplete source registered via language data (lang-sql's
 * schema source plus our custom CTE source). `cursor` is the offset to complete at
 * (defaults to end of doc).
 */
function completionsAt(
  doc: string,
  engine: ConnectionEngine | undefined,
  schema: Record<string, string[]> | undefined,
  cursor = doc.length,
  explicit = true,
): CompletionResult[] {
  const state = EditorState.create({ doc, extensions: [sqlSupport(engine, schema)] })
  const sources = state.languageDataAt<CompletionSource>('autocomplete', cursor)
  const ctx = new CompletionContext(state, cursor, explicit)
  const results: CompletionResult[] = []
  for (const src of sources) {
    const r = src(ctx)
    if (r && 'options' in r) results.push(r as CompletionResult)
  }
  return results
}

function allLabels(results: CompletionResult[]): string[] {
  return results.flatMap((r) => r.options.map((o) => o.label))
}

describe('sqlSupport', () => {
  it('returns a non-empty extension array', () => {
    const ext = sqlSupport('bigquery', {})
    expect(Array.isArray(ext)).toBe(true)
    expect((ext as unknown[]).length).toBeGreaterThan(0)
  })

  it('builds without throwing for every engine dialect', () => {
    const engines: ConnectionEngine[] = ['bigquery', 'postgres', 'snowflake', 'neo4j']
    for (const engine of engines) {
      expect(() => sqlSupport(engine, { users: ['id', 'name'] })).not.toThrow()
    }
  })

  it('defaults to a usable dialect when engine is undefined', () => {
    expect(() => sqlSupport(undefined, undefined)).not.toThrow()
  })

  describe('CTE completion source', () => {
    it('offers CTE names where a table is expected', () => {
      const doc = 'WITH cte_a AS (SELECT 1 AS x) SELECT * FROM cte'
      const labels = allLabels(completionsAt(doc, 'bigquery', {}))
      expect(labels).toContain('cte_a')
    })

    it('offers a CTE column after "cte." ', () => {
      const doc = 'WITH cte_a AS (SELECT id, total FROM t) SELECT cte_a.'
      const labels = allLabels(completionsAt(doc, 'bigquery', {}))
      expect(labels).toContain('id')
      expect(labels).toContain('total')
    })

    it('replaces only the segment after the dot for "alias." completions', () => {
      const doc = 'WITH cte_a AS (SELECT id FROM t) SELECT cte_a.'
      const results = completionsAt(doc, 'bigquery', {})
      const cteResult = results.find((r) => r.options.some((o) => o.label === 'id'))
      expect(cteResult).toBeDefined()
      // `from` should point just past the dot, not at the start of "cte_a".
      expect(cteResult!.from).toBe(doc.length)
    })

    it('contributes nothing extra when the query has no CTEs', () => {
      const doc = 'SELECT * FROM '
      const results = completionsAt(doc, 'bigquery', { orders: ['id'] })
      // No CTE source result; the only labels (if any) come from lang-sql's schema source.
      expect(allLabels(results)).not.toContain('cte_a')
    })
  })

  describe('schema-aware completion', () => {
    it('offers schema table names from lang-sql in table position', () => {
      const doc = 'SELECT * FROM '
      const labels = allLabels(completionsAt(doc, 'postgres', { customers: ['id', 'email'] }))
      expect(labels).toContain('customers')
    })
  })
})
