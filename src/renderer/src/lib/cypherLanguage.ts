import { StreamLanguage, LanguageSupport, type StreamParser } from '@codemirror/language'
import { completeFromList, type CompletionSource } from '@codemirror/autocomplete'

const KEYWORDS = new Set([
  'MATCH', 'OPTIONAL', 'WHERE', 'RETURN', 'WITH', 'CREATE', 'MERGE', 'DELETE', 'DETACH',
  'REMOVE', 'SET', 'ORDER', 'BY', 'LIMIT', 'SKIP', 'UNWIND', 'CALL', 'YIELD', 'AS', 'ON',
  'AND', 'OR', 'XOR', 'NOT', 'IN', 'STARTS', 'ENDS', 'CONTAINS', 'IS', 'NULL', 'TRUE',
  'FALSE', 'DISTINCT', 'UNION', 'ALL', 'CASE', 'WHEN', 'THEN', 'ELSE', 'END', 'ASC',
  'DESC', 'FOREACH', 'USING', 'INDEX', 'CONSTRAINT', 'DROP', 'EXISTS', 'LOAD', 'CSV',
  'FROM', 'HEADERS',
])

const FUNCTIONS = new Set([
  'count', 'collect', 'sum', 'avg', 'min', 'max', 'size', 'length', 'type', 'id', 'labels',
  'keys', 'nodes', 'relationships', 'properties', 'tointeger', 'tofloat', 'tostring',
  'toboolean', 'coalesce', 'head', 'tail', 'last', 'range', 'reverse', 'substring',
  'replace', 'split', 'trim', 'tolower', 'toupper', 'abs', 'ceil', 'floor', 'round',
  'sqrt', 'rand', 'timestamp', 'date', 'datetime', 'duration', 'point',
])

// Stateless tokenizer — Cypher strings/comments here are single-line.
type CypherState = Record<string, never>

export const cypherParser: StreamParser<CypherState> = {
  startState: () => ({}),
  token(stream) {
    if (stream.eatSpace()) return null

    // Line comment
    if (stream.match('//')) {
      stream.skipToEnd()
      return 'comment'
    }
    // String literal (single- or double-quoted)
    const ch = stream.peek()
    if (ch === '"' || ch === "'") {
      stream.next()
      let escaped = false
      let c: string | void
      while ((c = stream.next()) != null) {
        if (c === ch && !escaped) break
        escaped = c === '\\' && !escaped
      }
      return 'string'
    }
    // Parameter ($name)
    if (stream.match(/^\$[A-Za-z_][A-Za-z0-9_]*/)) return 'atom'
    // Number
    if (stream.match(/^-?\d+\.?\d*/)) return 'number'
    // Label / relationship type (:Name)
    if (stream.match(/^:[A-Za-z_][A-Za-z0-9_]*/)) return 'typeName'
    // Word — keyword / function / identifier
    if (stream.match(/^[A-Za-z_][A-Za-z0-9_]*/)) {
      const word = stream.current()
      if (KEYWORDS.has(word.toUpperCase())) return 'keyword'
      if (FUNCTIONS.has(word.toLowerCase())) return 'variableName.function'
      return 'variableName'
    }
    // Brackets
    if (stream.match(/^[{}[\]()]/)) return 'bracket'
    // Operators / arrows
    if (stream.match(/^[-=<>!+*/%^.,|]+/)) return 'operator'

    stream.next()
    return null
  },
}

export interface CypherSchema {
  labels: string[]
  relationshipTypes: string[]
  propertyKeys: string[]
}

const KEYWORD_LIST = Array.from(KEYWORDS)
const FUNCTION_LIST = Array.from(FUNCTIONS)

/** Flat list of completion options — pure + unit-testable without a CompletionContext. */
export function buildCypherCompletionOptions(
  schema: CypherSchema,
): { label: string; type: string }[] {
  return [
    ...KEYWORD_LIST.map((label) => ({ label, type: 'keyword' })),
    ...FUNCTION_LIST.map((label) => ({ label, type: 'function' })),
    ...schema.labels.map((label) => ({ label, type: 'class' })),
    ...schema.relationshipTypes.map((label) => ({ label, type: 'type' })),
    ...schema.propertyKeys.map((label) => ({ label, type: 'property' })),
  ]
}

export function cypherCompletions(schema: CypherSchema): CompletionSource {
  return completeFromList(buildCypherCompletionOptions(schema))
}

/** Build the CodeMirror LanguageSupport for Cypher, with optional schema-aware autocomplete. */
export function cypher(schema?: CypherSchema): LanguageSupport {
  const language = StreamLanguage.define(cypherParser)
  const support = schema ? [language.data.of({ autocomplete: cypherCompletions(schema) })] : []
  return new LanguageSupport(language, support)
}
