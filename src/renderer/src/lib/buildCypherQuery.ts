/**
 * Cypher analogue of buildSelectQuery — generates a "show me this label /
 * relationship type" starter query for the catalog's "Query …" actions.
 */
export function buildLabelQuery(label: string): string {
  return `MATCH (n:${quoteCypherIdent(label)}) RETURN n LIMIT 100`
}

export function buildRelationshipTypeQuery(relType: string): string {
  return `MATCH ()-[r:${quoteCypherIdent(relType)}]->() RETURN r LIMIT 100`
}

/** Backtick-quote a Cypher identifier, escaping embedded backticks. */
export function quoteCypherIdent(ident: string): string {
  return `\`${ident.replace(/`/g, '``')}\``
}
