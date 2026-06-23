import { describe, it, expect } from 'vitest'
import { typeColor } from '../../../renderer/src/lib/schemaTypeColor'

describe('typeColor', () => {
  it('maps string types to the green token', () => {
    expect(typeColor('STRING')).toBe('text-app-cat-green')
    expect(typeColor('BYTES')).toBe('text-app-cat-green')
  })

  it('maps numeric types to the blue token', () => {
    for (const t of ['INTEGER', 'INT64', 'FLOAT', 'FLOAT64', 'NUMERIC', 'BIGNUMERIC']) {
      expect(typeColor(t)).toBe('text-app-cat-blue')
    }
  })

  it('maps boolean types to the warn token', () => {
    expect(typeColor('BOOLEAN')).toBe('text-app-warn')
    expect(typeColor('BOOL')).toBe('text-app-warn')
  })

  it('maps temporal types to the purple token', () => {
    for (const t of ['TIMESTAMP', 'DATE', 'TIME', 'DATETIME']) {
      expect(typeColor(t)).toBe('text-app-cat-purple')
    }
  })

  it('maps record/struct types to the accent token', () => {
    expect(typeColor('RECORD')).toBe('text-app-accent-text')
    expect(typeColor('STRUCT')).toBe('text-app-accent-text')
  })

  it('falls back to the muted token for unknown types', () => {
    expect(typeColor('GEOGRAPHY')).toBe('text-app-text-2')
    expect(typeColor('')).toBe('text-app-text-2')
  })

  it('is case-insensitive', () => {
    expect(typeColor('string')).toBe('text-app-cat-green')
    expect(typeColor('int64')).toBe('text-app-cat-blue')
  })
})
