import { describe, it, expect } from 'vitest'
import { StringStream } from '@codemirror/language'
import { cypherParser, buildCypherCompletionOptions } from '../../../renderer/src/lib/cypherLanguage'

function tokenize(line: string): { text: string; tag: string | null }[] {
  const state = cypherParser.startState!(4)
  const stream = new StringStream(line, 4, 4)
  const out: { text: string; tag: string | null }[] = []
  let guard = 0
  while (!stream.eol() && guard++ < 500) {
    stream.start = stream.pos
    const tag = cypherParser.token!(stream, state)
    if (stream.pos === stream.start) { stream.next(); continue }
    out.push({ text: line.slice(stream.start, stream.pos), tag })
  }
  return out
}

describe('cypherParser', () => {
  it('tags keywords, labels, and identifiers', () => {
    const tokens = tokenize('MATCH (n:Person) RETURN n')
    expect(tokens.find((t) => t.text === 'MATCH')?.tag).toBe('keyword')
    expect(tokens.find((t) => t.text === 'RETURN')?.tag).toBe('keyword')
    expect(tokens.find((t) => t.text === ':Person')?.tag).toBe('typeName')
    expect(tokens.find((t) => t.text === 'n')?.tag).toBe('variableName')
  })

  it('tags strings, numbers, parameters, and comments', () => {
    expect(tokenize('"hi"').find((t) => t.text === '"hi"')?.tag).toBe('string')
    expect(tokenize('42').find((t) => t.text === '42')?.tag).toBe('number')
    expect(tokenize('$id').find((t) => t.text === '$id')?.tag).toBe('atom')
    expect(tokenize('// note').find((t) => t.text === '// note')?.tag).toBe('comment')
  })

  it('tags known functions distinctly from plain identifiers', () => {
    expect(tokenize('count').find((t) => t.text === 'count')?.tag).toBe('variableName.function')
  })
})

describe('buildCypherCompletionOptions', () => {
  it('includes keywords, functions, and schema-derived items', () => {
    const opts = buildCypherCompletionOptions({
      labels: ['Person'],
      relationshipTypes: ['KNOWS'],
      propertyKeys: ['name'],
    })
    const labels = opts.map((o) => o.label)
    expect(labels).toContain('MATCH')
    expect(labels).toContain('count')
    expect(labels).toContain('Person')
    expect(labels).toContain('KNOWS')
    expect(labels).toContain('name')
  })
})
