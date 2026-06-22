import { describe, it, expect } from 'vitest'
import { formatBytes } from '../../../renderer/src/lib/formatBytes'

describe('formatBytes', () => {
  it('formats < 1MB as KB', () => { expect(formatBytes(2_000)).toBe('2.0 KB') })
  it('formats < 1GB as MB', () => { expect(formatBytes(2_000_000)).toBe('2.0 MB') })
  it('formats >= 1GB as GB', () => { expect(formatBytes(2_000_000_000)).toBe('2.00 GB') })
})
