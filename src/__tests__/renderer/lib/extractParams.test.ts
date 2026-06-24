import { describe, it, expect } from 'vitest'
import { extractParams } from '@renderer/lib/extractParams'

describe('extractParams', () => {
  it('returns [] when there are no params', () => {
    expect(extractParams('SELECT 1')).toEqual([])
  })

  it('extracts a single param', () => {
    expect(extractParams('SELECT * FROM t WHERE a = {{country}}')).toEqual(['country'])
  })

  it('de-duplicates and preserves first-seen order', () => {
    expect(extractParams('SELECT {{b}}, {{a}} FROM t WHERE x = {{a}}')).toEqual(['b', 'a'])
  })

  it('tolerates whitespace inside the braces', () => {
    expect(extractParams('WHERE a = {{ start_date }}')).toEqual(['start_date'])
  })

  it('ignores {{...}} inside a single-quoted string literal', () => {
    expect(extractParams("SELECT '{{notparam}}' AS lit, {{real}}")).toEqual(['real'])
  })

  it('ignores {{...}} inside a line comment', () => {
    expect(extractParams('SELECT 1 -- {{nope}}\nWHERE a = {{yes}}')).toEqual(['yes'])
  })

  it('ignores {{...}} inside a block comment', () => {
    expect(extractParams('SELECT /* {{nope}} */ {{yes}}')).toEqual(['yes'])
  })

  it('does not match invalid names (leading digit, dashes)', () => {
    expect(extractParams('SELECT {{1bad}}, {{a-b}}')).toEqual([])
  })

  it('matches two adjacent params', () => {
    expect(extractParams('{{a}}{{b}}')).toEqual(['a', 'b'])
  })
})
