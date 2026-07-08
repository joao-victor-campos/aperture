import { describe, expect, it } from 'vitest'
import { validateParam, validateParams } from '@renderer/lib/validateParams'
import type { QueryParam } from '@shared/types'

const p = (over: Partial<QueryParam>): QueryParam => ({ name: 'x', type: 'text', value: '', ...over })

describe('validateParam', () => {
  it('flags empty text/number/boolean with the fill-in message', () => {
    expect(validateParam(p({ type: 'text', value: '' }))).toBe('Fill in {{x}} before running.')
    expect(validateParam(p({ type: 'number', value: '  ' }))).toBe('Fill in {{x}} before running.')
    expect(validateParam(p({ type: 'boolean', value: '' }))).toBe('Fill in {{x}} before running.')
  })

  it('accepts a non-empty text value', () => {
    expect(validateParam(p({ type: 'text', value: 'hello' }))).toBeNull()
  })

  it('rejects a non-numeric number value', () => {
    expect(validateParam(p({ type: 'number', value: 'abc' }))).toBe('{{x}} is not a valid number.')
    expect(validateParam(p({ type: 'number', value: '42' }))).toBeNull()
  })

  it('rejects a non-boolean boolean value, case-insensitively', () => {
    expect(validateParam(p({ type: 'boolean', value: 'yes' }))).toBe('{{x}} must be true or false.')
    expect(validateParam(p({ type: 'boolean', value: 'TRUE' }))).toBeNull()
    expect(validateParam(p({ type: 'boolean', value: 'false' }))).toBeNull()
  })

  it('allows an empty raw value', () => {
    expect(validateParam(p({ type: 'raw', value: '' }))).toBeNull()
  })
})

describe('validateParams', () => {
  it('returns one entry per invalid param, in order', () => {
    const params: QueryParam[] = [
      p({ name: 'a', type: 'text', value: 'ok' }),
      p({ name: 'b', type: 'number', value: 'nope' }),
      p({ name: 'c', type: 'text', value: '' }),
    ]
    expect(validateParams(params)).toEqual([
      { name: 'b', message: '{{b}} is not a valid number.' },
      { name: 'c', message: 'Fill in {{c}} before running.' },
    ])
  })

  it('returns an empty array when all params are valid', () => {
    expect(validateParams([p({ type: 'raw', value: '' }), p({ name: 'n', type: 'number', value: '1' })])).toEqual([])
  })
})
