import { describe, it, expect } from 'vitest'
import { compareSemver } from '../../../main/updates/compareSemver'

describe('compareSemver', () => {
  it('returns 1 when a is newer (patch)', () => {
    expect(compareSemver('2.3.1', '2.3.0')).toBe(1)
  })

  it('returns 1 when a is newer (minor / major)', () => {
    expect(compareSemver('2.4.0', '2.3.9')).toBe(1)
    expect(compareSemver('3.0.0', '2.9.9')).toBe(1)
  })

  it('returns -1 when a is older', () => {
    expect(compareSemver('2.3.0', '2.3.1')).toBe(-1)
  })

  it('returns 0 when equal', () => {
    expect(compareSemver('2.3.0', '2.3.0')).toBe(0)
  })

  it('strips a leading v on either side', () => {
    expect(compareSemver('v2.4.0', '2.3.0')).toBe(1)
    expect(compareSemver('2.4.0', 'v2.3.0')).toBe(1)
  })

  it('ignores a prerelease suffix on the numeric core', () => {
    expect(compareSemver('2.4.0-beta.1', '2.3.0')).toBe(1)
  })

  it('returns 0 for unparseable input (never a false update)', () => {
    expect(compareSemver('not-a-version', '2.3.0')).toBe(0)
    expect(compareSemver('2.3.0', 'garbage')).toBe(0)
  })
})
