import type { ConnectionEngine, InlineCompleteRequest } from '../../shared/types'

const SYSTEM =
  'You are a SQL/Cypher autocomplete inside a code editor. Output ONLY the text that should be ' +
  'inserted at the <CURSOR> to continue the query — no explanations, no markdown, no code fences, ' +
  'and do not repeat the text before the cursor. If nothing should be added, output nothing.'

function dialect(engine: ConnectionEngine): string {
  return engine === 'neo4j' ? 'Cypher' : `${engine} SQL`
}

/** Build the system + user prompt for an inline completion request. */
export function buildInlinePrompt(
  req: Pick<InlineCompleteRequest, 'prefix' | 'suffix' | 'engine' | 'schema'>
): { system: string; user: string } {
  const parts = [
    `Language: ${dialect(req.engine)}.`,
    req.schema ? `Schema:\n${req.schema}` : '',
    'Complete the query at the <CURSOR> marker. Return only the text to insert.',
    '',
    `${req.prefix}<CURSOR>${req.suffix}`,
  ].filter(Boolean)
  return { system: SYSTEM, user: parts.join('\n') }
}
