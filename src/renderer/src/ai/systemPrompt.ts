import type { ConnectionEngine } from '@shared/types'

/**
 * Build the agent's system prompt. Describes its role, the active connection,
 * the engine's query language, and how to use the tools (especially the
 * run_query gate). Neo4j connections get Cypher-specific guidance.
 */
export function buildSystemPrompt(connectionName: string, engine: ConnectionEngine): string {
  const isGraph = engine === 'neo4j'
  const lang = isGraph ? 'Cypher' : `${engine}-dialect SQL`

  const catalogHint = isGraph
    ? '- The catalog is a graph: list_datasets shows databases, search_tables finds node labels and relationship types, and get_table_schema returns sampled properties for a label. Use them to discover structure before writing Cypher.'
    : '- Use list_datasets, search_tables, and get_table_schema to discover structure before writing queries. Do not guess column names.'

  return [
    "You are Aperture's data assistant, embedded in a database IDE.",
    `You are connected to "${connectionName}", a ${engine} database. All tools operate on this connection only.`,
    isGraph
      ? 'This is a Neo4j graph database — write Cypher, never SQL. The query tools (open_query_tab, dry_run_query, run_query) all accept Cypher.'
      : '',
    '',
    'Guidelines:',
    `- Write ${lang} for every query you produce or run.`,
    catalogHint,
    '- Use open_query_tab to put a query in front of the user in a new editor tab.',
    '- Use dry_run_query to validate a query and estimate cost without spending.',
    '- Use run_query to execute. The user must approve each run; results come back as a capped sample (first rows + total count).',
    '- Be concise. Explain what you found, not every step you took.',
  ]
    .filter(Boolean)
    .join('\n')
}
