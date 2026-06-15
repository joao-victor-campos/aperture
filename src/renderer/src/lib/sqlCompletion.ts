import { sql, PostgreSQL, StandardSQL } from '@codemirror/lang-sql'
import type { Completion, CompletionContext, CompletionResult } from '@codemirror/autocomplete'
import type { Extension } from '@codemirror/state'
import type { ConnectionEngine } from '@shared/types'
import { cteCompletionOptions } from './extractCteCompletions'

const CM_DIALECT_MAP = {
  bigquery: StandardSQL,
  postgres: PostgreSQL,
  snowflake: StandardSQL,
  neo4j: StandardSQL, // unused — Cypher uses its own StreamLanguage
} satisfies Record<ConnectionEngine, typeof StandardSQL>

/**
 * Completion source for CTE names + their output columns, derived live from the
 * document. Layered on top of lang-sql's schema source (both contribute).
 */
function cteSource(context: CompletionContext): CompletionResult | null {
  const word = context.matchBefore(/[\w.]*/)
  if (!word || (word.from === word.to && !context.explicit)) return null
  const doc = context.state.doc.toString()
  const textBefore = doc.slice(0, context.pos)
  const options = cteCompletionOptions(doc, textBefore)
  if (options.length === 0) return null
  // When completing after "alias.", replace only the part after the dot.
  const dot = word.text.lastIndexOf('.')
  const from = dot === -1 ? word.from : word.from + dot + 1
  return {
    from,
    options: options.map((o): Completion => ({ label: o.label, type: o.type })),
    validFor: /^[\w]*$/,
  }
}

/**
 * Build the SQL language support for a given engine + schema, with lang-sql's
 * schema-aware completion (tables, columns, FROM-alias resolution) plus the
 * custom CTE source layered in via language data.
 */
export function sqlSupport(
  engine: ConnectionEngine | undefined,
  sqlSchema: Record<string, string[]> | undefined,
): Extension {
  const base = sql({
    dialect: engine ? CM_DIALECT_MAP[engine] : StandardSQL,
    schema: sqlSchema ?? {},
    upperCaseKeywords: true,
  })
  return [base, base.language.data.of({ autocomplete: cteSource })]
}
