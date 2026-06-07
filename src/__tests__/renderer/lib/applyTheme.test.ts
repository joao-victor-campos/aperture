/**
 * applyTheme.test.ts
 * Tests the pure token-mapping + CSS injection utility.
 */
import { describe, it, expect, beforeEach } from 'vitest'
import type { Theme } from '../../../shared/types'

let applyTheme: typeof import('../../../renderer/src/lib/applyTheme').applyTheme
let hexToRgb: typeof import('../../../renderer/src/lib/applyTheme').hexToRgb
let blend: typeof import('../../../renderer/src/lib/applyTheme').blend
let bootstrapTheme: typeof import('../../../renderer/src/lib/applyTheme').bootstrapTheme

beforeEach(async () => {
  ;({ applyTheme, hexToRgb, blend, bootstrapTheme } = await import('../../../renderer/src/lib/applyTheme'))
  // Reset DOM between tests
  document.head.innerHTML = ''
  document.documentElement.className = ''
  localStorage.clear()
})

function makeTheme(overrides: Partial<Theme['base']> = {}): Theme {
  const base: Record<string, string> = {}
  for (let i = 0; i <= 0x0f; i++) {
    const k = `base0${i.toString(16).toUpperCase()}`
    base[k] = `0${i.toString(16)}${i.toString(16)}${i.toString(16)}${i.toString(16)}${i.toString(16)}`
  }
  return {
    id: 't1',
    name: 'Test',
    base: { ...base, ...overrides },
    importedAt: '2026-06-06T00:00:00.000Z',
  }
}

describe('hexToRgb', () => {
  it('parses a 6-char hex string', () => {
    expect(hexToRgb('ff0000')).toEqual([255, 0, 0])
    expect(hexToRgb('00ff00')).toEqual([0, 255, 0])
    expect(hexToRgb('1a2b3c')).toEqual([26, 43, 60])
  })

  it('strips a leading # and is case-insensitive', () => {
    expect(hexToRgb('#FFFFFF')).toEqual([255, 255, 255])
    expect(hexToRgb('#AbCdEf')).toEqual([171, 205, 239])
  })
})

describe('blend', () => {
  it('returns the bg colour at alpha 0', () => {
    expect(blend([100, 100, 100], [200, 200, 200], 0)).toBe('100 100 100')
  })

  it('returns the fg colour at alpha 1', () => {
    expect(blend([100, 100, 100], [200, 200, 200], 1)).toBe('200 200 200')
  })

  it('linearly interpolates at alpha 0.5', () => {
    expect(blend([0, 0, 0], [200, 100, 50], 0.5)).toBe('100 50 25')
  })

  it('rounds to the nearest integer', () => {
    expect(blend([0, 0, 0], [101, 101, 101], 0.5)).toBe('51 51 51') // 50.5 → 51
  })
})

describe('applyTheme', () => {
  it('injects a <style id="aperture-theme"> tag with :root variables', () => {
    const theme = makeTheme()

    applyTheme(theme)

    const styleEl = document.getElementById('aperture-theme') as HTMLStyleElement | null
    expect(styleEl).not.toBeNull()
    expect(styleEl!.tagName).toBe('STYLE')
    expect(styleEl!.textContent).toMatch(/:root\s*\{/)
  })

  it('maps base09 to --c-accent and base0B to --c-state-ok', () => {
    // base09 = 099999 → 9 153 153 ;  base0B = 0bbbbb → 11 187 187
    const theme = makeTheme()

    applyTheme(theme)

    const css = document.getElementById('aperture-theme')!.textContent!
    expect(css).toMatch(/--c-accent:\s*9 153 153/)
    expect(css).toMatch(/--c-state-ok:\s*11 187 187/)
  })

  it('replaces existing style content on a second call (no duplicate tags)', () => {
    applyTheme(makeTheme())
    applyTheme(makeTheme({ base09: 'ffaa00' }))

    expect(document.querySelectorAll('#aperture-theme')).toHaveLength(1)
    expect(document.getElementById('aperture-theme')!.textContent!).toMatch(/--c-accent:\s*255 170 0/)
  })

  it('removes the style tag when called with null', () => {
    applyTheme(makeTheme())
    expect(document.getElementById('aperture-theme')).not.toBeNull()

    applyTheme(null)

    expect(document.getElementById('aperture-theme')).toBeNull()
  })

  it('removes the .dark class from <html> when applying an imported theme', () => {
    document.documentElement.classList.add('dark')

    applyTheme(makeTheme())

    expect(document.documentElement.classList.contains('dark')).toBe(false)
  })

  it('emits derived subtle tokens via blend, not raw colours', () => {
    // base00 = 000000 (background), base09 = 099999 (accent)
    // accent-subtle = blend([0,0,0], [9,153,153], 0.14) ≈ "1 21 21"
    applyTheme(makeTheme())

    const css = document.getElementById('aperture-theme')!.textContent!
    expect(css).toMatch(/--c-accent-subtle:\s*1 21 21/)
  })

  it('emits all ~30 expected tokens', () => {
    applyTheme(makeTheme())
    const css = document.getElementById('aperture-theme')!.textContent!
    const expected = [
      '--c-bg', '--c-sidebar', '--c-surface', '--c-elevated',
      '--c-border', '--c-border-2',
      '--c-text', '--c-text-2', '--c-text-3', '--c-text-4',
      '--c-accent', '--c-accent-hover', '--c-accent-subtle', '--c-accent-sub-2', '--c-accent-text',
      '--c-state-ok', '--c-state-ok-subtle',
      '--c-state-warn', '--c-state-warn-subtle',
      '--c-state-err', '--c-state-err-subtle',
      '--c-cat-blue', '--c-cat-blue-subtle',
      '--c-cat-purple', '--c-cat-green',
    ]
    for (const tok of expected) {
      expect(css).toContain(tok)
    }
  })

  it('places the style tag inside <head>', () => {
    applyTheme(makeTheme())
    const styleEl = document.getElementById('aperture-theme')!
    expect(document.head.contains(styleEl)).toBe(true)
  })

  it('is a no-op when applyTheme(null) is called with no existing tag', () => {
    expect(document.getElementById('aperture-theme')).toBeNull()
    expect(() => applyTheme(null)).not.toThrow()
    expect(document.getElementById('aperture-theme')).toBeNull()
  })

  it('writes the CSS to localStorage when applying a theme', () => {
    applyTheme(makeTheme())
    expect(localStorage.getItem('aperture-theme-css')).toMatch(/:root\s*\{/)
  })

  it('clears the localStorage cache when called with null', () => {
    applyTheme(makeTheme())
    expect(localStorage.getItem('aperture-theme-css')).not.toBeNull()

    applyTheme(null)

    expect(localStorage.getItem('aperture-theme-css')).toBeNull()
  })
})

describe('bootstrapTheme', () => {
  it('is a no-op when localStorage is empty', () => {
    expect(() => bootstrapTheme()).not.toThrow()
    expect(document.getElementById('aperture-theme')).toBeNull()
  })

  it('injects cached css into <head> synchronously', () => {
    const cachedCss = ':root { --c-bg: 12 34 56; }'
    localStorage.setItem('aperture-theme-css', cachedCss)

    bootstrapTheme()

    const styleEl = document.getElementById('aperture-theme')!
    expect(styleEl).not.toBeNull()
    expect(styleEl.textContent).toBe(cachedCss)
  })

  it('removes the .dark class when bootstrapping a cached theme', () => {
    document.documentElement.classList.add('dark')
    localStorage.setItem('aperture-theme-css', ':root { --c-bg: 0 0 0; }')

    bootstrapTheme()

    expect(document.documentElement.classList.contains('dark')).toBe(false)
  })

  it('replaces existing style content if a tag already exists', () => {
    const existing = document.createElement('style')
    existing.id = 'aperture-theme'
    existing.textContent = 'old'
    document.head.appendChild(existing)
    localStorage.setItem('aperture-theme-css', 'new')

    bootstrapTheme()

    expect(document.querySelectorAll('#aperture-theme')).toHaveLength(1)
    expect(document.getElementById('aperture-theme')!.textContent).toBe('new')
  })
})
