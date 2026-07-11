import type { ConnectionEngine } from '@shared/types'
import { buildSelectQuery } from './buildSelectQuery'
import { buildLabelQuery, buildRelationshipTypeQuery } from './buildCypherQuery'

/**
 * Builds the "Query table" starter query used by the catalog context menu and
 * the table detail page. SQL engines get a `SELECT * … LIMIT 100`; Neo4j gets a
 * label or relationship-type Cypher query depending on `tableType`.
 */
export function buildTableQuery(
  engine: ConnectionEngine,
  projectId: string,
  datasetId: string,
  tableId: string,
  tableType?: string,
): string {
  if (engine === 'neo4j') {
    return tableType === 'RELATIONSHIP_TYPE'
      ? buildRelationshipTypeQuery(tableId)
      : buildLabelQuery(tableId)
  }
  return buildSelectQuery(engine, projectId, datasetId, tableId)
}
