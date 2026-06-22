import type {
  BigQueryConnection, Connection, Neo4jConnection, PostgresConnection, SnowflakeConnection,
} from '@shared/types'

export function connectionLabel(c: Connection): string {
  const engine = c.engine ?? 'bigquery'
  if (engine === 'bigquery') return (c as BigQueryConnection).projectId
  if (engine === 'snowflake') return (c as SnowflakeConnection).account
  if (engine === 'neo4j') return (c as Neo4jConnection).database || (c as Neo4jConnection).uri
  return (c as PostgresConnection).database ?? (c as PostgresConnection).host
}

/** Categorical accent used in the dropdown row subtitle (unknown → muted text-3). */
export function engineAccent(engine: string): string {
  if (engine === 'bigquery') return 'text-app-cat-blue'
  if (engine === 'snowflake') return 'text-app-accent-text'
  if (engine === 'postgres') return 'text-app-cat-purple'
  if (engine === 'neo4j') return 'text-app-cat-teal'
  return 'text-app-text-3'
}

/** Accent for the breadcrumb engine name (unknown → default text). */
export function engineColor(engine: string): string {
  if (engine === 'bigquery') return 'text-app-cat-blue'
  if (engine === 'snowflake') return 'text-app-accent-text'
  if (engine === 'postgres') return 'text-app-cat-purple'
  if (engine === 'neo4j') return 'text-app-cat-teal'
  return 'text-app-text'
}
