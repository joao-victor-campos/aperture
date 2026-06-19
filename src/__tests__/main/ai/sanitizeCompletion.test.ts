import { describe, it, expect } from 'vitest'
import { sanitizeCompletion } from '../../../main/ai/sanitizeCompletion'

describe('sanitizeCompletion', () => {
  it('returns the text unchanged when clean', () => {
    expect(sanitizeCompletion('WHERE id = 1', 'SELECT * FROM t ')).toBe('WHERE id = 1')
  })

  it('strips code fences', () => {
    expect(sanitizeCompletion('```sql\nWHERE id = 1\n```', 'SELECT * FROM t ')).toBe('WHERE id = 1')
  })

  it('strips a leading echo of the prefix last line', () => {
    expect(sanitizeCompletion('SELECT id FROM t', 'SELECT ')).toBe('id FROM t')
  })

  it('collapses whitespace-only output to empty', () => {
    expect(sanitizeCompletion('   \n  ', 'SELECT 1')).toBe('')
  })

  it('caps the number of lines', () => {
    const long = Array.from({ length: 20 }, (_, i) => `line${i}`).join('\n')
    expect(sanitizeCompletion(long, '', 3).split('\n')).toHaveLength(3)
  })

  it('returns empty for empty input', () => {
    expect(sanitizeCompletion('', 'SELECT 1')).toBe('')
  })
})
