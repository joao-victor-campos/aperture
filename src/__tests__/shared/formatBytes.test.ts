import { describe, it, expect } from 'vitest'
import { formatBytes } from '@shared/formatBytes'

describe('formatBytes', () => {
  it('formats zero as 0.0 KB', () => {
    expect(formatBytes(0)).toBe('0.0 KB')
  })
  it('formats < 1MB as KB (one decimal)', () => {
    expect(formatBytes(2_000)).toBe('2.0 KB')
  })
  it('formats < 1GB as MB (one decimal)', () => {
    expect(formatBytes(2_000_000)).toBe('2.0 MB')
  })
  it('formats >= 1GB as GB (two decimals)', () => {
    expect(formatBytes(2_000_000_000)).toBe('2.00 GB')
  })
  it('keeps very large values in GB', () => {
    expect(formatBytes(5_000_000_000_000)).toBe('5000.00 GB')
  })
})
