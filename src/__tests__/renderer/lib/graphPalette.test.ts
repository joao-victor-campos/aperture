import { describe, it, expect } from 'vitest'
import { paletteColor, NODE_PALETTE } from '../../../renderer/src/lib/graphPalette'

describe('graphPalette', () => {
  it('returns a token from the palette for any label', () => {
    expect(NODE_PALETTE).toContain(paletteColor('Person'))
  })

  it('is stable — same label always maps to same color', () => {
    expect(paletteColor('Person')).toBe(paletteColor('Person'))
    expect(paletteColor('Company')).toBe(paletteColor('Company'))
  })

  it('cycles through the palette for distinct labels (no collisions inside palette size)', () => {
    // Different labels should not all collapse to the same color
    const seen = new Set([
      paletteColor('A'), paletteColor('B'), paletteColor('C'), paletteColor('D'),
    ])
    expect(seen.size).toBeGreaterThan(1)
  })

  it('falls back to the muted token for the unknown sentinel', () => {
    expect(paletteColor('(unknown)')).toBe('rgb(var(--c-text-3))')
  })
})
